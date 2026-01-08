/**
 * Refactor Service - Core refactoring logic shared by MCP tools and REST API
 * Handles code actions, rename, and workspace edits
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
    validateLineRange,
    saveDocument,
    saveAffectedDocuments,
    ServiceResult
} from './common';

// ============================================
// Types
// ============================================

export interface CodeActionInfo {
    index: number;
    title: string;
    kind: string | null;
    isPreferred: boolean;
    diagnostics: string[];
}

export interface ListCodeActionsResult {
    actions: vscode.CodeAction[];
    formattedActions: CodeActionInfo[];
    uri: vscode.Uri;
    range: vscode.Range;
}

export interface ApplyActionResult {
    applied: boolean;
    message: string;
    affectedUris?: string[];
}

export interface RenamePreview {
    affectedFiles: { file: string; changes: number }[];
    totalChanges: number;
}

export interface RenameResult {
    success: boolean;
    applied: boolean;
    newName: string;
    affectedFiles: { file: string; changes: number }[];
    totalChanges: number;
    error?: string;
}

// ============================================
// Code Actions
// ============================================

/**
 * Get code actions for a file range
 * @param filePath Path to the file (relative or absolute)
 * @param startLine Start line (1-based)
 * @param endLine End line (1-based, -1 for end of file)
 * @param startCharacter Start character (0-based, default: 0)
 * @param endCharacter End character (0-based, default: end of line)
 * @param onlyKinds Filter by code action kinds
 * @param includeSourceActions Include source actions like organize imports
 */
