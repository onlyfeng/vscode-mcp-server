/**
 * Common utilities shared across all core modules
 * Provides path resolution, workspace helpers, and common types
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';

// ============================================
// Common Types
// ============================================

export interface LineRange {
    startLine: number;  // 1-based
    endLine: number;    // 1-based, -1 for end of file
    startCharacter?: number;  // 0-based
    endCharacter?: number;    // 0-based
}

export interface SymbolLocation {
    file: string;
    line: number;       // 1-based
    character: number;  // 0-based
    endLine?: number;   // 1-based
    endCharacter?: number;  // 0-based
}

export interface ServiceResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// ============================================
// Workspace Helpers
// ============================================

/**
 * Get the workspace root folder
 * @throws Error if no workspace is open
 */
export function getWorkspaceRoot(): vscode.Uri {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
    }
    return vscode.workspace.workspaceFolders[0].uri;
}

/**
 * Resolve a path (relative or absolute) to an absolute path
 * @param inputPath The input path (relative to workspace or absolute)
 * @returns Absolute path
 */
export function resolveToAbsolutePath(inputPath: string): string {
    if (!vscode.workspace.workspaceFolders) {
        return inputPath;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    return path.resolve(workspaceRoot, inputPath);
}

/**
 * Resolve a path to a VS Code Uri
 * @param inputPath The input path (relative to workspace or absolute)
 * @returns VS Code Uri
 */
export function resolveToUri(inputPath: string): vscode.Uri {
    return vscode.Uri.file(resolveToAbsolutePath(inputPath));
}

/**
 * Convert a workspace URI to a path relative to the workspace root
 * @param uri The URI to convert
 * @returns Path relative to workspace root, or absolute path if not in workspace
 */
export function uriToWorkspacePath(uri: vscode.Uri): string {
    if (!vscode.workspace.workspaceFolders) {
        return uri.fsPath;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const relativePath = path.relative(workspaceRoot, uri.fsPath);
    
    // If the relative path starts with '..' it means the file is outside the workspace
    // In that case, return the absolute path instead
    if (relativePath.startsWith('..')) {
        return uri.fsPath;
    }
    
    return relativePath;
}

// ============================================
// Document Helpers
// ============================================

/**
 * Open and get a text document
 * @param uri The URI of the document
 * @returns The opened document
 */
export async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    return await vscode.workspace.openTextDocument(uri);
}

/**
 * Check if a file exists
 * @param uri The URI to check
 * @returns true if the file exists
 */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the text content of a specific line in a file
 * @param uri The URI of the document
 * @param line The line number (0-based)
 * @returns The text content of the line or undefined if line doesn't exist
 */
export async function getLineText(uri: vscode.Uri, line: number): Promise<string | undefined> {
    try {
        const document = await openDocument(uri);
        if (line >= 0 && line < document.lineCount) {
            return document.lineAt(line).text;
        }
        return undefined;
    } catch (error) {
        logger.warn(`[getLineText] Error getting line text: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * Find the first occurrence of a symbol in a line of text
 * @param lineText The text content of the line
 * @param symbolName The exact symbol name to search for
 * @returns The character position (index) where the symbol starts, or -1 if not found
 */
export function findSymbolInLine(lineText: string, symbolName: string): number {
    if (!lineText || !symbolName) {
        return -1;
    }

    // If it doesn't look like an identifier, fall back to simple substring search.
    // This keeps behavior predictable for operators or non-standard symbols.
    const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbolName);
    if (!isIdentifier) {
        return lineText.indexOf(symbolName);
    }

    const isIdentChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

    let fromIndex = 0;
    while (fromIndex <= lineText.length) {
        const idx = lineText.indexOf(symbolName, fromIndex);
        if (idx === -1) {
            return -1;
        }

        const before = idx > 0 ? lineText[idx - 1] : '';
        const afterIndex = idx + symbolName.length;
        const after = afterIndex < lineText.length ? lineText[afterIndex] : '';

        const beforeOk = idx === 0 || !isIdentChar(before);
        const afterOk = afterIndex === lineText.length || !isIdentChar(after);

        if (beforeOk && afterOk) {
            return idx;
        }

        // Skip this occurrence and continue searching
        fromIndex = idx + symbolName.length;
    }

    return -1;
}

/**
 * Validate line number is within document bounds
 * @param line The line number (1-based)
 * @param lineCount The total number of lines in the document
 * @returns Error message if invalid, undefined if valid
 */
export function validateLineNumber(line: number, lineCount: number): string | undefined {
    if (line < 1 || line > lineCount) {
        return `Invalid line ${line}. Valid range: 1 to ${lineCount}`;
    }
    return undefined;
}

/**
 * Validate a line range
 * @param startLine Start line (1-based)
 * @param endLine End line (1-based, -1 for end of file)
 * @param lineCount Total lines in document
 * @returns Error message if invalid, undefined if valid
 */
export function validateLineRange(startLine: number, endLine: number, lineCount: number): string | undefined {
    const startError = validateLineNumber(startLine, lineCount);
    if (startError) {
        return startError;
    }
    
    const actualEndLine = endLine === -1 ? lineCount : endLine;
    if (endLine !== -1) {
        const endError = validateLineNumber(actualEndLine, lineCount);
        if (endError) {
            return endError;
        }
    }
    
    if (startLine > actualEndLine) {
        return `Invalid range: startLine (${startLine}) cannot be greater than endLine (${actualEndLine})`;
    }
    
    return undefined;
}

// ============================================
// Document Save Helpers
// ============================================

/**
 * Save a document by URI
 * @param uri The URI of the document to save
 * @returns true if saved successfully
 */
export async function saveDocument(uri: vscode.Uri): Promise<boolean> {
    try {
        const document = await openDocument(uri);
        if (document.isDirty) {
            await document.save();
            logger.info(`[saveDocument] Saved document: ${uri.fsPath}`);
        }
        return true;
    } catch (error) {
        logger.warn(`[saveDocument] Failed to save document ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Save all documents affected by a WorkspaceEdit
 * @param edit The workspace edit that was applied
 */
export async function saveAffectedDocuments(edit: vscode.WorkspaceEdit): Promise<void> {
    const affectedUris = new Set<string>();
    for (const [uri] of edit.entries()) {
        affectedUris.add(uri.toString());
    }
    
    const savePromises = Array.from(affectedUris).map(uriString => 
        saveDocument(vscode.Uri.parse(uriString))
    );
    await Promise.all(savePromises);
}

// ============================================
// Symbol Kind Helpers
// ============================================

/**
 * Convert a symbol kind to a string representation
 * Uses switch case for safer conversion
 */
export function symbolKindToString(kind: vscode.SymbolKind): string {
    switch (kind) {
        case vscode.SymbolKind.File: return 'File';
        case vscode.SymbolKind.Module: return 'Module';
        case vscode.SymbolKind.Namespace: return 'Namespace';
        case vscode.SymbolKind.Package: return 'Package';
        case vscode.SymbolKind.Class: return 'Class';
        case vscode.SymbolKind.Method: return 'Method';
        case vscode.SymbolKind.Property: return 'Property';
        case vscode.SymbolKind.Field: return 'Field';
        case vscode.SymbolKind.Constructor: return 'Constructor';
        case vscode.SymbolKind.Enum: return 'Enum';
        case vscode.SymbolKind.Interface: return 'Interface';
        case vscode.SymbolKind.Function: return 'Function';
        case vscode.SymbolKind.Variable: return 'Variable';
        case vscode.SymbolKind.Constant: return 'Constant';
        case vscode.SymbolKind.String: return 'String';
        case vscode.SymbolKind.Number: return 'Number';
        case vscode.SymbolKind.Boolean: return 'Boolean';
        case vscode.SymbolKind.Array: return 'Array';
        case vscode.SymbolKind.Object: return 'Object';
        case vscode.SymbolKind.Key: return 'Key';
        case vscode.SymbolKind.Null: return 'Null';
        case vscode.SymbolKind.EnumMember: return 'EnumMember';
        case vscode.SymbolKind.Struct: return 'Struct';
        case vscode.SymbolKind.Event: return 'Event';
        case vscode.SymbolKind.Operator: return 'Operator';
        case vscode.SymbolKind.TypeParameter: return 'TypeParameter';
        default: return 'Unknown';
    }
}

/**
 * Convert diagnostic severity to string
 * Uses switch case for safer conversion
 */
export function severityToString(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return 'Error';
        case vscode.DiagnosticSeverity.Warning:
            return 'Warning';
        case vscode.DiagnosticSeverity.Information:
            return 'Information';
        case vscode.DiagnosticSeverity.Hint:
            return 'Hint';
        default:
            return 'Unknown';
    }
}

/**
 * Get a preview of the code at a specific line
 * @param uri The URI of the document
 * @param line The line number (0-based)
 * @returns The line content as a string or undefined if not available
 */
export async function getPreview(uri: vscode.Uri, line?: number): Promise<string | undefined> {
    if (line === undefined) {
        return undefined;
    }

    try {
        const documents = vscode.workspace.textDocuments;
        let document = documents.find(doc => doc.uri.toString() === uri.toString());
        
        if (!document) {
            try {
                const content = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(content).toString('utf8');
                const lines = text.split(/\r?\n/);
                
                if (line >= 0 && line < lines.length) {
                    return lines[line].trim();
                }
            } catch (error) {
                logger.warn(`[getPreview] Could not read file: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
            }
        } else {
            if (line >= 0 && line < document.lineCount) {
                return document.lineAt(line).text.trim();
            }
        }
    } catch (error) {
        logger.warn(`[getPreview] Error getting preview: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return undefined;
}
