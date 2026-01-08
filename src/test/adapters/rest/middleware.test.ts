/**
 * REST API Middleware Tests
 */
import * as assert from 'assert';
import { Request, Response } from 'express';
import { requireToolEnabled } from '../../../adapters/rest/middleware/enabledToolsGuard';
import { ToolConfiguration, DEFAULT_TOOL_CONFIG } from '../../../config';

suite('REST API Middleware Tests', () => {
    
    suite('enabledToolsGuard', () => {
        function createMockRequest(): Partial<Request> {
            return {
                method: 'GET',
                path: '/test'
            };
        }
        
        function createMockResponse(): Partial<Response> & { statusCode?: number; jsonData?: any } {
            const res: Partial<Response> & { statusCode?: number; jsonData?: any } = {
                statusCode: 200,
                jsonData: null
            };
            
            res.status = (code: number) => {
                res.statusCode = code;
                return res as Response;
            };
            
            res.json = (data: any) => {
                res.jsonData = data;
                return res as Response;
            };
            
            return res;
        }
        
        test('should call next() when tool is enabled', () => {
            const config: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, file: true };
            const middleware = requireToolEnabled(config, 'file', 'File');
            
            const req = createMockRequest() as Request;
            const res = createMockResponse() as Response;
            let nextCalled = false;
            const next = () => { nextCalled = true; };
            
            middleware(req, res, next);
            
            assert.ok(nextCalled, 'next() should be called when tool is enabled');
        });
        
        test('should return 403 when tool is disabled', () => {
            const config: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, file: false };
            const middleware = requireToolEnabled(config, 'file', 'File');
            
            const req = createMockRequest() as Request;
            const res = createMockResponse();
            let nextCalled = false;
            const next = () => { nextCalled = true; };
            
            middleware(req, res as Response, next);
            
            assert.ok(!nextCalled, 'next() should not be called when tool is disabled');
            assert.strictEqual(res.statusCode, 403, 'Should return 403 status');
            assert.ok(res.jsonData, 'Should return JSON error');
            assert.ok(res.jsonData.error, 'Should have error message');
            assert.ok(res.jsonData.error.includes('disabled'), 'Error should mention disabled');
        });
        
        test('should include hint in error response', () => {
            const config: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, diagnostics: false };
            const middleware = requireToolEnabled(config, 'diagnostics', 'Diagnostics');
            
            const req = createMockRequest() as Request;
            const res = createMockResponse();
            const next = () => {};
            
            middleware(req, res as Response, next);
            
            assert.ok(res.jsonData.hint, 'Should include hint in error response');
            assert.ok(res.jsonData.hint.includes('enabledTools'), 'Hint should mention enabledTools setting');
        });
        
        test('should work with symbol category', () => {
            const configEnabled: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, symbol: true };
            const configDisabled: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, symbol: false };
            
            const middlewareEnabled = requireToolEnabled(configEnabled, 'symbol', 'Symbol');
            const middlewareDisabled = requireToolEnabled(configDisabled, 'symbol', 'Symbol');
            
            const req = createMockRequest() as Request;
            const resEnabled = createMockResponse();
            const resDisabled = createMockResponse();
            
            let enabledNextCalled = false;
            let disabledNextCalled = false;
            
            middlewareEnabled(req, resEnabled as Response, () => { enabledNextCalled = true; });
            middlewareDisabled(req, resDisabled as Response, () => { disabledNextCalled = true; });
            
            assert.ok(enabledNextCalled, 'Should continue when symbol is enabled');
            assert.ok(!disabledNextCalled, 'Should block when symbol is disabled');
            assert.strictEqual(resDisabled.statusCode, 403, 'Should return 403 when disabled');
        });
        
        test('should work with refactor category', () => {
            const configDisabled: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, refactor: false };
            const middleware = requireToolEnabled(configDisabled, 'refactor', 'Refactor');
            
            const req = createMockRequest() as Request;
            const res = createMockResponse();
            let nextCalled = false;
            
            middleware(req, res as Response, () => { nextCalled = true; });
            
            assert.ok(!nextCalled, 'Should block when refactor is disabled');
            assert.strictEqual(res.statusCode, 403, 'Should return 403');
        });
        
        test('definition and hover are controlled by symbol category', () => {
            // definition and hover are part of symbol category
            // REST API uses symbolMiddleware for /symbols/definition and /symbols/hover
            const configSymbolEnabled: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, symbol: true };
            const configSymbolDisabled: ToolConfiguration = { ...DEFAULT_TOOL_CONFIG, symbol: false };
            
            const middlewareEnabled = requireToolEnabled(configSymbolEnabled, 'symbol', 'Symbol');
            const middlewareDisabled = requireToolEnabled(configSymbolDisabled, 'symbol', 'Symbol');
            
            const req = createMockRequest() as Request;
            const resEnabled = createMockResponse();
            const resDisabled = createMockResponse();
            
            let enabledNextCalled = false;
            let disabledNextCalled = false;
            
            middlewareEnabled(req, resEnabled as Response, () => { enabledNextCalled = true; });
            middlewareDisabled(req, resDisabled as Response, () => { disabledNextCalled = true; });
            
            assert.ok(enabledNextCalled, 'Definition/hover should be accessible when symbol is enabled');
            assert.ok(!disabledNextCalled, 'Definition/hover should be blocked when symbol is disabled');
            assert.strictEqual(resDisabled.statusCode, 403, 'Should return 403 when symbol is disabled');
        });
    });
});
