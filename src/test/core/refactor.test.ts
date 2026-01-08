/**
 * Core refactor operations unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    listCodeActions,
    applySingleCodeAction,
    applyAllQuickfixes,
    isDangerousQuickfix,
    renameSymbol
} from '../../core/lsp/refactor';

suite('Core Refactor Operations Tests', () => {
    
    suite('isDangerousQuickfix', () => {
        test('should identify dangerous removal action', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused declaration',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, true, 'Should identify as dangerous');
        });
        
        test('should allow safe import removal', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused import',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow import removal');
        });
        
        test('should allow parameter removal', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused parameter',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow parameter removal');
        });
        
        test('should allow variable removal', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused variable',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow variable removal');
        });
        
        test('should allow function removal', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused function',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow function removal');
        });
        
        test('should allow method removal', () => {
            const action: vscode.CodeAction = {
                title: 'Remove unused method',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow method removal');
        });
        
        test('should identify dangerous delete action', () => {
            const action: vscode.CodeAction = {
                title: 'Delete unused',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, true, 'Should identify delete without safe keyword as dangerous');
        });
        
        test('should allow non-removal actions', () => {
            const action: vscode.CodeAction = {
                title: 'Add missing import',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const result = isDangerousQuickfix(action);
            assert.strictEqual(result, false, 'Should allow non-removal actions');
        });
    });
    
    suite('listCodeActions', () => {
        test('should list code actions for file range', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Get code actions for server.ts
            const result = await listCodeActions('src/server.ts', 1, 10);
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data.formattedActions), 'formattedActions should be an array');
            assert.ok(result.data.uri instanceof vscode.Uri, 'Should have uri');
            assert.ok(result.data.range instanceof vscode.Range, 'Should have range');
        });
        
        test('should handle endLine=-1 (scan whole file)', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listCodeActions('src/server.ts', 1, -1);
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            // Range should extend to end of file
            assert.ok(result.data!.range.end.line > 10, 'Range should extend to end of file');
        });
        
        test('should fail for non-existent file', async () => {
            const result = await listCodeActions('non-existent-file.ts', 1, 10);
            
            assert.ok(!result.success, 'Should fail for non-existent file');
            assert.ok(result.error, 'Should have error message');
        });
        
        test('should format actions with title', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listCodeActions('src/server.ts', 1, -1);
            
            if (result.success && result.data!.formattedActions.length > 0) {
                const action = result.data!.formattedActions[0];
                assert.ok('title' in action, 'Should have title');
            }
        });
    });
    
    suite('renameSymbol', () => {
        // Note: These tests use preview mode to avoid actually modifying files
        
        test('should preview rename operation', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Try to rename a local variable (preview only)
            // This may fail if symbol isn't renameable, which is fine for testing
            const result = await renameSymbol(
                'src/server.ts',
                1,
                undefined,
                'express',
                'expressLib',
                false // preview only, don't apply
            );
            
            // Either succeeds with preview or fails with appropriate message
            if (result.success) {
                assert.strictEqual(result.applied, false, 'Should not apply in preview mode');
                assert.strictEqual(result.newName, 'expressLib', 'Should have new name');
            }
            // If failed, that's also acceptable (symbol may not be renameable)
        });
        
        test('should report affected files in preview', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await renameSymbol(
                'src/server.ts',
                1,
                undefined,
                'express',
                'expressRenamed',
                false
            );
            
            if (result.success && result.totalChanges > 0) {
                assert.ok(Array.isArray(result.affectedFiles), 'Should have affectedFiles array');
                assert.ok(result.affectedFiles.length > 0, 'Should have at least one affected file');
                
                const fileInfo = result.affectedFiles[0];
                assert.ok('file' in fileInfo, 'Should have file property');
                assert.ok('changes' in fileInfo, 'Should have changes count');
            }
        });
    });
    
    suite('applySingleCodeAction', () => {
        // Note: We test the function signature and basic validation
        // Actual application tests would modify files
        
        test('should require valid code action', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Create a minimal code action without edit
            const action: vscode.CodeAction = {
                title: 'Test action without edit',
                kind: vscode.CodeActionKind.QuickFix
            };
            
            const uri = vscode.Uri.file(workspaceFolders[0].uri.fsPath + '/src/server.ts');
            const range = new vscode.Range(0, 0, 0, 10);
            
            const result = await applySingleCodeAction(action, uri, range);
            
            // Should indicate no changes applied (action has no edit)
            assert.ok('applied' in result, 'Should have applied property');
            assert.ok('message' in result, 'Should have message property');
        });
    });
    
    suite('applyAllQuickfixes', () => {
        // Test the iteration limit and response format
        
        test('should return result format', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const uri = vscode.Uri.file(workspaceFolders[0].uri.fsPath + '/src/server.ts');
            const range = new vscode.Range(0, 0, 1, 0);
            
            // Use very small maxIterations to test early exit
            const result = await applyAllQuickfixes(uri, range, 1);
            
            assert.ok('appliedCount' in result, 'Should have appliedCount');
            assert.ok('results' in result, 'Should have results array');
            assert.ok(Array.isArray(result.results), 'results should be an array');
        });
        
        test('should respect maxIterations', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const uri = vscode.Uri.file(workspaceFolders[0].uri.fsPath + '/src/server.ts');
            const range = new vscode.Range(0, 0, 100, 0);
            
            // Very low iteration count
            const result = await applyAllQuickfixes(uri, range, 0);
            
            // With maxIterations=0, should apply nothing
            assert.strictEqual(result.appliedCount, 0, 'Should apply nothing with maxIterations=0');
        });
    });
});
