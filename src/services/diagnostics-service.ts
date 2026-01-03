/**
 * Diagnostics Service - Core diagnostics logic shared by MCP tools and REST API
 * Handles getting and formatting diagnostics from VS Code
 */

import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import {
    resolveToUri,
    uriToWorkspacePath,
    severityToString,
    ServiceResult,
    getWorkspaceRoot
} from './common';

// ============================================
// Types
// ============================================

export interface DiagnosticInfo {
    message: string;
    severity: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    source?: string;
}

export interface FileDiagnostics {
    file: string;
    diagnostics: DiagnosticInfo[];
}

export interface DiagnosticsResult {
    diagnostics: FileDiagnostics[];
    totalCount: number;
    fileCount: number;
}

export interface FormattedDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    source?: string;
}

// ============================================
// Get Diagnostics
// ============================================

/**
 * Get diagnostics for a specific file or the entire workspace
 * @param filePath Optional file path to check. If not provided, checks entire workspace.
 */
export async function getDiagnostics(filePath?: string): Promise<ServiceResult<DiagnosticsResult>> {
    logger.info(`[getDiagnostics] Getting diagnostics for ${filePath || 'all files'}`);
    
    try {
        const result: FileDiagnostics[] = [];
        
        if (filePath) {
            // Get diagnostics for specific file
            const uri = resolveToUri(filePath);
            const fileDiagnostics = vscode.languages.getDiagnostics(uri);
            
            if (fileDiagnostics.length > 0) {
                result.push({
                    file: filePath,
                    diagnostics: fileDiagnostics.map(d => formatDiagnostic(d))
                });
            }
        } else {
            // Get diagnostics for all files
            const allDiagnostics = vscode.languages.getDiagnostics();
            
            for (const [uri, fileDiagnostics] of allDiagnostics) {
                if (fileDiagnostics.length > 0) {
                    result.push({
                        file: uriToWorkspacePath(uri),
                        diagnostics: fileDiagnostics.map(d => formatDiagnostic(d))
                    });
                }
            }
        }
        
        const totalCount = result.reduce((sum, d) => sum + d.diagnostics.length, 0);
        
        return {
            success: true,
            data: {
                diagnostics: result,
                totalCount,
                fileCount: result.length
            }
        };
    } catch (error) {
        logger.error(`[getDiagnostics] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Get diagnostics filtered by severity levels
 * @param filePath Optional file path to check
 * @param severities Array of severity levels to include (0=Error, 1=Warning, 2=Info, 3=Hint)
 * @param includeSource Whether to include the diagnostic source
 */
export async function getFilteredDiagnostics(
    filePath?: string,
    severities: vscode.DiagnosticSeverity[] = [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
    includeSource: boolean = true
): Promise<ServiceResult<FormattedDiagnostic[]>> {
    logger.info(`[getFilteredDiagnostics] path=${filePath || 'all'}, severities=${severities.join(',')}`);
    
    try {
        const result: FormattedDiagnostic[] = [];
        let diagnosticsList: [vscode.Uri, vscode.Diagnostic[]][];
        
        if (filePath) {
            const uri = resolveToUri(filePath);
            const fileDiagnostics = vscode.languages.getDiagnostics(uri);
            diagnosticsList = fileDiagnostics.length > 0 ? [[uri, fileDiagnostics]] : [];
        } else {
            diagnosticsList = vscode.languages.getDiagnostics();
        }
        
        for (const [uri, fileDiagnostics] of diagnosticsList) {
            const relativePath = uriToWorkspacePath(uri);
            
            for (const diagnostic of fileDiagnostics) {
                // Skip diagnostics with severity not in the specified list
                if (!severities.includes(diagnostic.severity)) {
                    continue;
                }
                
                const formatted: FormattedDiagnostic = {
                    file: relativePath,
                    line: diagnostic.range.start.line + 1,
                    column: diagnostic.range.start.character + 1,
                    severity: severityToString(diagnostic.severity),
                    message: diagnostic.message
                };
                
                if (includeSource && diagnostic.source) {
                    formatted.source = diagnostic.source;
                }
                
                result.push(formatted);
            }
        }
        
        return { success: true, data: result };
    } catch (error) {
        logger.error(`[getFilteredDiagnostics] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Format diagnostics as text output
 * @param diagnostics Array of formatted diagnostics
 * @param includeSource Whether to include the source in output
 */
export function formatDiagnosticsAsText(diagnostics: FormattedDiagnostic[], includeSource: boolean = true): string {
    if (diagnostics.length === 0) {
        return 'No issues found.';
    }
    
    let output = `Found ${diagnostics.length} issue(s):\n\n`;
    
    for (const issue of diagnostics) {
        output += `${issue.severity}: ${issue.file}:${issue.line}:${issue.column}\n`;
        output += `  ${issue.message}\n`;
        
        if (includeSource && issue.source) {
            output += `  Source: ${issue.source}\n`;
        }
        
        output += '\n';
    }
    
    return output;
}

// ============================================
// Helper Functions
// ============================================

function formatDiagnostic(d: vscode.Diagnostic): DiagnosticInfo {
    return {
        message: d.message,
        severity: severityToString(d.severity),
        range: {
            start: { line: d.range.start.line + 1, character: d.range.start.character },
            end: { line: d.range.end.line + 1, character: d.range.end.character }
        },
        source: d.source
    };
}
