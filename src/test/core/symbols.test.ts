/**
 * Core symbols operations unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    getDocumentSymbols,
    searchWorkspaceSymbols,
    findReferences,
    getDefinition,
    getSymbolHoverInfo
} from '../../core/lsp/symbols';

suite('Core Symbols Operations Tests', () => {
    
    suite('getDocumentSymbols', () => {
        test('should get symbols from TypeScript file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDocumentSymbols('src/server.ts');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data.symbols), 'Symbols should be an array');
            assert.ok(result.data.symbols.length > 0, 'Should have at least one symbol');
            
            // Should contain MCPServer class
            const classSymbol = result.data.symbols.find(s => 
                s.name === 'MCPServer' && s.kind === 'Class'
            );
            assert.ok(classSymbol, 'Should contain MCPServer class');
        });
        
        test('should return hierarchical symbols', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDocumentSymbols('src/server.ts');
            
            assert.ok(result.success, 'Should succeed');
            
            // Check for symbols with depth > 0 (nested symbols)
            const nestedSymbols = result.data!.symbols.filter(s => s.depth > 0);
            assert.ok(nestedSymbols.length > 0, 'Should have nested symbols (methods inside class)');
        });
        
        test('should respect maxDepth parameter', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDocumentSymbols('src/server.ts', 0);
            
            assert.ok(result.success, 'Should succeed');
            
            // All symbols should have depth 0
            const allDepthZero = result.data!.symbols.every(s => s.depth === 0);
            assert.ok(allDepthZero, 'All symbols should have depth 0 when maxDepth is 0');
        });
        
        test('should fail for non-existent file', async () => {
            const result = await getDocumentSymbols('non-existent-file.ts');
            
            assert.ok(!result.success, 'Should fail for non-existent file');
            assert.ok(result.error, 'Should have error message');
        });
        
        test('should return total count by kind', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDocumentSymbols('src/server.ts');
            
            assert.ok(result.success, 'Should succeed');
            assert.ok(result.data!.totalByKind, 'Should have totalByKind');
            assert.ok(typeof result.data!.total === 'number', 'Should have total count');
        });
    });
    
    suite('searchWorkspaceSymbols', () => {
        test('should search for symbols by name', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await searchWorkspaceSymbols('MCPServer');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data.symbols), 'Symbols should be an array');
            
            // Should find MCPServer
            const found = result.data.symbols.some(s => s.name.includes('MCPServer'));
            assert.ok(found, 'Should find MCPServer symbol');
        });
        
        test('should respect maxResults parameter', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const maxResults = 3;
            const result = await searchWorkspaceSymbols('', maxResults);
            
            assert.ok(result.success, 'Should succeed');
            assert.ok(result.data!.symbols.length <= maxResults, 
                `Should return at most ${maxResults} symbols`);
        });
        
        test('should return empty array for no matches', async () => {
            const result = await searchWorkspaceSymbols('xxxxxxNonExistentSymbolNamexxxxxx');
            
            assert.ok(result.success, 'Should succeed even with no matches');
            assert.strictEqual(result.data!.symbols.length, 0, 'Should return empty array');
        });
        
        test('should include file and location info', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await searchWorkspaceSymbols('MCPServer', 5);
            
            assert.ok(result.success, 'Should succeed');
            if (result.data!.symbols.length > 0) {
                const symbol = result.data!.symbols[0];
                assert.ok('file' in symbol, 'Should have file property');
                assert.ok('line' in symbol, 'Should have line property');
                assert.ok('character' in symbol, 'Should have character property');
            }
        });
    });
    
    suite('findReferences', () => {
        test('should find references to symbol', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Find references to MCPServer in server.ts
            // MCPServer class is defined on line 14 (export class MCPServer {)
            const result = await findReferences('src/server.ts', 14, undefined, 'MCPServer', true);
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data), 'References should be an array');
        });
        
        test('should return location info for each reference', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await findReferences('src/server.ts', 14, undefined, 'MCPServer', true);
            
            if (result.success && result.data && result.data.length > 0) {
                const ref = result.data[0];
                assert.ok('file' in ref, 'Should have file property');
                assert.ok('line' in ref, 'Should have line property');
                assert.ok('character' in ref, 'Should have character property');
                assert.ok('endLine' in ref, 'Should have endLine property');
                assert.ok('endCharacter' in ref, 'Should have endCharacter property');
            }
        });
        
        test('should return empty or error when symbol not found on line', async () => {
            const result = await findReferences('src/server.ts', 1, undefined, 'NonExistentSymbolXYZ', true);
            
            // Should either fail or return empty/error for non-existent symbol
            if (result.success) {
                assert.strictEqual(result.data!.length, 0, 'Should return empty array');
            } else {
                assert.ok(result.error, 'Should have error message');
            }
        });
    });
    
    suite('getDefinition', () => {
        test('should get definition location', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Use extension.ts which imports MCPServer
            const result = await getDefinition('src/extension.ts', 2, undefined, 'MCPServer');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data), 'Definitions should be an array');
        });
        
        test('should return file and range info', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDefinition('src/extension.ts', 2, undefined, 'MCPServer');
            
            if (result.success && result.data && result.data.length > 0) {
                const def = result.data[0];
                assert.ok('file' in def, 'Should have file property');
                assert.ok('line' in def, 'Should have line property');
                assert.ok('character' in def, 'Should have character property');
            }
        });
    });
    
    suite('getSymbolHoverInfo', () => {
        test('should get hover information', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Get hover info for MCPServer class (line 14: export class MCPServer {)
            const result = await getSymbolHoverInfo('src/server.ts', 14, 13);
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
        });
        
        test('should get hover info with symbol name', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getSymbolHoverInfo('src/server.ts', 14, undefined, 'MCPServer');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
        });
        
        test('should include contents in hover', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getSymbolHoverInfo('src/server.ts', 14, 13);
            
            if (result.success && result.data) {
                assert.ok('contents' in result.data || 'hovers' in result.data, 
                    'Should have contents or hovers property');
            }
        });
    });
});
