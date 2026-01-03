/**
 * Symbol Service - Core symbol analysis logic shared by MCP tools and REST API
 * Handles document symbols, workspace symbols, references, and definitions
 */

import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import {
    resolveToUri,
    uriToWorkspacePath,
    openDocument,
    fileExists,
    getLineText,
    findSymbolInLine,
    validateLineNumber,
    symbolKindToString,
    ServiceResult
} from './common';

// ============================================
// Types
// ============================================

export interface SymbolInfo {
    name: string;
    kind: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    children?: SymbolInfo[];
}

export interface DocumentSymbolInfo extends SymbolInfo {
    detail?: string;
    selectionRange: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    depth: number;
    childCount?: number;
}

export interface WorkspaceSymbolInfo {
    name: string;
    kind: string;
    file: string;
    line: number;
    character: number;
    containerName?: string;
}

export interface ReferenceInfo {
    file: string;
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
}

export interface DefinitionInfo {
    file: string;
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
}

export interface DocumentSymbolsResult {
    symbols: DocumentSymbolInfo[];
    total: number;
    totalByKind: Record<string, number>;
}

export interface WorkspaceSymbolsResult {
    symbols: WorkspaceSymbolInfo[];
    total: number;
}

// ============================================
// Document Symbols
// ============================================

/**
 * Get all document symbols from a file in hierarchical format
 * @param filePath Path to the file
 * @param maxDepth Maximum nesting depth to display (optional)
 */
