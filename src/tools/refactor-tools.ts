import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { logger } from '../utils/logger';
import {
    codeActionsCache,
    CODE_ACTIONS_TTL,
    generateRequestId,
    cleanupExpiredCache,
    invalidateCacheForUri,
    removeCachedActions
} from '../utils/code-actions-cache';

/**
 * Save a document by URI (following edit-tools.ts pattern)
 * Uses vscode.workspace.openTextDocument to ensure document is accessible
 * @param uri The URI of the document to save
 */
async function saveDocument(uri: vscode.Uri): Promise<boolean> {
    try {
        // Use openTextDocument to get/open the document (same pattern as edit-tools.ts)
        const document = await vscode.workspace.openTextDocument(uri);
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
 * Uses Promise.all for parallel saving to improve performance
 * @param edit The workspace edit that was applied
 */
async function saveAffectedDocuments(edit: vscode.WorkspaceEdit): Promise<void> {
    // Collect unique URIs from the edit
    const affectedUris = new Set<string>();
    for (const [uri] of edit.entries()) {
        affectedUris.add(uri.toString());
    }
    
    // Save all documents in parallel and wait for all to complete
    const savePromises = Array.from(affectedUris).map(uriString => 
        saveDocument(vscode.Uri.parse(uriString))
    );
    await Promise.all(savePromises);
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
 * Check if a code action is potentially dangerous (might remove useful code)
 * These actions should be skipped in applyAll mode to avoid unintended code removal
 * @param action The code action to check
 * @returns true if the action should be filtered out in applyAll mode
 */
function isDangerousQuickfix(action: vscode.CodeAction): boolean {
    const title = action.title.toLowerCase();
    
    // Filter out "Remove unused declaration" type actions
    // These can incorrectly remove function calls with side effects (like logging)
    // TypeScript may mark string literals in function calls as "unused declarations"
    if (title.includes('remove unused declaration') || 
        title.includes('remove unused') ||
        title.includes('delete unused')) {
        logger.info(`[isDangerousQuickfix] Filtering dangerous action: "${action.title}"`);
        return true;
    }
    
    // Filter out actions that delete entire statements without being specific about variables/imports
    // But allow "Remove import" which is safe
    if (title.includes('remove') && !title.includes('import')) {
        // Check if it's a generic removal action (not targeting a specific import)
        if (!title.includes('parameter') && !title.includes('variable')) {
            logger.info(`[isDangerousQuickfix] Filtering potentially dangerous removal action: "${action.title}"`);
            return true;
        }
    }
    
    return false;
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
                    if (lineText === undefined) {
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
        
        SCANNING ENTIRE FILE: Use startLine=1 and endLine=-1 to scan the entire file for all available code actions.
        This is the recommended approach when you need to check the whole file for issues or refactoring opportunities.
        
        Returns a requestId that can be used with apply_code_action_code. Results are cached for 60 seconds.`,
        {
            path: z.string().describe('The path to the file'),
            startLine: z.number().describe('Start line of the range (1-based). Use 1 for scanning from the beginning.'),
            startCharacter: z.number().optional().default(0).describe('Start character of the range (0-based, default: 0)'),
            endLine: z.number().optional().describe('End line of the range (1-based). Use -1 for end of file. Default: same as startLine.'),
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
                
                // Validate startLine is within document bounds
                if (startLine < 1 || startLine > document.lineCount) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Invalid startLine ${startLine}. File has ${document.lineCount} lines (valid range: 1 to ${document.lineCount}).`
                        }],
                        isError: true
                    };
                }
                
                // Handle endLine: -1 means end of file, undefined means same as startLine
                let actualEndLine: number;
                if (endLine === -1) {
                    // -1 means scan to end of file
                    actualEndLine = document.lineCount;
                    logger.info(`[list_code_actions_code] endLine=-1 resolved to line ${actualEndLine} (end of file)`);
                } else if (endLine === undefined) {
                    actualEndLine = startLine;
                } else {
                    actualEndLine = endLine;
                }
                
                // Validate actualEndLine is within document bounds
                if (actualEndLine < 1 || actualEndLine > document.lineCount) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Invalid endLine ${actualEndLine}. File has ${document.lineCount} lines (valid range: 1 to ${document.lineCount}, or -1 for end of file).`
                        }],
                        isError: true
                    };
                }
                
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
        
        Requires the requestId from list_code_actions_code (valid for 60 seconds) and the action index.
        Use applyAll=true to apply all quickfix actions in sequence (useful for fixing multiple similar issues).`,
        {
            requestId: z.string().describe('The request ID from list_code_actions_code'),
            index: z.number().optional().describe('The index of the action to apply (from the list). Required when applyAll=false, ignored when applyAll=true.'),
            applyAll: z.boolean().optional().default(false).describe('Apply all quickfix actions in sequence (default: false). When true, ignores index parameter.')
        },
        async ({ requestId, index, applyAll = false }): Promise<CallToolResult> => {
            logger.info(`[apply_code_action_code] Tool called with requestId="${requestId}", index=${index}, applyAll=${applyAll}`);
            
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
                    removeCachedActions(requestId);
                    return {
                        content: [{
                            type: 'text',
                            text: `Request ID "${requestId}" has expired (> 60 seconds). Please run list_code_actions_code again.`
                        }],
                        isError: true
                    };
                }
                
                // Track all affected URIs for cache invalidation and saving
                const affectedUris = new Set<string>();
                affectedUris.add(cached.uri.toString());
                
                let totalApplied = 0;
                let resultMessage = '';
                
                // Helper function to apply a single code action
                const applySingleAction = async (action: vscode.CodeAction, targetUri: vscode.Uri): Promise<{ applied: boolean; message: string }> => {
                    logger.info(`[apply_code_action_code] Applying action: ${action.title}`);
                    logger.info(`[apply_code_action_code] Action has edit: ${!!action.edit}, has command: ${!!action.command}`);
                    
                    let actionApplied = false;
                    let actionMessage = `Applying code action: "${action.title}"\n`;
                    
                    // For actions with only command, try to resolve to get the edit
                    if (!action.edit && action.command) {
                        logger.info(`[apply_code_action_code] Resolving code action to get edit...`);
                        try {
                            const resolvedAction = await vscode.commands.executeCommand<vscode.CodeAction>(
                                'vscode.resolveCodeAction',
                                action
                            );
                            if (resolvedAction && resolvedAction.edit) {
                                logger.info(`[apply_code_action_code] Resolved action has edit`);
                                action.edit = resolvedAction.edit;
                            }
                        } catch (resolveError) {
                            logger.warn(`[apply_code_action_code] Could not resolve code action: ${resolveError instanceof Error ? resolveError.message : String(resolveError)}`);
                        }
                    }
                    
                    // Apply workspace edit if present
                    if (action.edit) {
                        const editSuccess = await vscode.workspace.applyEdit(action.edit);
                        if (editSuccess) {
                            actionMessage += `Workspace edit applied successfully.\n`;
                            actionMessage += formatWorkspaceEditSummary(action.edit) + '\n';
                            actionApplied = true;
                            
                            // Track affected URIs
                            for (const [uri] of action.edit.entries()) {
                                affectedUris.add(uri.toString());
                            }
                            
                            // Save affected documents immediately to ensure consistency
                            await saveAffectedDocuments(action.edit);
                        } else {
                            actionMessage += `Failed to apply workspace edit.\n`;
                            logger.error(`[apply_code_action_code] Failed to apply workspace edit for action: ${action.title}`);
                        }
                    }
                    
                    // Execute command if present
                    if (action.command) {
                        try {
                            logger.info(`[apply_code_action_code] Executing command: ${action.command.command}`);
                            
                            // For TypeScript fix-all commands, we need special handling
                            // These commands modify documents directly without returning a WorkspaceEdit
                            const isTypescriptFixAll = action.command.command.includes('applyFixAllCodeAction') ||
                                action.command.command.includes('typescript') && action.command.command.includes('fix');
                            
                            // Get document version before command execution for change detection
                            const docBeforeCmd = await vscode.workspace.openTextDocument(targetUri);
                            const versionBefore = docBeforeCmd.version;
                            const contentBefore = docBeforeCmd.getText();
                            
                            const commandResult = await vscode.commands.executeCommand(
                                action.command.command,
                                ...(action.command.arguments || [])
                            );
                            
                            // Some commands return a WorkspaceEdit
                            if (commandResult && typeof commandResult === 'object' && 'size' in commandResult) {
                                const edit = commandResult as vscode.WorkspaceEdit;
                                if (edit.size > 0) {
                                    const editSuccess = await vscode.workspace.applyEdit(edit);
                                    if (editSuccess) {
                                        actionMessage += `Command returned workspace edit, applied successfully.\n`;
                                        actionMessage += formatWorkspaceEditSummary(edit) + '\n';
                                        actionApplied = true;
                                        
                                        // Track affected URIs and save
                                        for (const [uri] of edit.entries()) {
                                            affectedUris.add(uri.toString());
                                        }
                                        await saveAffectedDocuments(edit);
                                    }
                                }
                            }
                            
                            // For TypeScript fix-all commands, wait a bit and check if document changed
                            if (!actionApplied && isTypescriptFixAll) {
                                // Wait for VS Code to process the command
                                await new Promise(resolve => setTimeout(resolve, 100));
                                
                                // Check if document was modified by the command
                                const docAfterCmd = await vscode.workspace.openTextDocument(targetUri);
                                const versionAfter = docAfterCmd.version;
                                const contentAfter = docAfterCmd.getText();
                                
                                if (versionAfter !== versionBefore || contentAfter !== contentBefore) {
                                    actionMessage += `Command "${action.command.command}" applied changes to document.\n`;
                                    actionApplied = true;
                                    // Save the document after TypeScript command modifications
                                    await saveDocument(targetUri);
                                } else {
                                    // Command executed but no changes made (maybe nothing to fix)
                                    actionMessage += `Command "${action.command.command}" executed but no changes were made.\n`;
                                    logger.warn(`[apply_code_action_code] TypeScript fix-all command executed but document unchanged`);
                                    // Don't mark as applied if nothing changed
                                }
                            } else if (!actionApplied) {
                                actionMessage += `Command "${action.command.command}" executed successfully.\n`;
                                actionApplied = true;
                            }
                        } catch (cmdError) {
                            actionMessage += `Command execution failed: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}\n`;
                            logger.error(`[apply_code_action_code] Command execution failed: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}`);
                        }
                    }
                    
                    return { applied: actionApplied, message: actionMessage };
                };
                
                if (applyAll) {
                    // applyAll mode: Apply quickfix actions one by one, re-fetching after each
                    // This is necessary because applying one action changes the file content,
                    // which invalidates the position information of subsequent cached actions
                    const MAX_ITERATIONS = 50; // Safety limit to prevent infinite loops
                    let iteration = 0;
                    const targetUri = cached.uri;
                    const originalRange = cached.range;
                    
                    // Get initial count of quickfix actions, excluding dangerous ones
                    const allQuickfixes = cached.actions.filter(a => 
                        a.kind?.value?.startsWith('quickfix') || a.isPreferred
                    );
                    const dangerousCount = allQuickfixes.filter(a => isDangerousQuickfix(a)).length;
                    const safeQuickfixes = allQuickfixes.filter(a => !isDangerousQuickfix(a));
                    
                    if (safeQuickfixes.length === 0) {
                        let message = `No safe quickfix actions found to apply.`;
                        if (dangerousCount > 0) {
                            message += ` ${dangerousCount} potentially dangerous action(s) were filtered out (e.g., "Remove unused declaration" which might delete useful code like logging statements).`;
                            message += ` Use specific index to apply them individually if needed.`;
                        } else {
                            message += ` Available actions may be refactoring suggestions only.`;
                        }
                        return {
                            content: [{
                                type: 'text',
                                text: message
                            }],
                            isError: true
                        };
                    }
                    
                    logger.info(`[apply_code_action_code] applyAll mode: found ${safeQuickfixes.length} safe quickfix actions (${dangerousCount} dangerous filtered out)`);
                    resultMessage = `Applying quickfix actions (found ${safeQuickfixes.length} safe, ${dangerousCount} filtered as potentially dangerous):\n\n`;
                    
                    // Track processed action titles to avoid retrying them
                    // This includes both failed actions AND actions that executed but may not have changed the file
                    const processedActionTitles = new Set<string>();
                    
                    while (iteration < MAX_ITERATIONS) {
                        iteration++;
                        
                        // Re-fetch code actions with fresh position information
                        const document = await vscode.workspace.openTextDocument(targetUri);
                        
                        // Recalculate range based on current document
                        const endLine = Math.min(originalRange.end.line, document.lineCount - 1);
                        const endChar = document.lineAt(endLine).text.length;
                        const currentRange = new vscode.Range(
                            new vscode.Position(0, 0),  // Start from beginning
                            new vscode.Position(endLine, endChar)
                        );
                        
                        const freshActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                            'vscode.executeCodeActionProvider',
                            targetUri,
                            currentRange,
                            'quickfix'
                        ) || [];
                        
                        // Filter to quickfix actions only, excluding dangerous ones and previously processed ones
                        const quickfixActions = freshActions.filter(a => 
                            (a.kind?.value?.startsWith('quickfix') || a.isPreferred) &&
                            !isDangerousQuickfix(a) &&
                            !processedActionTitles.has(a.title)
                        );
                        
                        if (quickfixActions.length === 0) {
                            logger.info(`[apply_code_action_code] No more safe quickfix actions found, stopping`);
                            break;
                        }
                        
                        // Apply the first safe quickfix action
                        const actionToApply = quickfixActions[0];
                        const { applied, message } = await applySingleAction(actionToApply, targetUri);
                        
                        resultMessage += message + '\n';
                        
                        // Always track processed actions to avoid retrying them
                        // This prevents infinite loops when an action executes but doesn't change the file
                        processedActionTitles.add(actionToApply.title);
                        
                        if (applied) {
                            totalApplied++;
                            logger.info(`[apply_code_action_code] Action "${actionToApply.title}" applied successfully`);
                        } else {
                            logger.warn(`[apply_code_action_code] Action "${actionToApply.title}" failed to apply (${processedActionTitles.size} processed so far)`);
                        }
                        
                        // Small delay to allow VS Code to process changes
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                    if (iteration >= MAX_ITERATIONS) {
                        resultMessage += `\n⚠ Reached maximum iteration limit (${MAX_ITERATIONS}). Some actions may not have been applied.\n`;
                    }
                } else {
                    // Single action mode
                    // Validate index is provided for single action mode
                    if (index === undefined || index === null) {
                        return {
                            content: [{
                                type: 'text',
                                text: `index is required when applyAll is false`
                            }],
                            isError: true
                        };
                    }
                    
                    // Validate index range
                    if (index < 0 || index >= cached.actions.length) {
                        return {
                            content: [{
                                type: 'text',
                                text: `Invalid action index ${index}. Valid range: 0 to ${cached.actions.length - 1}`
                            }],
                            isError: true
                        };
                    }

                    const actionToApply = cached.actions[index];
                    const { applied, message } = await applySingleAction(actionToApply, cached.uri);
                    
                    resultMessage = message;
                    if (applied) {
                        totalApplied++;
                    }
                }
                
                // Invalidate cache for all affected files
                for (const uriString of affectedUris) {
                    invalidateCacheForUri(vscode.Uri.parse(uriString));
                }
                
                // Also remove the current request from cache
                removeCachedActions(requestId);
                
                // Force save the main document if not already saved
                await saveDocument(cached.uri);
                
                if (totalApplied > 0) {
                    if (applyAll) {
                        resultMessage += `\n✓ Successfully applied ${totalApplied} action(s).`;
                        resultMessage += `\n✓ All affected files have been saved to disk.`;
                        resultMessage += `\n✓ Cache has been invalidated for affected files.`;
                    }
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
                            text: `No actions were successfully applied.`
                        }],
                        isError: true
                    };
                }
            } catch (error) {
                logger.error(`[apply_code_action_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}
