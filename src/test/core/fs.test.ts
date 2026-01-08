/**
 * Core filesystem operations unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    listWorkspaceFiles,
    listWorkspaceFilesLegacy,
    readWorkspaceFile,
    FileEntry
} from '../../core/fs/workspace-files';

suite('Core Filesystem Operations Tests', () => {
    
    suite('listWorkspaceFiles', () => {
        test('should list files in workspace root', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listWorkspaceFiles('');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data), 'Data should be an array');
            assert.ok(result.data.length > 0, 'Should have at least one file');
            
            // Check structure
            const firstItem = result.data[0];
            assert.ok('path' in firstItem, 'Item should have path property');
            assert.ok('type' in firstItem, 'Item should have type property');
            assert.ok(firstItem.type === 'file' || firstItem.type === 'directory', 'Type should be file or directory');
        });
        
        test('should list files in src directory', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listWorkspaceFiles('src');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data!.length > 0, 'src directory should have files');
            
            // Should contain extension.ts and server.ts
            const paths = result.data!.map((r: FileEntry) => r.path);
            assert.ok(paths.some((p: string) => p.includes('extension.ts')), 'Should contain extension.ts');
            assert.ok(paths.some((p: string) => p.includes('server.ts')), 'Should contain server.ts');
        });
        
        test('should list files recursively', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const recursiveResult = await listWorkspaceFiles('src', true);
            const nonRecursiveResult = await listWorkspaceFiles('src', false);
            
            assert.ok(recursiveResult.success && nonRecursiveResult.success, 'Both should succeed');
            assert.ok(recursiveResult.data!.length >= nonRecursiveResult.data!.length, 
                'Recursive listing should have at least as many files');
            
            // Recursive should include nested files
            const paths = recursiveResult.data!.map((r: FileEntry) => r.path);
            assert.ok(paths.some((p: string) => p.includes('core/')), 'Should contain files from core subdirectory');
        });
        
        test('should fail for non-existent path', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listWorkspaceFiles('non-existent-directory-xyz');
            
            assert.ok(!result.success, 'Should fail for non-existent directory');
            assert.ok(result.error, 'Should have error message');
        });
    });
    
    suite('listWorkspaceFilesLegacy', () => {
        test('should return legacy format array', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listWorkspaceFilesLegacy('src', false);
            
            assert.ok(Array.isArray(result), 'Result should be an array');
            // Legacy format returns {path, type}
            if (result.length > 0) {
                assert.ok('path' in result[0], 'Should have path property');
                assert.ok('type' in result[0], 'Should have type property');
            }
        });
    });
    
    suite('readWorkspaceFile', () => {
        test('should read existing file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await readWorkspaceFile('package.json');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(typeof result.data.content === 'string', 'Content should be a string');
            assert.ok(result.data.content.length > 0, 'Content should not be empty');
            assert.ok(result.data.content.includes('"name"'), 'package.json should contain "name"');
        });
        
        test('should read with line range', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Read first 5 lines (0-based: 0-4)
            const result = await readWorkspaceFile('package.json', { startLine: 0, endLine: 4 });
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            const lines = result.data.content.split('\n');
            assert.ok(lines.length <= 6, 'Should have at most 5-6 lines'); // May include trailing newline
        });
        
        test('should fail for non-existent file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await readWorkspaceFile('non-existent-file-xyz.ts');
            
            assert.ok(!result.success, 'Should fail for non-existent file');
            assert.ok(result.error, 'Should have error message');
        });
        
        test('should respect maxCharacters limit', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const maxChars = 100;
            const result = await readWorkspaceFile('package.json', { maxCharacters: maxChars });
            
            // Either succeeds with content under limit, or fails with error
            if (result.success) {
                assert.ok(result.data!.content.length <= maxChars + 100, 
                    `Content length should be close to maxCharacters`);
            } else {
                assert.ok(result.error!.includes('exceeds'), 'Error should mention exceeds');
            }
        });
    });
});
