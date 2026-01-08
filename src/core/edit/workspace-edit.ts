/**
 * Workspace Edit - Core file editing operations
 * Handles file creation and line replacement using VS Code WorkspaceEdit API
 */

import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { ServiceResult } from '../common';

// ============================================
// Types
// ============================================

export interface CreateFileOptions {
    overwrite?: boolean;
    ignoreIfExists?: boolean;
}

export interface CreateFileResult {
    path: string;
    created: boolean;
}

export interface ReplaceLineOptions {
    startLine: number;   // 0-based
    endLine: number;     // 0-based, -1 for end of file
    content: string;
    originalCode: string;
}

export interface ReplaceLineResult {
    path: string;
    linesReplaced: { start: number; end: number };
}

// ============================================
// File Creation
// ============================================

/**
 * Check if a file exists at the given URI
 */
async function fileExistsAtUri(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a new file in the VS Code workspace using WorkspaceEdit
 * @param workspacePath The path within the workspace to the file
 * @param content The content to write to the file
 * @param options Create options (overwrite, ignoreIfExists)
 * @returns Promise that resolves with creation result
 */
export async function createWorkspaceFile(
    workspacePath: string,
    content: string,
    options: CreateFileOptions = {}
): Promise<ServiceResult<CreateFileResult>> {
    const { overwrite = false, ignoreIfExists = false } = options;
    
    logger.info(`[createWorkspaceFile] Starting with path: ${workspacePath}, overwrite: ${overwrite}, ignoreIfExists: ${ignoreIfExists}`);
    
    try {
        if (!vscode.workspace.workspaceFolders) {
            return { success: false, error: 'No workspace folder is open' };
        }

        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        
        // Create URI for the target file
        const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
        logger.info(`[createWorkspaceFile] File URI: ${fileUri.fsPath}`);

        // Check if file already exists
        const exists = await fileExistsAtUri(fileUri);
        
        // Handle ignoreIfExists case: if file exists and ignoreIfExists is true, return success
        if (exists && ignoreIfExists && !overwrite) {
            logger.info(`[createWorkspaceFile] File exists and ignoreIfExists=true, returning success`);
            return {
                success: true,
                data: { path: workspacePath, created: false }
            };
        }

        // Create a WorkspaceEdit
        const workspaceEdit = new vscode.WorkspaceEdit();
        
        // Convert content to Uint8Array
        const contentBuffer = new TextEncoder().encode(content);
        
        // Add createFile operation to the edit
        workspaceEdit.createFile(fileUri, {
            contents: contentBuffer,
            overwrite: overwrite,
            ignoreIfExists: ignoreIfExists
        });
        
        // Apply the edit
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        
        if (success) {
            logger.info(`[createWorkspaceFile] File created successfully: ${fileUri.fsPath}`);
            
            // Open the document to trigger linting
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
            logger.info(`[createWorkspaceFile] File opened in editor`);
            
            return {
                success: true,
                data: { path: workspacePath, created: true }
            };
        } else {
            return { success: false, error: `Failed to create file: ${fileUri.fsPath}` };
        }
    } catch (error) {
        logger.error(`[createWorkspaceFile] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// Line Replacement
// ============================================

/**
 * Replaces specific lines in a file in the VS Code workspace
 * @param workspacePath The path within the workspace to the file
 * @param options Replace options (startLine, endLine, content, originalCode)
 * @returns Promise that resolves with replacement result
 */
export async function replaceWorkspaceFileLines(
    workspacePath: string,
    options: ReplaceLineOptions
): Promise<ServiceResult<ReplaceLineResult>> {
    const { startLine, endLine, content, originalCode } = options;
    
    logger.info(`[replaceWorkspaceFileLines] Starting with path: ${workspacePath}, lines: ${startLine}-${endLine}`);
    
    try {
        if (!vscode.workspace.workspaceFolders) {
            return { success: false, error: 'No workspace folder is open' };
        }

        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        
        // Create URI for the target file
        const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
        logger.info(`[replaceWorkspaceFileLines] File URI: ${fileUri.fsPath}`);

        // Open the document
        const document = await vscode.workspace.openTextDocument(fileUri);
        
        // Handle endLine: -1 means end of file
        const actualEndLine = endLine === -1 ? document.lineCount - 1 : endLine;
        if (endLine === -1) {
            logger.info(`[replaceWorkspaceFileLines] endLine=-1 resolved to line ${actualEndLine + 1} (end of file)`);
        }
        
        // Validate line numbers
        if (startLine < 0 || startLine >= document.lineCount) {
            return { success: false, error: `Start line ${startLine + 1} is out of range (1-${document.lineCount})` };
        }
        if (actualEndLine < startLine || actualEndLine >= document.lineCount) {
            return { success: false, error: `End line ${actualEndLine + 1} is out of range (${startLine + 1}-${document.lineCount})` };
        }
        
        // Get the current content of the lines
        const currentLines = [];
        for (let i = startLine; i <= actualEndLine; i++) {
            currentLines.push(document.lineAt(i).text);
        }
        const currentContent = currentLines.join('\n');
        
        // Compare with the provided original code
        if (currentContent !== originalCode) {
            return { success: false, error: 'Original code validation failed. The current content does not match the provided original code.' };
        }
        
        // Create a range for the lines to replace
        const startPos = new vscode.Position(startLine, 0);
        const endPos = new vscode.Position(actualEndLine, document.lineAt(actualEndLine).text.length);
        const range = new vscode.Range(startPos, endPos);
        
        // Get the active text editor or show the document
        let editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== fileUri.toString()) {
            editor = await vscode.window.showTextDocument(document);
        }
        
        // Apply the edit
        const success = await editor.edit((editBuilder) => {
            editBuilder.replace(range, content);
        });
        
        if (success) {
            logger.info(`[replaceWorkspaceFileLines] Lines replaced successfully`);
            
            // Save the document to persist changes
            await document.save();
            logger.info(`[replaceWorkspaceFileLines] Document saved`);
            
            return {
                success: true,
                data: {
                    path: workspacePath,
                    linesReplaced: { start: startLine + 1, end: actualEndLine + 1 }
                }
            };
        } else {
            return { success: false, error: `Failed to replace lines in file: ${fileUri.fsPath}` };
        }
    } catch (error) {
        logger.error(`[replaceWorkspaceFileLines] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
