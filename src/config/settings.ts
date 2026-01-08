/**
 * Configuration settings management
 * Centralized reading of VS Code extension settings
 */
import * as vscode from 'vscode';

/**
 * Server configuration from VS Code settings
 */
export interface ServerSettings {
    /** Port for the MCP server (default: 3000) */
    port: number;
    /** Host for the MCP server (default: '127.0.0.1') */
    host: string;
    /** Whether the server is enabled by default (default: false) */
    defaultEnabled: boolean;
}

/**
 * Gets the server configuration from VS Code settings
 * @returns ServerSettings object
 */
export function getServerSettings(): ServerSettings {
    const config = vscode.workspace.getConfiguration('vscode-mcp-server');
    return {
        port: config.get<number>('port') ?? 3000,
        host: config.get<string>('host') ?? '127.0.0.1',
        defaultEnabled: config.get<boolean>('defaultEnabled') ?? false
    };
}

/**
 * Configuration section name for the extension
 */
export const CONFIG_SECTION = 'vscode-mcp-server';
