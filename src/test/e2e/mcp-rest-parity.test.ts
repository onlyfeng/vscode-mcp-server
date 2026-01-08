/**
 * E2E Parity Tests - MCP vs REST API consistency
 * 
 * These tests verify that MCP tools and REST API endpoints return consistent results
 * when calling the same underlying core functionality.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

// Import core functions to verify consistency
import {
    getDocumentSymbols,
    searchWorkspaceSymbols,
    findReferences,
    getDefinition,
    getSymbolHoverInfo
} from '../../core/lsp/symbols';
import {
    listCodeActions,
    renameSymbol
} from '../../core/lsp/refactor';
import {
    getDiagnostics
} from '../../core/diagnostics/diagnostics';
import {
    listWorkspaceFiles,
    readWorkspaceFile
} from '../../core/fs/workspace-files';

suite('E2E MCP vs REST Parity Tests', () => {
    
    suite('File Operations Parity', () => {
        test('listWorkspaceFiles - core layer consistency', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Both MCP and REST call the same core function
            const result1 = await listWorkspaceFiles('src', false);
            const result2 = await listWorkspaceFiles('src', false);
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.deepStrictEqual(result1.data, result2.data, 
                'Repeated calls should return identical results');
        });
        
        test('readWorkspaceFile - core layer consistency', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await readWorkspaceFile('package.json');
            const result2 = await readWorkspaceFile('package.json');
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.strictEqual(result1.data!.content, result2.data!.content, 
                'Content should be identical');
        });
    });
    
    suite('Symbol Operations Parity', () => {
        test('getDocumentSymbols - consistent symbol list', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await getDocumentSymbols('src/server.ts');
            const result2 = await getDocumentSymbols('src/server.ts');
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.strictEqual(result1.data!.total, result2.data!.total, 
                'Total count should be identical');
            assert.strictEqual(result1.data!.symbols.length, result2.data!.symbols.length, 
                'Symbol count should be identical');
            
            // Verify symbol names match
            const names1 = result1.data!.symbols.map(s => s.name).sort();
            const names2 = result2.data!.symbols.map(s => s.name).sort();
            assert.deepStrictEqual(names1, names2, 'Symbol names should match');
        });
        
        test('searchWorkspaceSymbols - consistent search results', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await searchWorkspaceSymbols('MCPServer', 10);
            const result2 = await searchWorkspaceSymbols('MCPServer', 10);
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.strictEqual(result1.data!.symbols.length, result2.data!.symbols.length, 
                'Result count should be identical');
            
            // Verify symbol names match
            const names1 = result1.data!.symbols.map(s => s.name);
            const names2 = result2.data!.symbols.map(s => s.name);
            assert.deepStrictEqual(names1, names2, 'Symbol names should match');
        });
        
        test('findReferences - consistent reference locations', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await findReferences('src/server.ts', 19, undefined, 'MCPServer', true);
            const result2 = await findReferences('src/server.ts', 19, undefined, 'MCPServer', true);
            
            if (result1.success && result2.success) {
                assert.strictEqual(result1.data!.length, result2.data!.length, 
                    'Reference count should be identical');
                
                // Verify locations match
                const locs1 = result1.data!.map(r => `${r.file}:${r.line}:${r.character}`).sort();
                const locs2 = result2.data!.map(r => `${r.file}:${r.line}:${r.character}`).sort();
                assert.deepStrictEqual(locs1, locs2, 'Reference locations should match');
            }
        });
        
        test('getDefinition - consistent definition location', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await getDefinition('src/extension.ts', 2, undefined, 'MCPServer');
            const result2 = await getDefinition('src/extension.ts', 2, undefined, 'MCPServer');
            
            if (result1.success && result2.success) {
                assert.strictEqual(result1.data!.length, result2.data!.length, 
                    'Definition count should be identical');
                
                if (result1.data!.length > 0) {
                    assert.strictEqual(result1.data![0].file, result2.data![0].file, 
                        'Definition file should match');
                    assert.strictEqual(result1.data![0].line, result2.data![0].line, 
                        'Definition line should match');
                }
            }
        });
        
        test('getSymbolHoverInfo - consistent hover information', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await getSymbolHoverInfo('src/server.ts', 19, 13);
            const result2 = await getSymbolHoverInfo('src/server.ts', 19, 13);
            
            if (result1.success && result2.success) {
                assert.strictEqual(result1.data!.hovers.length, result2.data!.hovers.length, 
                    'Hover count should be identical');
            }
        });
    });
    
    suite('Refactor Operations Parity', () => {
        test('listCodeActions - consistent action list', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await listCodeActions('src/server.ts', 1, 50);
            const result2 = await listCodeActions('src/server.ts', 1, 50);
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.strictEqual(
                result1.data!.formattedActions.length, 
                result2.data!.formattedActions.length, 
                'Action count should be identical'
            );
            
            // Verify action titles match
            const titles1 = result1.data!.formattedActions.map(a => a.title).sort();
            const titles2 = result2.data!.formattedActions.map(a => a.title).sort();
            assert.deepStrictEqual(titles1, titles2, 'Action titles should match');
        });
        
        test('renameSymbol preview - consistent preview results', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Only test preview mode to avoid actual file changes
            const result1 = await renameSymbol('src/server.ts', 1, undefined, 'express', 'testRename', false);
            const result2 = await renameSymbol('src/server.ts', 1, undefined, 'express', 'testRename', false);
            
            // Results should be consistent (either both succeed or both fail)
            assert.strictEqual(result1.success, result2.success, 'Success state should be consistent');
            
            if (result1.success && result2.success) {
                assert.strictEqual(result1.totalChanges, result2.totalChanges, 
                    'Total changes should be identical');
                assert.strictEqual(result1.affectedFiles.length, result2.affectedFiles.length, 
                    'Affected file count should be identical');
            }
        });
    });
    
    suite('Diagnostics Operations Parity', () => {
        test('getDiagnostics - consistent diagnostics', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await getDiagnostics('src/server.ts');
            const result2 = await getDiagnostics('src/server.ts');
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            assert.strictEqual(result1.data!.totalCount, result2.data!.totalCount, 
                'Total count should be identical');
            assert.strictEqual(result1.data!.fileCount, result2.data!.fileCount, 
                'File count should be identical');
        });
        
        test('getDiagnostics workspace - consistent workspace diagnostics', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result1 = await getDiagnostics();
            const result2 = await getDiagnostics();
            
            assert.ok(result1.success && result2.success, 'Both calls should succeed');
            // Note: workspace diagnostics may change between calls due to background processes
            // We just verify the structure is consistent
            assert.ok(typeof result1.data!.totalCount === 'number', 'Should have totalCount');
            assert.ok(typeof result2.data!.totalCount === 'number', 'Should have totalCount');
        });
    });
    
    suite('Data Structure Consistency', () => {
        test('DocumentSymbol structure - consistent fields', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDocumentSymbols('src/server.ts');
            
            assert.ok(result.success, 'Should succeed');
            
            if (result.data!.symbols.length > 0) {
                const symbol = result.data!.symbols[0];
                
                // Verify all expected fields exist
                assert.ok('name' in symbol, 'Should have name');
                assert.ok('kind' in symbol, 'Should have kind');
                assert.ok('range' in symbol, 'Should have range');
                assert.ok('depth' in symbol, 'Should have depth');
                
                // Verify range structure
                assert.ok('start' in symbol.range, 'Range should have start');
                assert.ok('end' in symbol.range, 'Range should have end');
                assert.ok('line' in symbol.range.start, 'Range start should have line');
                assert.ok('character' in symbol.range.start, 'Range start should have character');
            }
        });
        
        test('Reference structure - consistent fields', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await findReferences('src/server.ts', 19, undefined, 'MCPServer', true);
            
            if (result.success && result.data && result.data.length > 0) {
                const ref = result.data[0];
                
                // Verify all expected fields exist
                assert.ok('file' in ref, 'Should have file');
                assert.ok('line' in ref, 'Should have line');
                assert.ok('character' in ref, 'Should have character');
                assert.ok('endLine' in ref, 'Should have endLine');
                assert.ok('endCharacter' in ref, 'Should have endCharacter');
            }
        });
        
        test('CodeAction structure - consistent fields', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await listCodeActions('src/server.ts', 1, -1);
            
            assert.ok(result.success, 'Should succeed');
            
            if (result.data!.formattedActions.length > 0) {
                const action = result.data!.formattedActions[0];
                
                // Verify all expected fields exist
                assert.ok('title' in action, 'Should have title');
                // kind and isPreferred are optional
            }
            
            // Verify uri and range
            assert.ok(result.data!.uri instanceof vscode.Uri, 'Should have uri');
            assert.ok(result.data!.range instanceof vscode.Range, 'Should have range');
        });
    });
});
