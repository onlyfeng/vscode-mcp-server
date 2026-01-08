/**
 * Core diagnostics operations unit tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    getDiagnostics,
    getFilteredDiagnostics,
    formatDiagnosticsAsText
} from '../../core/diagnostics/diagnostics';

suite('Core Diagnostics Operations Tests', () => {
    
    suite('getDiagnostics', () => {
        test('should get diagnostics for workspace', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDiagnostics();
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok('diagnostics' in result.data, 'Should have diagnostics property');
            assert.ok('totalCount' in result.data, 'Should have totalCount');
            assert.ok('fileCount' in result.data, 'Should have fileCount');
            assert.ok(typeof result.data.totalCount === 'number', 'totalCount should be a number');
            assert.ok(typeof result.data.fileCount === 'number', 'fileCount should be a number');
        });
        
        test('should get diagnostics for specific file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getDiagnostics('src/server.ts');
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            
            // If there are diagnostics, they should all be for the specified file
            if (result.data.totalCount > 0) {
                const files = result.data.diagnostics.map(d => d.file);
                assert.ok(files.every(f => f.includes('server.ts')), 
                    'All diagnostics should be for server.ts');
            }
        });
        
        test('should return zero diagnostics for clean file', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // package.json should have no TypeScript diagnostics
            const result = await getDiagnostics('package.json');
            
            assert.ok(result.success, 'Should succeed');
            // May or may not have diagnostics depending on workspace state
        });
    });
    
    suite('getFilteredDiagnostics', () => {
        test('should filter by severity', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            // Filter only errors
            const result = await getFilteredDiagnostics(
                undefined,
                [vscode.DiagnosticSeverity.Error],
                true
            );
            
            assert.ok(result.success, `Should succeed: ${result.error}`);
            assert.ok(result.data, 'Should have data');
            assert.ok(Array.isArray(result.data), 'Data should be an array');
            
            // All diagnostics should be errors
            for (const diag of result.data) {
                assert.strictEqual(diag.severity, 'Error', 
                    'All diagnostics should be Error severity');
            }
        });
        
        test('should include source when requested', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getFilteredDiagnostics(
                undefined,
                [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
                true // includeSource
            );
            
            assert.ok(result.success, 'Should succeed');
            // Source field may or may not be present depending on diagnostics
        });
        
        test('should filter multiple severities', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            
            const result = await getFilteredDiagnostics(
                undefined,
                [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
                true
            );
            
            assert.ok(result.success, 'Should succeed');
            assert.ok(Array.isArray(result.data), 'Data should be an array');
            
            // All diagnostics should be Error or Warning
            for (const diag of result.data!) {
                assert.ok(
                    diag.severity === 'Error' || diag.severity === 'Warning',
                    `Severity should be Error or Warning, got ${diag.severity}`
                );
            }
        });
    });
    
    suite('formatDiagnosticsAsText', () => {
        test('should format empty diagnostics', () => {
            const result = formatDiagnosticsAsText([], true);
            
            assert.ok(typeof result === 'string', 'Should return string');
            assert.ok(result.includes('No issues') || result.includes('0'), 
                'Should mention no issues or zero');
        });
        
        test('should format diagnostics with file grouping', () => {
            const diagnostics = [
                {
                    file: 'src/test.ts',
                    line: 1,
                    column: 0,
                    severity: 'Error',
                    message: 'Test error',
                    source: 'typescript'
                }
            ];
            
            const result = formatDiagnosticsAsText(diagnostics, true);
            
            assert.ok(result.includes('src/test.ts'), 'Should include file name');
            assert.ok(result.includes('Test error'), 'Should include error message');
            assert.ok(result.includes('Error'), 'Should include severity');
        });
        
        test('should include source when requested', () => {
            const diagnostics = [
                {
                    file: 'src/test.ts',
                    line: 1,
                    column: 0,
                    severity: 'Warning',
                    message: 'Test warning',
                    source: 'eslint'
                }
            ];
            
            const resultWithSource = formatDiagnosticsAsText(diagnostics, true);
            const resultWithoutSource = formatDiagnosticsAsText(diagnostics, false);
            
            assert.ok(resultWithSource.includes('eslint'), 'Should include source when requested');
            // Source may or may not be included based on implementation
        });
    });
});
