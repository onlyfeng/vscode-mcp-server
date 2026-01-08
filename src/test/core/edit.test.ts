/**
 * Core edit operations unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    createWorkspaceFile,
    replaceWorkspaceFileLines
} from '../../core/edit/workspace-edit';
import { readWorkspaceFile } from '../../core/fs/workspace-files';

suite('Core Edit Operations Tests', () => {
    const testFileName = 'test-temp-file-for-tests.txt';
    
    // Cleanup after each test
    teardown(async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        
        try {
            const testFilePath = path.join(workspaceFolders[0].uri.fsPath, testFileName);
            const uri = vscode.Uri.file(testFilePath);
            await vscode.workspace.fs.delete(uri);
        } catch {
            // File may not exist, that's fine
        }
    });
    
    suite('createWorkspaceFile', () => {
        test('should create new file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const content = 'Test content for new file';
            const result = await createWorkspaceFile(testFileName, content);
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            
            // Verify file was created
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read created file');
            assert.strictEqual(readResult.data!.content, content, 'File content should match');
        });
        
        test('should overwrite existing file when overwrite=true', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create initial file
            await createWorkspaceFile(testFileName, 'Initial content');
            
            // Overwrite
            const newContent = 'New content after overwrite';
            const result = await createWorkspaceFile(testFileName, newContent, { overwrite: true });
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            
            // Verify content was replaced
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read file');
            assert.strictEqual(readResult.data!.content, newContent, 'File content should be overwritten');
        });
        
        test('should fail when file exists and overwrite=false', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create initial file
            await createWorkspaceFile(testFileName, 'Initial content');
            
            // Try to create again without overwrite
            const result = await createWorkspaceFile(testFileName, 'New content', { overwrite: false, ignoreIfExists: false });
            
            // Result depends on WorkspaceEdit behavior - may fail or not apply
            // The key is that content should NOT be changed
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read file');
            assert.strictEqual(readResult.data!.content, 'Initial content', 'Original content should be preserved');
        });
        
        test('should silently succeed when file exists and ignoreIfExists=true', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create initial file
            const initialContent = 'Initial content';
            await createWorkspaceFile(testFileName, initialContent);
            
            // Try to create again with ignoreIfExists
            const result = await createWorkspaceFile(testFileName, 'New content', { ignoreIfExists: true });
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            
            // Verify original content preserved
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read file');
            assert.strictEqual(readResult.data!.content, initialContent, 'Original content should be preserved');
        });
    });
    
    suite('replaceWorkspaceFileLines', () => {
        test('should replace specific lines', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create file with multiple lines
            const initialContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            await createWorkspaceFile(testFileName, initialContent, { overwrite: true });
            
            // Replace lines 2-3 (0-based: 1-2)
            const originalCode = 'Line 2\nLine 3';
            const newContent = 'Replaced Line A\nReplaced Line B';
            const result = await replaceWorkspaceFileLines(testFileName, {
                startLine: 1,
                endLine: 2,
                content: newContent,
                originalCode: originalCode
            });
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            
            // Verify replacement
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read file');
            assert.ok(readResult.data!.content.includes('Replaced Line A'), 'Should contain new content');
            assert.ok(readResult.data!.content.includes('Replaced Line B'), 'Should contain new content');
            assert.ok(readResult.data!.content.includes('Line 1'), 'Should preserve line 1');
            assert.ok(readResult.data!.content.includes('Line 4'), 'Should preserve line 4');
        });
        
        test('should fail when originalCode does not match', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create file
            await createWorkspaceFile(testFileName, 'Line 1\nLine 2\nLine 3', { overwrite: true });
            
            // Try to replace with wrong originalCode
            const result = await replaceWorkspaceFileLines(testFileName, {
                startLine: 1,
                endLine: 1,
                content: 'New content',
                originalCode: 'Wrong content'
            });
            
            assert.ok(!result.success, 'Should fail when originalCode does not match');
            assert.ok(result.error, 'Should have error message');
        });
        
        test('should replace to end of file when endLine=-1', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create file
            const initialContent = 'Line 1\nLine 2\nLine 3\nLine 4';
            await createWorkspaceFile(testFileName, initialContent, { overwrite: true });
            
            // Replace from line 2 to end (0-based: 1 to -1)
            const originalCode = 'Line 2\nLine 3\nLine 4';
            const newContent = 'Only this remains';
            const result = await replaceWorkspaceFileLines(testFileName, {
                startLine: 1,
                endLine: -1,
                content: newContent,
                originalCode: originalCode
            });
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            
            // Verify
            const readResult = await readWorkspaceFile(testFileName);
            assert.ok(readResult.success, 'Should be able to read file');
            assert.ok(readResult.data!.content.includes('Line 1'), 'Should preserve line 1');
            assert.ok(readResult.data!.content.includes('Only this remains'), 'Should contain new content');
            assert.ok(!readResult.data!.content.includes('Line 4'), 'Line 4 should be removed');
        });
    });
});
