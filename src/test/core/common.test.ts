/**
 * Core common utilities unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    resolveToUri,
    resolveToAbsolutePath,
    uriToWorkspacePath,
    validateLineNumber,
    validateLineRange,
    symbolKindToString,
    severityToString,
    findSymbolInLine,
    getLineText
} from '../../core/common';

suite('Core Common Utilities Tests', () => {
    
    suite('resolveToAbsolutePath', () => {
        test('should resolve relative path to absolute path', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                // Skip test if no workspace
                return;
            }
            
            const result = resolveToAbsolutePath('src/server.ts');
            assert.ok(path.isAbsolute(result), 'Result should be an absolute path');
            assert.ok(result.endsWith('src/server.ts'), 'Result should end with the relative path');
        });
        
        test('should preserve absolute path', () => {
            const absolutePath = '/absolute/path/to/file.ts';
            const result = resolveToAbsolutePath(absolutePath);
            assert.strictEqual(result, absolutePath, 'Absolute path should be preserved');
        });
    });
    
    suite('resolveToUri', () => {
        test('should convert path to URI', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = resolveToUri('src/server.ts');
            assert.ok(result instanceof vscode.Uri, 'Result should be a Uri instance');
            assert.strictEqual(result.scheme, 'file', 'URI scheme should be file');
        });
    });
    
    suite('uriToWorkspacePath', () => {
        test('should convert URI to workspace relative path', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const testPath = path.join(workspaceRoot, 'src', 'server.ts');
            const uri = vscode.Uri.file(testPath);
            
            const result = uriToWorkspacePath(uri);
            assert.strictEqual(result, 'src/server.ts', 'Should return workspace relative path');
        });
        
        test('should return absolute path when not in workspace', () => {
            const outsideUri = vscode.Uri.file('/outside/workspace/file.ts');
            const result = uriToWorkspacePath(outsideUri);
            assert.strictEqual(result, '/outside/workspace/file.ts', 'Should return absolute path');
        });
    });
    
    suite('validateLineNumber', () => {
        // validateLineNumber returns string | undefined
        // undefined = valid, string = error message
        
        test('should accept valid line number', () => {
            const result = validateLineNumber(5, 10);
            assert.strictEqual(result, undefined, 'Should return undefined for valid line number');
        });
        
        test('should reject line number below 1', () => {
            const result = validateLineNumber(0, 10);
            assert.ok(result !== undefined, 'Should return error for line number 0');
            assert.ok(result!.includes('Invalid'), 'Error should mention invalid');
        });
        
        test('should reject line number exceeding total', () => {
            const result = validateLineNumber(15, 10);
            assert.ok(result !== undefined, 'Should return error for line exceeding total');
            assert.ok(result!.includes('Invalid'), 'Error should mention invalid');
        });
        
        test('should accept boundary line number', () => {
            const result = validateLineNumber(10, 10);
            assert.strictEqual(result, undefined, 'Should accept line at boundary');
        });
    });
    
    suite('validateLineRange', () => {
        test('should accept valid line range', () => {
            const result = validateLineRange(5, 10, 20);
            assert.strictEqual(result, undefined, 'Should return undefined for valid range');
        });
        
        test('should reject when startLine > endLine', () => {
            const result = validateLineRange(10, 5, 20);
            assert.ok(result !== undefined, 'Should return error when startLine > endLine');
        });
        
        test('should handle endLine=-1 (end of file)', () => {
            const result = validateLineRange(5, -1, 20);
            assert.strictEqual(result, undefined, 'Should accept when endLine is -1');
        });
    });
    
    suite('symbolKindToString', () => {
        test('should convert Function to string', () => {
            assert.strictEqual(symbolKindToString(vscode.SymbolKind.Function), 'Function');
        });
        
        test('should convert Class to string', () => {
            assert.strictEqual(symbolKindToString(vscode.SymbolKind.Class), 'Class');
        });
        
        test('should convert Method to string', () => {
            assert.strictEqual(symbolKindToString(vscode.SymbolKind.Method), 'Method');
        });
        
        test('should convert Interface to string', () => {
            assert.strictEqual(symbolKindToString(vscode.SymbolKind.Interface), 'Interface');
        });
        
        test('should convert Variable to string', () => {
            assert.strictEqual(symbolKindToString(vscode.SymbolKind.Variable), 'Variable');
        });
        
        test('should return Unknown for invalid kind', () => {
            assert.strictEqual(symbolKindToString(999 as vscode.SymbolKind), 'Unknown');
        });
    });
    
    suite('severityToString', () => {
        test('should convert Error severity', () => {
            assert.strictEqual(severityToString(vscode.DiagnosticSeverity.Error), 'Error');
        });
        
        test('should convert Warning severity', () => {
            assert.strictEqual(severityToString(vscode.DiagnosticSeverity.Warning), 'Warning');
        });
        
        test('should convert Information severity', () => {
            assert.strictEqual(severityToString(vscode.DiagnosticSeverity.Information), 'Information');
        });
        
        test('should convert Hint severity', () => {
            assert.strictEqual(severityToString(vscode.DiagnosticSeverity.Hint), 'Hint');
        });
    });
    
    suite('findSymbolInLine', () => {
        test('should find symbol at start of line', () => {
            const result = findSymbolInLine('function test() {}', 'function');
            assert.strictEqual(result, 0, 'Should find at position 0');
        });
        
        test('should find symbol in middle of line', () => {
            const result = findSymbolInLine('const myVar = 123;', 'myVar');
            assert.ok(result > 0, 'Should find in middle');
            assert.strictEqual(result, 6, 'Should be at position 6');
        });
        
        test('should return -1 when symbol not found', () => {
            const result = findSymbolInLine('const x = 1;', 'notFound');
            assert.strictEqual(result, -1, 'Should return -1');
        });
        
        test('should find first occurrence', () => {
            const result = findSymbolInLine('const test = testFunc();', 'test');
            assert.strictEqual(result, 6, 'Should find first occurrence');
        });
        
        test('should handle empty line', () => {
            const result = findSymbolInLine('', 'symbol');
            assert.strictEqual(result, -1, 'Should return -1 for empty line');
        });
    });
    
    suite('getLineText', () => {
        test('should get line text from existing file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Use server.ts which should exist
            const uri = resolveToUri('src/server.ts');
            const result = await getLineText(uri, 0);
            
            assert.ok(result !== undefined, 'Should return line text');
            assert.ok(typeof result === 'string', 'Result should be a string');
        });
        
        test('should return undefined for invalid line', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const uri = resolveToUri('src/server.ts');
            const result = await getLineText(uri, 99999);
            
            assert.strictEqual(result, undefined, 'Should return undefined for invalid line');
        });
    });
});