export async function listCodeActions(
    filePath: string,
    startLine: number,
    endLine?: number,
    startCharacter: number = 0,
    endCharacter?: number,
    onlyKinds?: string[],
    includeSourceActions: boolean = false
): Promise<ServiceResult<ListCodeActionsResult>> {
    logger.info(`[listCodeActions] path="${filePath}", range=${startLine}:${startCharacter}-${endLine || startLine}:${endCharacter}`);
    
    try {
        const uri = resolveToUri(filePath);
        
        if (!await fileExists(uri)) {
            return { success: false, error: `File not found: ${filePath}` };
        }
        
        const document = await openDocument(uri);
        
        // Handle empty files
        if (document.lineCount === 0) {
            const emptyRange = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0)
            );
            return {
                success: true,
                data: {
                    actions: [],
                    formattedActions: [],
                    uri,
                    range: emptyRange
                }
            };
        }
        
        // Validate line numbers
        const actualEndLine = (endLine === undefined || endLine === -1) ? document.lineCount : endLine;
        const rangeError = validateLineRange(startLine, actualEndLine, document.lineCount);
        if (rangeError) {
            return { success: false, error: rangeError };
        }
        
        const actualEndChar = endCharacter ?? document.lineAt(actualEndLine - 1).text.length;
        
        const range = new vscode.Range(
            new vscode.Position(startLine - 1, startCharacter),
            new vscode.Position(actualEndLine - 1, actualEndChar)
        );
        
        // Determine primary kind filter
        const primaryKind = onlyKinds && onlyKinds.length > 0 ? onlyKinds[0] : undefined;
        
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
        
        logger.info(`[listCodeActions] Found ${actions.length} code actions`);
        
        // Format actions
        const formattedActions: CodeActionInfo[] = actions.map((action, index) => ({
            index,
            title: action.title,
            kind: action.kind?.value || null,
            isPreferred: action.isPreferred || false,
            diagnostics: action.diagnostics?.map(d => d.message) || []
        }));
        
        return {
            success: true,
            data: {
                actions,
                formattedActions,
                uri,
                range
            }
        };
    } catch (error) {
        logger.error(`[listCodeActions] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Apply a single code action
 * @param action The code action to apply
 * @param targetUri The target file URI
 */
export async function applySingleCodeAction(
    action: vscode.CodeAction,
    targetUri: vscode.Uri,
    originalRange?: vscode.Range
): Promise<ApplyActionResult> {
    logger.info(`[applySingleCodeAction] Applying action: ${action.title}`);
    
    let actionApplied = false;
    let actionMessage = `Applying code action: "${action.title}"\n`;
    const affectedUris: string[] = [targetUri.toString()];
    const actionKind = action.kind?.value || '';
    const actionTitle = action.title.toLowerCase();
    const commandName = action.command?.command || '';
    const isFixAllAction =
        actionKind.startsWith('source.fixAll') ||
        actionKind.startsWith('refactor.fixAll') ||
        commandName.includes('fixAll') ||
        actionTitle.includes('fix all') ||
        actionTitle.includes('all unused');
    logger.info(`[applySingleCodeAction] Action "${action.title}" classified as fixAll=${isFixAllAction} (kind="${actionKind}", command="${commandName}")`);
    actionMessage += `kind=${actionKind || 'n/a'}, command=${commandName || 'n/a'}, fixAllCandidate=${isFixAllAction}\n`;
    
    try {
        // Resolve action if needed (for actions with only command)
        if (!action.edit && action.command) {
            logger.info(`[applySingleCodeAction] Resolving code action to get edit...`);
            try {
                const resolvedAction = await vscode.commands.executeCommand<vscode.CodeAction>(
                    'vscode.resolveCodeAction',
                    action
                );
                if (resolvedAction?.edit) {
                    logger.info(`[applySingleCodeAction] Resolved action has edit`);
                    action.edit = resolvedAction.edit;
                }
            } catch (resolveError) {
                logger.warn(`[applySingleCodeAction] Could not resolve code action: ${resolveError instanceof Error ? resolveError.message : String(resolveError)}`);
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
                    affectedUris.push(uri.toString());
                }
                
                // Save affected documents
                await saveAffectedDocuments(action.edit);
            } else {
                actionMessage += `Failed to apply workspace edit.\n`;
                logger.error(`[applySingleCodeAction] Failed to apply workspace edit for action: ${action.title}`);
            }
        }
        
        // Execute command if present
        if (action.command) {
            try {
                logger.info(`[applySingleCodeAction] Executing command: ${action.command.command}`);
                
                const isTypescriptFixAll = action.command.command.includes('applyFixAllCodeAction') ||
                    (action.command.command.includes('typescript') && action.command.command.includes('fix'));
                
                // Get document version before command execution
                const docBeforeCmd = await openDocument(targetUri);
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
                            
                            for (const [uri] of edit.entries()) {
                                affectedUris.push(uri.toString());
                            }
                            await saveAffectedDocuments(edit);
                        }
                    }
                }
                
                // For TypeScript fix-all commands, check if document changed
                if (!actionApplied && isTypescriptFixAll) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const docAfterCmd = await openDocument(targetUri);
                    const versionAfter = docAfterCmd.version;
                    const contentAfter = docAfterCmd.getText();
                    
                    if (versionAfter !== versionBefore || contentAfter !== contentBefore) {
                        actionMessage += `Command "${action.command.command}" applied changes to document.\n`;
                        actionApplied = true;
                        await saveDocument(targetUri);
                    } else {
                        actionMessage += `Command "${action.command.command}" executed but no changes were made.\n`;
                        logger.warn(`[applySingleCodeAction] TypeScript fix-all command executed but document unchanged`);
                    }
                } else if (!actionApplied) {
                    actionMessage += `Command "${action.command.command}" executed successfully.\n`;
                    actionApplied = true;
                }
            } catch (cmdError) {
                actionMessage += `Command execution failed: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}\n`;
                logger.error(`[applySingleCodeAction] Command execution failed: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}`);
            }
        }
        
        // Fallback for fix-all actions that produced no edits (common for some language servers)
        if (!actionApplied && isFixAllAction && originalRange) {
            actionMessage += `Fix-all provider returned no edits. Falling back to sequential quickfix sweep.\n`;
            const fallbackResult = await applyAllQuickfixes(targetUri, originalRange);
            if (fallbackResult.results.length > 0) {
                actionMessage += fallbackResult.results.join('\n') + '\n';
            }
            if (fallbackResult.appliedCount > 0) {
                actionApplied = true;
                actionMessage += `Fallback quickfix sweep applied ${fallbackResult.appliedCount} action(s).\n`;
            } else if (fallbackResult.reachedLimit) {
                actionMessage += `Fallback quickfix sweep reached safety iteration limit without completing all actions.\n`;
            } else {
                actionMessage += `No quickfix actions were available during fallback sweep.\n`;
            }
        }
        
        return { applied: actionApplied, message: actionMessage, affectedUris };
    } catch (error) {
        logger.error(`[applySingleCodeAction] Error: ${error}`);
        return { applied: false, message: `Error: ${error}` };
    }
}

/**
 * Check if a code action is potentially dangerous (might remove useful code)
 * These actions should be skipped in applyAll mode to avoid unintended code removal
 * @param action The code action to check
 * @returns true if the action should be filtered out in applyAll mode
 */
export function isDangerousQuickfix(action: vscode.CodeAction): boolean {
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
 * Apply all quickfix actions for a file, re-fetching after each application
 * This prevents position invalidation issues when multiple actions are applied
 * @param targetUri The target file URI
 * @param originalRange The original range to scan
 * @param maxIterations Maximum number of iterations (safety limit)
 * @param onlyPreferred When true, only apply actions marked as isPreferred (default: false)
 */
export async function applyAllQuickfixes(
    targetUri: vscode.Uri,
    originalRange: vscode.Range,
    maxIterations: number = 50,
    onlyPreferred: boolean = false
): Promise<{ appliedCount: number; results: string[]; reachedLimit: boolean }> {
    logger.info(`[applyAllQuickfixes] Starting for ${targetUri.fsPath}, onlyPreferred=${onlyPreferred}`);
    
    let appliedCount = 0;
    const results: string[] = [];
    let iteration = 0;
    
    // Track failed action titles to avoid infinite retry loops
    // Note: We only track failures because the same title (e.g., "Prefix 'req' with an underscore")
    // may apply to multiple different positions in the file
    const failedActionTitles = new Set<string>();
    
    while (iteration < maxIterations) {
        iteration++;
        
        // Re-fetch code actions with fresh position information
        const document = await openDocument(targetUri);
        
        // Handle empty documents - no code actions possible
        if (document.lineCount === 0) {
            logger.info(`[applyAllQuickfixes] Document is empty, no actions possible`);
            break;
        }
        
        // Recalculate range based on current document
        const endLine = Math.min(originalRange.end.line, document.lineCount - 1);
        const endChar = document.lineAt(endLine).text.length;
        const currentRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(endLine, endChar)
        );
        
        // Don't specify kind='quickfix' here - doing so may cause TypeScript LS to return
        // different isPreferred values than when listing without kind filter.
        // We filter by kind in the next step instead.
        const freshActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            targetUri,
            currentRange
            // No kind parameter - filter afterward to preserve isPreferred accuracy
        ) || [];
        
        // Filter to quickfix actions only, excluding dangerous ones and previously failed ones
        // When onlyPreferred is true, only include actions marked as isPreferred
        const quickfixActions = freshActions.filter(a =>
            a.kind?.value?.startsWith('quickfix') &&
            !isDangerousQuickfix(a) &&
            !failedActionTitles.has(a.title) &&
            (!onlyPreferred || a.isPreferred === true)
        );
        
        if (quickfixActions.length === 0) {
            logger.info(`[applyAllQuickfixes] No more safe quickfix actions found, stopping`);
            break;
        }
        
        // Apply the first safe quickfix action
        const actionToApply = quickfixActions[0];
        const { applied, message } = await applySingleCodeAction(actionToApply, targetUri, originalRange);
        
        results.push(message);
        
        if (applied) {
            appliedCount++;
            logger.info(`[applyAllQuickfixes] Action "${actionToApply.title}" applied successfully`);
            // Don't track successful actions - same title may need to be applied at other positions
        } else {
            // Only track failed actions to prevent infinite retry loops
            failedActionTitles.add(actionToApply.title);
            logger.warn(`[applyAllQuickfixes] Action "${actionToApply.title}" failed to apply, will skip this title in future iterations`);
        }
        
        // Small delay to allow VS Code to process changes
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const reachedLimit = iteration >= maxIterations;
    if (reachedLimit) {
        results.push(`Warning: Reached maximum iteration limit (${maxIterations})`);
    }
    
    return { appliedCount, results, reachedLimit };
}

// ============================================
// Rename
// ============================================

/**
 * Rename a symbol across the workspace
 * @param filePath Path to the file containing the symbol
 * @param line Line number (1-based)
 * @param character Character position (0-based), or undefined to search for symbol
 * @param symbol Symbol name to search for (if character not provided)
 * @param newName New name for the symbol
 * @param apply Whether to apply the rename or just preview
 */
export async function renameSymbol(
    filePath: string,
    line: number,
    character: number | undefined,
    symbol: string | undefined,
    newName: string,
    apply: boolean = true
): Promise<RenameResult> {
    logger.info(`[renameSymbol] path="${filePath}", line=${line}, newName="${newName}", apply=${apply}`);
    
    try {
        const uri = resolveToUri(filePath);
        
        if (!await fileExists(uri)) {
            return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: `File not found: ${filePath}` };
        }
        
        const document = await openDocument(uri);
        
        // Validate line number
        const lineError = validateLineNumber(line, document.lineCount);
        if (lineError) {
            return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: lineError };
        }
        
        // Determine character position
        let charPosition = character;
        if (charPosition === undefined) {
            if (!symbol) {
                return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: 'Either character position or symbol name must be provided' };
            }
            const lineText = await getLineText(uri, line - 1);
            if (lineText === undefined) {
                return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: `Line ${line} not found in file: ${filePath}` };
            }
            charPosition = findSymbolInLine(lineText, symbol);
            if (charPosition === -1) {
                return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: `Symbol "${symbol}" not found on line ${line}` };
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
                return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: `Cannot rename symbol at ${filePath}:${line}:${charPosition}. The symbol may not be renameable.` };
            }
            logger.info(`[renameSymbol] Prepare rename succeeded`);
        } catch (prepareError) {
            logger.warn(`[renameSymbol] Prepare rename failed: ${prepareError instanceof Error ? prepareError.message : String(prepareError)}`);
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
            return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: 'No rename edits generated. Symbol may not be renameable or no changes needed.' };
        }
        
        // Format affected files
        const affectedFiles: { file: string; changes: number }[] = [];
        for (const [editUri, edits] of workspaceEdit.entries()) {
            affectedFiles.push({
                file: uriToWorkspacePath(editUri),
                changes: edits.length
            });
        }
        const totalChanges = affectedFiles.reduce((sum, f) => sum + f.changes, 0);
        
        if (apply) {
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            if (!success) {
                return { success: false, applied: false, newName, affectedFiles, totalChanges, error: 'Failed to apply rename' };
            }
            
            // Save affected documents
            await saveAffectedDocuments(workspaceEdit);
            
            logger.info(`[renameSymbol] Rename applied successfully`);
            return { success: true, applied: true, newName, affectedFiles, totalChanges };
        } else {
            // Preview only
            return { success: true, applied: false, newName, affectedFiles, totalChanges };
        }
    } catch (error) {
        logger.error(`[renameSymbol] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, applied: false, newName, affectedFiles: [], totalChanges: 0, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format WorkspaceEdit to a readable summary
 */
export function formatWorkspaceEditSummary(edit: vscode.WorkspaceEdit): string {
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
