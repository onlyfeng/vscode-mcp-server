import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Cache for code actions with TTL support
 * Key: requestId, Value: { actions, timestamp, uri, range }
 */
interface CachedCodeActions {
    actions: vscode.CodeAction[];
    timestamp: number;
    uri: vscode.Uri;
    range: vscode.Range;
}

const codeActionsCache = new Map<string, CachedCodeActions>();
const CODE_ACTIONS_TTL = 60000; // 60 seconds TTL

/**
 * Generate a unique request ID for code actions
 */
function generateRequestId(): string {
    return `ca_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of codeActionsCache.entries()) {
        if (now - value.timestamp > CODE_ACTIONS_TTL) {
            codeActionsCache.delete(key);
            logger.info(`[cleanupExpiredCache] Removed expired cache entry: ${key}`);
        }
    }
}

/**
 * Converts a workspace URI to a path relative to the workspace root
 * @param uri The URI to convert
 * @returns Path relative to workspace root
 */
function uriToWorkspacePath(uri: vscode.Uri): string {
    if (!vscode.workspace.workspaceFolders) {
        return uri.fsPath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceRoot = workspaceFolder.uri.fsPath;
    
    // Convert to relative path
    const relativePath = path.relative(workspaceRoot, uri.fsPath);
    return relativePath;
}

/**
 * Resolve a path (relative or absolute) to an absolute path
 * @param inputPath The input path
 * @returns Absolute path
 */
function resolveToAbsolutePath(inputPath: string): string {
    if (!vscode.workspace.workspaceFolders) {
        return inputPath;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    return path.resolve(workspaceRoot, inputPath);
}

/**
 * Format WorkspaceEdit to a readable summary
 * @param edit The workspace edit
 * @returns Formatted summary string
 */
function formatWorkspaceEditSummary(edit: vscode.WorkspaceEdit): string {
    const entries = edit.entries();
    let fileCount = 0;
    let totalChanges = 0;
    const fileChanges: string[] = [];
    
    for (const [uri, edits] of entries) {
        fileCount++;
        totalChanges += edits.length;
        fileChanges.push(`  - ${uriToWorkspacePath(uri)}: ${edits.length} change(s)`);
    }
    
    return `Affected ${fileCount} file(s) with ${totalChanges} total change(s):\n${fileChanges.join('\n')}`;
}

/**
 * Get the text content of a specific line in a file
 * @param uri The URI of the document
 * @param line The line number (0-based)
 * @returns The text content of the line or undefined if line doesn't exist
 */
async function getLineText(uri: vscode.Uri, line: number): Promise<string | undefined> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
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
function findSymbolInLine(lineText: string, symbolName: string): number {
    return lineText.indexOf(symbolName);
}

/**
 * Registers MCP refactor-related tools with the server
 * @param server MCP server instance
 */
export function registerRefactorTools(server: McpServer): void {
    
    // =====================================================
    // Tool 1: rename_symbol_code - Rename symbol across workspace
    // =====================================================
    server.tool(
        'rename_symbol_code',
        `Rename a symbol across the entire workspace using VS Code's rename provider.

        WHEN TO USE: Refactoring variable/function/class names, ensuring consistent naming.
        
        Performs semantic rename that updates all references. Set apply=false for preview only.`,
        {
            path: z.string().describe('The path to the file containing the symbol'),
            line: z.number().describe('The line number of the symbol (1-based)'),
            character: z.number().optional().describe('The character position in the line (0-based). If not provided, will search for the symbol name on the line.'),
            symbol: z.string().optional().describe('The symbol name to search for on the line (used if character is not provided)'),
            newName: z.string().describe('The new name for the symbol'),
            apply: z.boolean().optional().default(true).describe('Whether to apply the rename (default: true). Set to false to preview changes.')
        },
        async ({ path: filePath, line, character, symbol, newName, apply = true }): Promise<CallToolResult> => {
            logger.info(`[rename_symbol_code] Tool called with path="${filePath}", line=${line}, newName="${newName}", apply=${apply}`);
            
            try {
                const fullPath = resolveToAbsolutePath(filePath);
                const uri = vscode.Uri.file(fullPath);
                
                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(uri);
                } catch {
                    throw new Error(`File not found: ${filePath}`);
                }
                
                // Determine character position
                let charPosition = character;
                if (charPosition === undefined) {
                    if (!symbol) {
                        throw new Error('Either character position or symbol name must be provided');
                    }
                    const lineText = await getLineText(uri, line - 1);
                    if (!lineText) {
                        throw new Error(`Line ${line} not found in file: ${filePath}`);
                    }
                    charPosition = findSymbolInLine(lineText, symbol);
                    if (charPosition === -1) {
                        return {
                            content: [{
                                type: 'text',
                                text: `Symbol "${symbol}" not found on line ${line} in file: ${filePath}`
                            }]
                        };
                    }
                }
                
                const position = new vscode.Position(line - 1, charPosition);
                
                // Optional: Prepare rename to validate
                try {
                    const prepareResult = await vscode.commands.executeCommand<vscode.Range | { range: vscode.Range; placeholder: string }>(
                        'vscode.prepareRename',
                        uri,
                        position
                    );
                    
                    if (!prepareResult) {
                        return {
                            content: [{
                                type: 'text',
                                text: `Cannot rename symbol at ${filePath}:${line}:${charPosition}. The symbol may not be renameable.`
                            }]
                        };
                    }
                    logger.info(`[rename_symbol_code] Prepare rename succeeded`);
                } catch (prepareError) {
                    logger.warn(`[rename_symbol_code] Prepare rename failed: ${prepareError instanceof Error ? prepareError.message : String(prepareError)}`);
                    // Continue anyway, some providers don't support prepareRename
                }
                
                // Execute rename provider
                const workspaceEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                    'vscode.executeDocumentRenameProvider',
                    uri,
                    position,
                    newName
                );
                
                if (!workspaceEdit || workspaceEdit.size === 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: `No rename edits generated for symbol at ${filePath}:${line}:${charPosition}. The symbol may not be renameable or no changes needed.`
                        }]
                    };
                }
                
                const summary = formatWorkspaceEditSummary(workspaceEdit);
                
                if (apply) {
                    // Apply the edit
                    const success = await vscode.workspace.applyEdit(workspaceEdit);
                    
                    if (success) {
                        logger.info(`[rename_symbol_code] Rename applied successfully`);
                        return {
                            content: [{
                                type: 'text',
                                text: `Rename to "${newName}" applied successfully.\n\n${summary}`
                            }]
                        };
                    } else {
                        return {
                            content: [{
                                type: 'text',
                                text: `Failed to apply rename. The operation was rejected.`
                            }],
                            isError: true
                        };
                    }
                } else {
                    // Preview only
                    return {
                        content: [{
                            type: 'text',
                            text: `Rename preview (not applied):\n\nRenaming to "${newName}" would affect:\n${summary}`
                        }]
                    };
                }
            } catch (error) {
                logger.error(`[rename_symbol_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // =====================================================
    // Tool 2: list_code_actions_code - List available code actions
    // =====================================================
    server.tool(
        'list_code_actions_code',
        `List available code actions (quick fixes, refactorings) for a code range.

        WHEN TO USE: Finding available fixes for diagnostics, discovering refactoring options.
        
        Returns a requestId that can be used with apply_code_action_code. Results are cached for 60 seconds.`,
        {
            path: z.string().describe('The path to the file'),
            startLine: z.number().describe('Start line of the range (1-based)'),
            startCharacter: z.number().optional().default(0).describe('Start character of the range (0-based, default: 0)'),
            endLine: z.number().optional().describe('End line of the range (1-based, default: same as startLine)'),
            endCharacter: z.number().optional().describe('End character of the range (0-based, default: end of line)'),
            onlyKinds: z.array(z.string()).optional().describe('Filter by code action kinds (e.g., ["quickfix", "refactor"])'),
            includeSourceActions: z.boolean().optional().default(false).describe('Include source actions like organize imports (default: false)')
        },
        async ({ path: filePath, startLine, startCharacter = 0, endLine, endCharacter, onlyKinds, includeSourceActions = false }): Promise<CallToolResult> => {
            logger.info(`[list_code_actions_code] Tool called with path="${filePath}", range=${startLine}:${startCharacter}-${endLine || startLine}:${endCharacter}`);
            
            // Cleanup expired cache entries first
            cleanupExpiredCache();
            
            try {
                const fullPath = resolveToAbsolutePath(filePath);
                const uri = vscode.Uri.file(fullPath);
                
                // Check if file exists and open it
                try {
                    await vscode.workspace.fs.stat(uri);
                } catch {
                    throw new Error(`File not found: ${filePath}`);
                }
                
                // Open document to get line length if needed
                const document = await vscode.workspace.openTextDocument(uri);
                
                const actualEndLine = endLine ?? startLine;
                const actualEndChar = endCharacter ?? document.lineAt(actualEndLine - 1).text.length;
                
                const range = new vscode.Range(
                    new vscode.Position(startLine - 1, startCharacter),
                    new vscode.Position(actualEndLine - 1, actualEndChar)
                );
                
                // Determine the primary kind filter (if any) for the command
                const primaryKind = onlyKinds && onlyKinds.length > 0 
                    ? onlyKinds[0] 
                    : undefined;
                
                // Execute code action provider
                let actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                    'vscode.executeCodeActionProvider',
                    uri,
                    range,
                    primaryKind
                ) || [];
                
                // Filter source actions if not requested
                if (!includeSourceActions) {
                    actions = actions.filter(a => !a.kind?.value?.startsWith('source.'));
                }
                
                // Filter by kinds if specified
                if (onlyKinds && onlyKinds.length > 0) {
                    actions = actions.filter(a => {
                        if (!a.kind) {
                            return false;
                        }
                        return onlyKinds.some(k => a.kind!.value?.startsWith(k));
                    });
                }
                
                logger.info(`[list_code_actions_code] Found ${actions.length} code actions`);
                
                if (actions.length === 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: `No code actions available for the specified range in ${filePath}:${startLine}:${startCharacter}-${actualEndLine}:${actualEndChar}`
                        }]
                    };
                }
                
                // Generate request ID and cache the actions
                const requestId = generateRequestId();
                codeActionsCache.set(requestId, {
                    actions,
                    timestamp: Date.now(),
                    uri,
                    range
                });
                
                // Format action list
                let resultText = `Found ${actions.length} code action(s) for ${filePath}:${startLine}:${startCharacter}-${actualEndLine}:${actualEndChar}\n\n`;
                resultText += `Request ID: ${requestId} (valid for 60 seconds)\n\n`;
                resultText += `Available actions:\n`;
                
                actions.forEach((action, index) => {
                    resultText += `\n[${index}] ${action.title}`;
                    if (action.kind) {
                        resultText += ` (${action.kind.value})`;
                    }
                    if (action.isPreferred) {
                        resultText += ' [PREFERRED]';
                    }
                    if (action.diagnostics && action.diagnostics.length > 0) {
                        resultText += `\n    Fixes: ${action.diagnostics.map(d => d.message).join(', ')}`;
                    }
                });
                
                resultText += `\n\nUse apply_code_action_code with requestId="${requestId}" and the action index to apply.`;
                
                return {
                    content: [{
                        type: 'text',
                        text: resultText
                    }]
                };
            } catch (error) {
                logger.error(`[list_code_actions_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // =====================================================
    // Tool 3: apply_code_action_code - Apply a cached code action
    // =====================================================
    server.tool(
        'apply_code_action_code',
        `Apply a code action from a previous list_code_actions_code call.

        WHEN TO USE: After listing code actions, to apply a specific fix or refactoring.
        
        Requires the requestId from list_code_actions_code (valid for 60 seconds) and the action index.`,
        {
            requestId: z.string().describe('The request ID from list_code_actions_code'),
            index: z.number().describe('The index of the action to apply (from the list)')
        },
        async ({ requestId, index }): Promise<CallToolResult> => {
            logger.info(`[apply_code_action_code] Tool called with requestId="${requestId}", index=${index}`);
            
            // Cleanup expired cache entries
            cleanupExpiredCache();
            
            try {
                // Get cached actions
                const cached = codeActionsCache.get(requestId);
                
                if (!cached) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Request ID "${requestId}" not found or expired. Please run list_code_actions_code again to get a new request ID.`
                        }],
                        isError: true
                    };
                }
                
                // Check if expired
                if (Date.now() - cached.timestamp > CODE_ACTIONS_TTL) {
                    codeActionsCache.delete(requestId);
                    return {
                        content: [{
                            type: 'text',
                            text: `Request ID "${requestId}" has expired (> 60 seconds). Please run list_code_actions_code again.`
                        }],
                        isError: true
                    };
                }
                
                // Validate index
                if (index < 0 || index >= cached.actions.length) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Invalid action index ${index}. Valid range: 0 to ${cached.actions.length - 1}`
                        }],
                        isError: true
                    };
                }
                
                const action = cached.actions[index];
                logger.info(`[apply_code_action_code] Applying action: ${action.title}`);
                
                let applied = false;
                let resultMessage = `Applying code action: "${action.title}"\n\n`;
                
                // Apply workspace edit if present
                if (action.edit) {
                    const editSuccess = await vscode.workspace.applyEdit(action.edit);
                    if (editSuccess) {
                        resultMessage += `Workspace edit applied successfully.\n`;
                        resultMessage += formatWorkspaceEditSummary(action.edit) + '\n';
                        applied = true;
                    } else {
                        return {
                            content: [{
                                type: 'text',
                                text: `Failed to apply workspace edit for action "${action.title}".`
                            }],
                            isError: true
                        };
                    }
                }
                
                // Execute command if present
                if (action.command) {
                    try {
                        await vscode.commands.executeCommand(
                            action.command.command,
                            ...(action.command.arguments || [])
                        );
                        resultMessage += `Command "${action.command.command}" executed successfully.\n`;
                        applied = true;
                    } catch (cmdError) {
                        logger.error(`[apply_code_action_code] Command execution failed: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}`);
                        return {
                            content: [{
                                type: 'text',
                                text: `Failed to execute command for action "${action.title}": ${cmdError instanceof Error ? cmdError.message : String(cmdError)}`
                            }],
                            isError: true
                        };
                    }
                }
                
                // Remove from cache after successful application
                codeActionsCache.delete(requestId);
                
                if (applied) {
                    return {
                        content: [{
                            type: 'text',
                            text: resultMessage
                        }]
                    };
                } else {
                    return {
                        content: [{
                            type: 'text',
                            text: `Code action "${action.title}" has no edit or command to apply.`
                        }]
                    };
                }
            } catch (error) {
                logger.error(`[apply_code_action_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}