export async function getDocumentSymbols(
    filePath: string,
    maxDepth?: number
): Promise<ServiceResult<DocumentSymbolsResult>> {
    logger.info(`[getDocumentSymbols] Getting symbols for ${filePath}, maxDepth: ${maxDepth}`);
    
    try {
        const uri = resolveToUri(filePath);
        
        if (!await fileExists(uri)) {
            return { success: false, error: `File not found: ${filePath}` };
        }
        
        // Execute the document symbol provider
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        ) || [];
        
        logger.info(`[getDocumentSymbols] Found ${symbols.length} top-level symbols`);
        
        const flatSymbols: DocumentSymbolInfo[] = [];
        const kindCounts: Record<string, number> = {};
        
        // Recursive function to process symbols and their children
        function processSymbols(symbols: vscode.DocumentSymbol[], depth: number = 0) {
            for (const symbol of symbols) {
                // Skip if max depth exceeded
                if (maxDepth !== undefined && depth > maxDepth) {
                    continue;
                }
                
                const kindString = symbolKindToString(symbol.kind);
                kindCounts[kindString] = (kindCounts[kindString] || 0) + 1;
                
                const processedSymbol: DocumentSymbolInfo = {
                    name: symbol.name,
                    detail: symbol.detail || undefined,
                    kind: kindString,
                    range: {
                        start: {
                            line: symbol.range.start.line + 1,
                            character: symbol.range.start.character
                        },
                        end: {
                            line: symbol.range.end.line + 1,
                            character: symbol.range.end.character
                        }
                    },
                    selectionRange: {
                        start: {
                            line: symbol.selectionRange.start.line + 1,
                            character: symbol.selectionRange.start.character
                        },
                        end: {
                            line: symbol.selectionRange.end.line + 1,
                            character: symbol.selectionRange.end.character
                        }
                    },
                    depth,
                    childCount: symbol.children?.length || undefined
                };
                
                flatSymbols.push(processedSymbol);
                
                // Recursively process children
                if (symbol.children && symbol.children.length > 0) {
                    processSymbols(symbol.children, depth + 1);
                }
            }
        }
        
        processSymbols(symbols);
        
        return {
            success: true,
            data: {
                symbols: flatSymbols,
                total: flatSymbols.length,
                totalByKind: kindCounts
            }
        };
    } catch (error) {
        logger.error(`[getDocumentSymbols] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Format document symbols for REST API response (simplified format)
 */
export function formatDocumentSymbolsForApi(symbols: vscode.DocumentSymbol[]): SymbolInfo[] {
    return symbols.map(s => ({
        name: s.name,
        kind: symbolKindToString(s.kind),
        range: {
            start: { line: s.range.start.line + 1, character: s.range.start.character },
            end: { line: s.range.end.line + 1, character: s.range.end.character }
        },
        children: s.children ? formatDocumentSymbolsForApi(s.children) : undefined
    }));
}

// ============================================
// Workspace Symbols
// ============================================

/**
 * Search for symbols across the workspace
 * @param query The search query
 * @param maxResults Maximum number of results to return
 */
export async function searchWorkspaceSymbols(
    query: string,
    maxResults: number = 10
): Promise<ServiceResult<WorkspaceSymbolsResult>> {
    logger.info(`[searchWorkspaceSymbols] Searching with query: "${query}", maxResults: ${maxResults}`);
    
    try {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        ) || [];
        
        logger.info(`[searchWorkspaceSymbols] Found ${symbols.length} symbols`);
        
        const total = symbols.length;
        const limitedSymbols = symbols.slice(0, maxResults);
        
        const formattedSymbols: WorkspaceSymbolInfo[] = limitedSymbols.map(symbol => ({
            name: symbol.name,
            kind: symbolKindToString(symbol.kind),
            file: uriToWorkspacePath(symbol.location.uri),
            line: symbol.location.range.start.line + 1,
            character: symbol.location.range.start.character,
            containerName: symbol.containerName || undefined
        }));
        
        return {
            success: true,
            data: {
                symbols: formattedSymbols,
                total
            }
        };
    } catch (error) {
        logger.error(`[searchWorkspaceSymbols] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// References
// ============================================

/**
 * Find all references to a symbol
 * @param filePath Path to the file containing the symbol
 * @param line Line number (1-based)
 * @param character Character position (0-based), or undefined to search for symbol
 * @param symbol Symbol name to search for (if character not provided)
 * @param includeDeclaration Whether to include the declaration in results
 */
export async function findReferences(
    filePath: string,
    line: number,
    character?: number,
    symbol?: string,
    includeDeclaration: boolean = true
): Promise<ServiceResult<ReferenceInfo[]>> {
    logger.info(`[findReferences] path="${filePath}", line=${line}, character=${character}, symbol="${symbol}"`);
    
    try {
        const uri = resolveToUri(filePath);
        
        if (!await fileExists(uri)) {
            return { success: false, error: `File not found: ${filePath}` };
        }
        
        const document = await openDocument(uri);
        
        // Validate line number
        const lineError = validateLineNumber(line, document.lineCount);
        if (lineError) {
            return { success: false, error: lineError };
        }
        
        // Determine character position
        let charPosition = character;
        if (charPosition === undefined) {
            if (!symbol) {
                return { success: false, error: 'Either character position or symbol name must be provided' };
            }
            const lineText = await getLineText(uri, line - 1);
            if (lineText === undefined) {
                return { success: false, error: `Line ${line} not found in file: ${filePath}` };
            }
            charPosition = findSymbolInLine(lineText, symbol);
            if (charPosition === -1) {
                return { success: false, error: `Symbol "${symbol}" not found on line ${line}` };
            }
        }
        
        const position = new vscode.Position(line - 1, charPosition);
        
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        ) || [];
        
        logger.info(`[findReferences] Found ${references.length} references`);
        
        // Filter out declaration if requested
        let filteredRefs = references;
        if (!includeDeclaration && references.length > 0) {
            filteredRefs = references.filter(ref => 
                !(ref.uri.toString() === uri.toString() && 
                  ref.range.start.line === line - 1 && 
                  ref.range.start.character === charPosition)
            );
        }
        
        const formattedRefs: ReferenceInfo[] = filteredRefs.map(ref => ({
            file: uriToWorkspacePath(ref.uri),
            line: ref.range.start.line + 1,
            character: ref.range.start.character,
            endLine: ref.range.end.line + 1,
            endCharacter: ref.range.end.character
        }));
        
        return { success: true, data: formattedRefs };
    } catch (error) {
        logger.error(`[findReferences] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// Definitions
// ============================================

/**
 * Get symbol definition
 * @param filePath Path to the file containing the symbol
 * @param line Line number (1-based)
 * @param character Character position (0-based), or undefined to search for symbol
 * @param symbol Symbol name to search for (if character not provided)
 */
export async function getDefinition(
    filePath: string,
    line: number,
    character?: number,
    symbol?: string
): Promise<ServiceResult<DefinitionInfo[]>> {
    logger.info(`[getDefinition] path="${filePath}", line=${line}, character=${character}, symbol="${symbol}"`);
    
    try {
        const uri = resolveToUri(filePath);
        
        if (!await fileExists(uri)) {
            return { success: false, error: `File not found: ${filePath}` };
        }
        
        const document = await openDocument(uri);
        
        // Validate line number
        const lineError = validateLineNumber(line, document.lineCount);
        if (lineError) {
            return { success: false, error: lineError };
        }
        
        // Determine character position
        let charPosition = character;
        if (charPosition === undefined) {
            if (!symbol) {
                return { success: false, error: 'Either character position or symbol name must be provided' };
            }
            const lineText = await getLineText(uri, line - 1);
            if (lineText === undefined) {
                return { success: false, error: `Line ${line} not found in file: ${filePath}` };
            }
            charPosition = findSymbolInLine(lineText, symbol);
            if (charPosition === -1) {
                return { success: false, error: `Symbol "${symbol}" not found on line ${line}` };
            }
        }
        
        const position = new vscode.Position(line - 1, charPosition);
        
        const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        ) || [];
        
        logger.info(`[getDefinition] Found ${definitions.length} definitions`);
        
        const formattedDefs: DefinitionInfo[] = definitions.map(def => {
            if (isLocationLink(def)) {
                const range = def.targetSelectionRange ?? def.targetRange;
                return {
                    file: uriToWorkspacePath(def.targetUri),
                    line: range.start.line + 1,
                    character: range.start.character,
                    endLine: range.end.line + 1,
                    endCharacter: range.end.character
                };
            }
            return {
                file: uriToWorkspacePath(def.uri),
                line: def.range.start.line + 1,
                character: def.range.start.character,
                endLine: def.range.end.line + 1,
                endCharacter: def.range.end.character
            };
        });
        
        return { success: true, data: formattedDefs };
    } catch (error) {
        logger.error(`[getDefinition] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// Helper Functions
// ============================================

function isLocationLink(def: vscode.Location | vscode.LocationLink): def is vscode.LocationLink {
    return 'targetUri' in def && 'targetRange' in def;
}
