/**
 * REST API Router Integration Tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createRestApiRouter } from '../../../adapters/rest/router';
import { ToolConfiguration, DEFAULT_TOOL_CONFIG } from '../../../config';

suite('REST API Router Tests', () => {
    
    suite('Router Creation', () => {
        test('should create router with default config', () => {
            const router = createRestApiRouter();
            
            assert.ok(router, 'Router should be created');
            assert.ok(typeof router === 'function', 'Router should be a function');
        });
        
        test('should create router with custom config', () => {
            const config: ToolConfiguration = {
                file: true,
                edit: false,
                shell: false,
                diagnostics: true,
                symbol: true,
                refactor: false
            };
            
            const router = createRestApiRouter(config);
            
            assert.ok(router, 'Router should be created with custom config');
        });
        
        test('should create router with all tools disabled', () => {
            const config: ToolConfiguration = {
                file: false,
                edit: false,
                shell: false,
                diagnostics: false,
                symbol: false,
                refactor: false
            };
            
            const router = createRestApiRouter(config);
            
            assert.ok(router, 'Router should be created even with all tools disabled');
        });
    });
    
    suite('Router Stack Verification', () => {
        test('should have middleware stack', () => {
            const router = createRestApiRouter();
            
            // Express routers have a stack property with registered routes
            assert.ok(router.stack, 'Router should have a stack');
            assert.ok(Array.isArray(router.stack), 'Stack should be an array');
        });
        
        test('should have multiple routes registered', () => {
            const router = createRestApiRouter(DEFAULT_TOOL_CONFIG);
            
            // Should have routes for various endpoints
            assert.ok(router.stack.length > 0, 'Should have routes registered');
        });
    });
    
    suite('Route Definitions', () => {
        test('should include health endpoint', () => {
            const router = createRestApiRouter();
            
            // Check if there's a route for health
            const hasHealthRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path === '/health';
            });
            
            assert.ok(hasHealthRoute, 'Should have /health route');
        });
        
        test('should include info endpoint', () => {
            const router = createRestApiRouter();
            
            const hasInfoRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path === '/info';
            });
            
            assert.ok(hasInfoRoute, 'Should have /info route');
        });
        
        test('should include file routes when enabled', () => {
            const config = { ...DEFAULT_TOOL_CONFIG, file: true };
            const router = createRestApiRouter(config);
            
            const hasFilesRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path && layer.route.path.includes('files');
            });
            
            assert.ok(hasFilesRoute, 'Should have files routes when file is enabled');
        });
        
        test('should include diagnostics routes when enabled', () => {
            const config = { ...DEFAULT_TOOL_CONFIG, diagnostics: true };
            const router = createRestApiRouter(config);
            
            const hasDiagnosticsRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path && layer.route.path.includes('diagnostics');
            });
            
            assert.ok(hasDiagnosticsRoute, 'Should have diagnostics routes when diagnostics is enabled');
        });
        
        test('should include symbols routes when enabled', () => {
            const config = { ...DEFAULT_TOOL_CONFIG, symbol: true };
            const router = createRestApiRouter(config);
            
            const hasSymbolsRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path && layer.route.path.includes('symbols');
            });
            
            assert.ok(hasSymbolsRoute, 'Should have symbols routes when symbol is enabled');
        });
        
        test('should include refactor routes when enabled', () => {
            const config = { ...DEFAULT_TOOL_CONFIG, refactor: true };
            const router = createRestApiRouter(config);
            
            const hasRefactorRoute = router.stack.some((layer: any) => {
                return layer.route && layer.route.path && layer.route.path.includes('refactor');
            });
            
            assert.ok(hasRefactorRoute, 'Should have refactor routes when refactor is enabled');
        });
    });
});
