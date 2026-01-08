/**
 * Tool enablement configuration
 * Controls which tool categories are enabled in MCP and REST APIs
 */
import * as vscode from 'vscode';
import { CONFIG_SECTION } from './settings';

/**
 * Tool configuration defining which categories are enabled
 */
export interface ToolConfiguration {
    /** File listing and reading operations */
    file: boolean;
    /** File creation and editing operations */
    edit: boolean;
    /** Shell command execution */
    shell: boolean;
    /** Diagnostics/linting information */
    diagnostics: boolean;
    /** Symbol search, references, definition, hover */
    symbol: boolean;
    /** Refactoring operations (rename, code actions) */
    refactor: boolean;
}

/**
 * Tool category names - used for middleware and logging
 */
export type ToolCategory = keyof ToolConfiguration;

/**
 * Default tool configuration - all tools enabled by default
 */
export const DEFAULT_TOOL_CONFIG: ToolConfiguration = {
    file: true,
    edit: true,
    shell: true,
    diagnostics: true,
    symbol: true,
    refactor: true
};

/**
 * Gets the tool configuration from VS Code settings
 * @returns ToolConfiguration object with all tool enablement settings
 */
export function getToolConfiguration(): ToolConfiguration {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabledTools = config.get<Partial<ToolConfiguration>>('enabledTools') ?? {};
    
    return {
        file: enabledTools.file ?? DEFAULT_TOOL_CONFIG.file,
        edit: enabledTools.edit ?? DEFAULT_TOOL_CONFIG.edit,
        shell: enabledTools.shell ?? DEFAULT_TOOL_CONFIG.shell,
        diagnostics: enabledTools.diagnostics ?? DEFAULT_TOOL_CONFIG.diagnostics,
        symbol: enabledTools.symbol ?? DEFAULT_TOOL_CONFIG.symbol,
        refactor: enabledTools.refactor ?? DEFAULT_TOOL_CONFIG.refactor
    };
}

/**
 * Checks if a specific tool category is enabled
 * @param category The tool category to check
 * @param config Optional pre-loaded configuration (avoids re-reading VS Code settings)
 * @returns true if the tool category is enabled
 */
export function isToolEnabled(category: ToolCategory, config?: ToolConfiguration): boolean {
    const toolConfig = config ?? getToolConfiguration();
    return toolConfig[category];
}
