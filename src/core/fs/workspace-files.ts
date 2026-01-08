/**
 * Workspace Files - Core file system operations
 * Handles file listing and reading from the VS Code workspace
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { ServiceResult, getWorkspaceRoot } from '../common';

// ============================================
// Types
// ============================================

export interface FileEntry {
    path: string;
    type: 'file' | 'directory';
}

export type FileListingResult = FileEntry[];

// Default maximum character count
const DEFAULT_MAX_CHARACTERS = 100000;

// ============================================
// File Listing
// ============================================

/**
 * Lists files and directories in the VS Code workspace
 * @param workspacePath The path within the workspace to list files from
 * @param recursive Whether to list files recursively
 * @returns Array of file and directory entries
 */
export async function listWorkspaceFiles(
    workspacePath: string,
    recursive: boolean = false
): Promise<ServiceResult<FileListingResult>> {
    logger.info(`[listWorkspaceFiles] Starting with path: ${workspacePath}, recursive: ${recursive}`);
    
    try {
        if (!vscode.workspace.workspaceFolders) {
            return { success: false, error: 'No workspace folder is open' };
        }

        // Normalize workspacePath for consistent, cross-platform results:
        // - Treat '.' as workspace root
        // - Always return paths using forward slashes (POSIX style)
        const normalizedBase =
            workspacePath === '.' || workspacePath === './'
                ? ''
                : path.posix.normalize(workspacePath).replace(/^\.\/+/, '').replace(/\/+$/, '');

        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        
        // Create URI for the target directory
        const targetUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
        logger.info(`[listWorkspaceFiles] Target URI: ${targetUri.fsPath}`);

        async function processDirectory(dirUri: vscode.Uri, currentPath: string = ''): Promise<FileListingResult> {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            const result: FileListingResult = [];

            for (const [name, type] of entries) {
                const entryPath = currentPath ? path.posix.join(currentPath, name) : name;
                const itemType: 'file' | 'directory' = (type & vscode.FileType.Directory) ? 'directory' : 'file';
                
                const fullPath = normalizedBase ? path.posix.join(normalizedBase, entryPath) : entryPath;
                result.push({ path: fullPath, type: itemType });

                if (recursive && itemType === 'directory') {
                    const subDirUri = vscode.Uri.joinPath(dirUri, name);
                    const subEntries = await processDirectory(subDirUri, entryPath);
                    result.push(...subEntries);
                }
            }

            return result;
        }

        const result = await processDirectory(targetUri);
        logger.info(`[listWorkspaceFiles] Found ${result.length} entries`);
        
        return { success: true, data: result };
    } catch (error) {
        logger.error(`[listWorkspaceFiles] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ============================================
// File Reading
// ============================================

export interface ReadFileOptions {
    encoding?: string;
    maxCharacters?: number;
    startLine?: number;  // 0-based, -1 for beginning
    endLine?: number;    // 0-based, -1 for end
}

export interface ReadFileResult {
    content: string;
    length: number;
    linesRead?: { start: number; end: number };
}

/**
 * Reads a file from the VS Code workspace with character limit check
 * @param workspacePath The path within the workspace to the file
 * @param options Read options (encoding, maxCharacters, startLine, endLine)
 * @returns File content as string (either text-encoded or base64)
 */
export async function readWorkspaceFile(
    workspacePath: string,
    options: ReadFileOptions = {}
): Promise<ServiceResult<ReadFileResult>> {
    const {
        encoding = 'utf-8',
        maxCharacters = DEFAULT_MAX_CHARACTERS,
        startLine = -1,
        endLine = -1
    } = options;
    
    logger.info(`[readWorkspaceFile] Starting with path: ${workspacePath}, encoding: ${encoding}, maxCharacters: ${maxCharacters}, startLine: ${startLine}, endLine: ${endLine}`);
    
    try {
        if (!vscode.workspace.workspaceFolders) {
            return { success: false, error: 'No workspace folder is open' };
        }

        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        
        // Create URI for the target file
        const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
        logger.info(`[readWorkspaceFile] File URI: ${fileUri.fsPath}`);

        // Read the file content as Uint8Array
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        logger.info(`[readWorkspaceFile] File read successfully, size: ${fileContent.byteLength} bytes`);
        
        if (encoding === 'base64') {
            // Special case for base64 encoding
            if (fileContent.byteLength > maxCharacters) {
                return { success: false, error: `File content exceeds the maximum character limit (approx. ${fileContent.byteLength} bytes vs ${maxCharacters} allowed)` };
            }
            
            if (startLine >= 0 || endLine >= 0) {
                logger.warn(`[readWorkspaceFile] Line numbers specified for base64 encoding, ignoring`);
            }
            
            const content = Buffer.from(fileContent).toString('base64');
            return {
                success: true,
                data: { content, length: content.length }
            };
        } else {
            // Regular text encoding
            const textDecoder = new TextDecoder(encoding);
            const textContent = textDecoder.decode(fileContent);
            
            // Check if the character count exceeds the limit
            if (textContent.length > maxCharacters) {
                return { success: false, error: `File content exceeds the maximum character limit (${textContent.length} vs ${maxCharacters} allowed)` };
            }
            
            // If line numbers are specified and valid, extract just those lines
            if (startLine >= 0 || endLine >= 0) {
                const lines = textContent.split('\n');
                
                const effectiveStartLine = startLine >= 0 ? startLine : 0;
                const effectiveEndLine = endLine >= 0 ? Math.min(endLine, lines.length - 1) : lines.length - 1;
                
                if (effectiveStartLine >= lines.length) {
                    return { success: false, error: `Start line ${effectiveStartLine + 1} is out of range (1-${lines.length})` };
                }
                
                if (effectiveEndLine < effectiveStartLine) {
                    return { success: false, error: `End line ${effectiveEndLine + 1} is less than start line ${effectiveStartLine + 1}` };
                }
                
                const partialContent = lines.slice(effectiveStartLine, effectiveEndLine + 1).join('\n');
                logger.info(`[readWorkspaceFile] Returning lines ${effectiveStartLine + 1}-${effectiveEndLine + 1}, length: ${partialContent.length} characters`);
                
                return {
                    success: true,
                    data: {
                        content: partialContent,
                        length: partialContent.length,
                        linesRead: { start: effectiveStartLine + 1, end: effectiveEndLine + 1 }
                    }
                };
            }
            
            return {
                success: true,
                data: { content: textContent, length: textContent.length }
            };
        }
    } catch (error) {
        logger.error(`[readWorkspaceFile] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// Legacy function signature for backward compatibility
export async function listWorkspaceFilesLegacy(
    workspacePath: string,
    recursive: boolean = false
): Promise<FileListingResult> {
    const result = await listWorkspaceFiles(workspacePath, recursive);
    if (!result.success) {
        throw new Error(result.error);
    }
    return result.data!;
}
