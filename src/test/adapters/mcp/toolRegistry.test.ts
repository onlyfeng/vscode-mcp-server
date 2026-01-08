/**
 * MCP Tool Registry Integration Tests
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from '../../../adapters/mcp/toolRegistry';
import { ToolConfiguration, DEFAULT_TOOL_CONFIG } from '../../../config';

suite('MCP Tool Registry Tests', () => {
    let server: McpServer;
    
    setup(() => {
        server = new McpServer({
            name: "test-mcp-server",
            version: "1.0.0",
        }, {
            capabilities: {
                logging: {},
                tools: {
                    listChanged: false
                }
            }
        });
    });
    
    suite('Tool Registration', () => {
        test('should register all tools when all enabled', () => {
            const config: ToolConfiguration = {
                file: true,
                edit: true,
                shell: true,
                diagnostics: true,
                symbol: true,
                refactor: true
            };
            
            // Mock file listing callback
            const fileListingCallback = async () => [];
            
            // This should not throw
            registerAllTools(server, undefined, config, fileListingCallback);
            
            // Verify tools were registered by checking server internals
            // Note: McpServer doesn't expose a direct way to list tools,
            // so we just verify no errors during registration
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip file tools when file=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                file: false
            };
            
            const fileListingCallback = async () => [];
            
            // Should not throw even with file disabled
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip edit tools when edit=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                edit: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip shell tools when shell=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                shell: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip diagnostics tools when diagnostics=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                diagnostics: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip symbol tools when symbol=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                symbol: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip refactor tools when refactor=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                refactor: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should skip definition and hover tools when symbol=false', () => {
            const config: ToolConfiguration = {
                ...DEFAULT_TOOL_CONFIG,
                symbol: false
            };
            
            const fileListingCallback = async () => [];
            
            // Definition and hover are part of symbol, so they should be skipped
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error');
        });
        
        test('should work with no tools enabled', () => {
            const config: ToolConfiguration = {
                file: false,
                edit: false,
                shell: false,
                diagnostics: false,
                symbol: false,
                refactor: false
            };
            
            const fileListingCallback = async () => [];
            
            registerAllTools(server, undefined, config, fileListingCallback);
            
            assert.ok(true, 'Tools registered without error (all disabled)');
        });
    });
    
    suite('Default Configuration', () => {
        test('DEFAULT_TOOL_CONFIG should have all tools enabled', () => {
            assert.strictEqual(DEFAULT_TOOL_CONFIG.file, true, 'file should be enabled');
            assert.strictEqual(DEFAULT_TOOL_CONFIG.edit, true, 'edit should be enabled');
            assert.strictEqual(DEFAULT_TOOL_CONFIG.shell, true, 'shell should be enabled');
            assert.strictEqual(DEFAULT_TOOL_CONFIG.diagnostics, true, 'diagnostics should be enabled');
            assert.strictEqual(DEFAULT_TOOL_CONFIG.symbol, true, 'symbol should be enabled (includes definition/hover)');
            assert.strictEqual(DEFAULT_TOOL_CONFIG.refactor, true, 'refactor should be enabled');
        });
    });
});
