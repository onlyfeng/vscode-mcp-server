/**
 * MCP Tool Registry - Unified MCP tool registration
 * Registers all MCP tools with the server, calling core layer functions
 */

import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from '../../utils/logger';
import { ToolConfiguration, isToolEnabled, DEFAULT_TOOL_CONFIG } from '../../config';
import {
    codeActionsCache,
    CODE_ACTIONS_TTL,
    generateRequestId,
    cleanupExpiredCache,
    invalidateCacheForUri,
    removeCachedActions
} from '../../utils/code-actions-cache';

// Core imports
import {
    // File operations
    listWorkspaceFiles as coreListFiles,
    readWorkspaceFile as coreReadFile,
    FileListingResult,
    
    // Edit operations
    createWorkspaceFile as coreCreateFile,
    replaceWorkspaceFileLines as coreReplaceLines,
    
    // Shell operations
    executeShellCommand as coreExecuteShell,
    waitForShellIntegration,
    
    // Symbol operations
    getDocumentSymbols as coreGetDocSymbols,
    searchWorkspaceSymbols as coreSearchSymbols,
    findReferences as coreFindRefs,
    getDefinition as coreGetDefinition,
    getSymbolHoverInfo as coreGetHover,
    
    // Refactor operations
    listCodeActions as coreListActions,
    applySingleCodeAction as coreApplySingleAction,
    applyAllQuickfixes as coreApplyAllQuickfixes,
    renameSymbol as coreRenameSymbol,
    isDangerousQuickfix,
    formatWorkspaceEditSummary,
    
    // Diagnostics
    getDiagnostics as coreGetDiagnostics,
    getFilteredDiagnostics as coreGetFilteredDiagnostics,
    formatDiagnosticsAsText,
    
    // Common
    resolveToUri,
    openDocument,
    saveDocument
} from '../../core';

// Default maximum character count for file reading
const DEFAULT_MAX_CHARACTERS = 100000;

// ============================================
// Type for file listing callback (legacy compatibility)
// ============================================

export type FileListingCallback = (path: string, recursive: boolean) => Promise<FileListingResult>;

// ============================================
// Tool Registration Functions
// ============================================

/**
 * Register all MCP tools with the server
 * @param server MCP server instance
 * @param terminal Terminal for shell commands
 * @param toolConfig Tool configuration
 * @param fileListingCallback Legacy file listing callback
 */
export function registerAllTools(
    server: McpServer,
    terminal?: vscode.Terminal,
    toolConfig?: ToolConfiguration,
    fileListingCallback?: FileListingCallback
): void {
    logger.info(`[registerAllTools] Starting tool registration with config: ${JSON.stringify(toolConfig)}`);
    
    const config = toolConfig ?? DEFAULT_TOOL_CONFIG;
    
    if (isToolEnabled('file', config)) {
        registerFileTools(server, fileListingCallback);
        logger.info('[registerAllTools] File tools registered');
    }
    
    if (isToolEnabled('edit', config)) {
        registerEditTools(server);
        logger.info('[registerAllTools] Edit tools registered');
    }
    
    if (isToolEnabled('shell', config)) {
        registerShellTools(server, terminal);
        logger.info('[registerAllTools] Shell tools registered');
    }
    
    if (isToolEnabled('symbol', config)) {
        registerSymbolTools(server);
        logger.info('[registerAllTools] Symbol tools registered');
        // Definition and hover are part of symbol tools
        registerDefinitionTools(server);
        logger.info('[registerAllTools] Definition tools registered (symbol)');
        registerHoverTools(server);
        logger.info('[registerAllTools] Hover tools registered (symbol)');
    }
    
    if (isToolEnabled('refactor', config)) {
        registerRefactorTools(server);
        logger.info('[registerAllTools] Refactor tools registered');
    }
    
    if (isToolEnabled('diagnostics', config)) {
        registerDiagnosticsTools(server);
        logger.info('[registerAllTools] Diagnostics tools registered');
    }
    
    logger.info('[registerAllTools] All tool registration complete');
}

// ============================================
// File Tools
// ============================================

function registerFileTools(server: McpServer, fileListingCallback?: FileListingCallback): void {
    server.tool(
        'list_files_code',
        `Explores directory structure in VS Code workspace.

        WHEN TO USE: Understanding project structure, finding files before read/modify operations.
        
        CRITICAL: NEVER set recursive=true on root directory (.) - output too large. Use recursive only on specific subdirectories.
        
        Returns files and directories at specified path. Start with path='.' to explore root, then dive into specific subdirectories with recursive=true.`,
        {
            path: z.string().describe('The path to list files from'),
            recursive: z.boolean().optional().default(false).describe('Whether to list files recursively')
        },
        async ({ path, recursive = false }): Promise<CallToolResult> => {
            logger.info(`[list_files_code] path="${path}", recursive=${recursive}`);
            
            try {
                // Use legacy callback if provided, otherwise use core function
                let files: FileListingResult;
                if (fileListingCallback) {
                    files = await fileListingCallback(path, recursive);
                } else {
                    const result = await coreListFiles(path, recursive);
                    if (!result.success) {
                        throw new Error(result.error);
                    }
                    files = result.data!;
                }
                
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(files, null, 2)
                    }]
                };
            } catch (error) {
                logger.error(`[list_files_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'read_file_code',
        `Retrieves file contents with size limits and partial reading support.

        WHEN TO USE: Reading code, config files, analyzing implementations. Files >100k chars will fail.
        
        Encoding: Text encodings (utf-8, latin1, etc.) for text files, 'base64' for base64-encoded string.
        Line numbers: Use startLine/endLine (1-based) for large files to read specific sections only.
        
        If file too large: Use startLine/endLine to read relevant sections only.`,
        {
            path: z.string().describe('The path to the file to read'),
            encoding: z.string().optional().default('utf-8').describe('Encoding to convert the file content to a string. Use "base64" for base64-encoded string'),
            maxCharacters: z.number().optional().default(DEFAULT_MAX_CHARACTERS).describe('Maximum character count (default: 100,000)'),
            startLine: z.number().optional().default(-1).describe('The start line number (1-based, inclusive). Default: read from beginning, denoted by -1'),
            endLine: z.number().optional().default(-1).describe('The end line number (1-based, inclusive). Default: read to end, denoted by -1')
        },
        async ({ path, encoding = 'utf-8', maxCharacters = DEFAULT_MAX_CHARACTERS, startLine = -1, endLine = -1 }): Promise<CallToolResult> => {
            logger.info(`[read_file_code] path="${path}", encoding=${encoding}, lines=${startLine}-${endLine}`);
            
            try {
                // Convert 1-based input to 0-based for core function
                const zeroBasedStartLine = startLine > 0 ? startLine - 1 : startLine;
                const zeroBasedEndLine = endLine > 0 ? endLine - 1 : endLine;
                
                const result = await coreReadFile(path, {
                    encoding,
                    maxCharacters,
                    startLine: zeroBasedStartLine,
                    endLine: zeroBasedEndLine
                });
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                return {
                    content: [{
                        type: 'text',
                        text: result.data!.content
                    }]
                };
            } catch (error) {
                logger.error(`[read_file_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Edit Tools
// ============================================

function registerEditTools(server: McpServer): void {
    server.tool(
        'create_file_code',
        `Creates new files or completely rewrites existing files.

        WHEN TO USE: New files, large modifications (>10 lines), complete file rewrites.
        USE replace_lines_code instead for: small edits ≤10 lines where you have exact original content.

        File handling: Use overwrite=true to replace existing files, ignoreIfExists=true to skip if file exists.
        Always check with list_files_code first unless you specifically want to overwrite.`,
        {
            path: z.string().describe('The path to the file to create'),
            content: z.string().describe('The content to write to the file'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if the file exists'),
            ignoreIfExists: z.boolean().optional().default(false).describe('Whether to ignore if the file exists')
        },
        async ({ path, content, overwrite = false, ignoreIfExists = false }): Promise<CallToolResult> => {
            logger.info(`[create_file_code] path="${path}", overwrite=${overwrite}`);
            
            try {
                const result = await coreCreateFile(path, content, { overwrite, ignoreIfExists });
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                return {
                    content: [{
                        type: 'text',
                        text: `File ${path} created successfully`
                    }]
                };
            } catch (error) {
                logger.error(`[create_file_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'replace_lines_code',
        `Replaces specific lines in existing files with exact content validation.

        WHEN TO USE: Modifications ≤10 lines where you have exact original text, or inserts of any size.
        USE create_file_code instead for: new files, large modifications (>10 lines, hard to match exact content), or when original text is uncertain.

        CRITICAL: originalCode parameter must match current file content exactly or tool fails.
        If tool fails: run read_file_code on target lines to get current content, then retry.

        Parameters use 1-based line numbers. Use endLine=-1 to replace from startLine to end of file.
        Always verify line numbers with read_file_code if unsure.`,
        {
            path: z.string().describe('The path to the file to modify'),
            startLine: z.number().describe('The start line number (1-based, inclusive)'),
            endLine: z.number().describe('The end line number (1-based, inclusive). Use -1 to replace to end of file.'),
            content: z.string().describe('The new content to replace the lines with'),
            originalCode: z.string().describe('The original code for validation - must match exactly')
        },
        async ({ path, startLine, endLine, content, originalCode }): Promise<CallToolResult> => {
            logger.info(`[replace_lines_code] path="${path}", lines=${startLine}-${endLine}`);
            
            try {
                // Convert 1-based to 0-based
                const zeroBasedStartLine = startLine - 1;
                const zeroBasedEndLine = endLine === -1 ? -1 : endLine - 1;
                
                const result = await coreReplaceLines(path, {
                    startLine: zeroBasedStartLine,
                    endLine: zeroBasedEndLine,
                    content,
                    originalCode
                });
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                return {
                    content: [{
                        type: 'text',
                        text: `Lines ${startLine}-${endLine} in file ${path} replaced successfully`
                    }]
                };
            } catch (error) {
                logger.error(`[replace_lines_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Shell Tools
// ============================================

function registerShellTools(server: McpServer, terminal?: vscode.Terminal): void {
    server.tool(
        'execute_shell_command_code',
        `Executes shell commands in VS Code integrated terminal.

        WHEN TO USE: Running CLI commands, builds, git operations, npm/pip installs.
        
        Working directory: Use cwd to run commands in specific directories. Defaults to workspace root. If you get unexpected results, ensure the cwd is correct.

        Timeout: Commands must complete within specified time (default 10s) or the tool will return a timeout error, but the command may still be running in the terminal.`,
        {
            command: z.string().describe('The shell command to execute'),
            cwd: z.string().optional().default('.').describe('Optional working directory for the command'),
            timeout: z.number().optional().default(10000).describe('Command timeout in milliseconds (default: 10000)')
        },
        async ({ command, cwd, timeout = 10000 }): Promise<CallToolResult> => {
            logger.info(`[execute_shell_command_code] command="${command}", cwd="${cwd}"`);
            
            try {
                if (!terminal) {
                    throw new Error('Terminal not available');
                }
                
                const result = await coreExecuteShell(terminal, command, { cwd, timeout });
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                return {
                    content: [{
                        type: 'text',
                        text: `Command: ${command}\n\nOutput:\n${result.data!.output}`
                    }]
                };
            } catch (error) {
                logger.error(`[execute_shell_command_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Symbol Tools
// ============================================

function registerSymbolTools(server: McpServer): void {
    server.tool(
        'search_symbols_code',
        `Searches for symbols (functions, classes, variables) across workspace using fuzzy matching.

        WHEN TO USE: Finding function/class definitions, exploring project structure, locating specific elements.
        
        Search: Supports partial terms (e.g., 'createW' matches 'createWorkspaceFile'). Returns location and container info.
        Limit results to avoid overwhelming output - increase maxResults only if needed.`,
        {
            query: z.string().describe('The search query for symbol names'),
            maxResults: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)')
        },
        async ({ query, maxResults = 10 }): Promise<CallToolResult> => {
            logger.info(`[search_symbols_code] query="${query}", maxResults=${maxResults}`);
            
            try {
                const result = await coreSearchSymbols(query, maxResults);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                const data = result.data!;
                let resultText: string;
                
                if (data.symbols.length === 0) {
                    resultText = `No symbols found matching query "${query}".`;
                } else {
                    resultText = `Found ${data.total} symbols matching query "${query}"`;
                    if (data.total > maxResults) {
                        resultText += ` (showing first ${maxResults})`;
                    }
                    resultText += ":\n\n";
                    
                    for (const symbol of data.symbols) {
                        resultText += `${symbol.name} (${symbol.kind})`;
                        if (symbol.containerName) {
                            resultText += ` in ${symbol.containerName}`;
                        }
                        resultText += `\nLocation: ${symbol.file}:${symbol.line}:${symbol.character}\n\n`;
                    }
                }
                
                return {
                    content: [{ type: 'text', text: resultText }]
                };
            } catch (error) {
                logger.error(`[search_symbols_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'get_document_symbols_code',
        `Gets complete symbol outline for a file showing hierarchical structure and line numbers.

        WHEN TO USE: Understanding file structure, getting overview of all symbols, finding symbol positions. This tool should be be preferred over reading the file using read_file_code when only an overview of the file is needed.
        USE search_symbols_code instead for: finding specific symbols by name across the project.
        
        Shows classes, functions, methods, variables with line ranges. Use maxDepth for large files to avoid deep nesting.`,
        {
            path: z.string().describe('The path to the file to analyze (relative to workspace)'),
            maxDepth: z.number().optional().describe('Maximum nesting depth to display (optional)')
        },
        async ({ path, maxDepth }): Promise<CallToolResult> => {
            logger.info(`[get_document_symbols_code] path="${path}", maxDepth=${maxDepth}`);
            
            try {
                const result = await coreGetDocSymbols(path, maxDepth);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                const data = result.data!;
                let resultText: string;
                
                if (data.symbols.length === 0) {
                    resultText = `No symbols found in file: ${path}`;
                } else {
                    resultText = `Document symbols for ${path} (${data.total} total symbols):\n\n`;
                    
                    const kindSummary = Object.entries(data.totalByKind)
                        .map(([kind, count]) => `${count} ${kind}${count !== 1 ? 's' : ''}`)
                        .join(', ');
                    resultText += `Summary: ${kindSummary}\n\n`;
                    
                    for (const symbol of data.symbols) {
                        const indent = '  '.repeat(symbol.depth);
                        resultText += `${indent}${symbol.name} (${symbol.kind})`;
                        
                        if (symbol.detail) {
                            resultText += ` - ${symbol.detail}`;
                        }
                        
                        resultText += `\n${indent}  Range: ${symbol.range.start.line}:${symbol.range.start.character}-${symbol.range.end.line}:${symbol.range.end.character}`;
                        
                        if (symbol.childCount !== undefined) {
                            resultText += ` | Children: ${symbol.childCount}`;
                        }
                        
                        resultText += '\n\n';
                    }
                }
                
                return {
                    content: [{ type: 'text', text: resultText }]
                };
            } catch (error) {
                logger.error(`[get_document_symbols_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'get_references_code',
        `Find all references to a symbol across the workspace.

        WHEN TO USE: Understanding symbol usage, before refactoring, impact analysis.
        
        Returns references grouped by file with line numbers. Includes the declaration by default.`,
        {
            path: z.string().describe('The path to the file containing the symbol'),
            line: z.number().describe('The line number of the symbol (1-based)'),
            character: z.number().optional().describe('The character position in the line (0-based). If not provided, will search for the symbol name on the line.'),
            symbol: z.string().optional().describe('The symbol name to search for on the line (used if character is not provided)'),
            includeDeclaration: z.boolean().optional().default(true).describe('Whether to include the declaration in results (default: true)')
        },
        async ({ path, line, character, symbol, includeDeclaration = true }): Promise<CallToolResult> => {
            logger.info(`[get_references_code] path="${path}", line=${line}, symbol="${symbol}"`);
            
            try {
                const result = await coreFindRefs(path, line, character, symbol, includeDeclaration);
                
                if (!result.success) {
                    return {
                        content: [{ type: 'text', text: result.error! }]
                    };
                }
                
                const refs = result.data!;
                let resultText: string;
                
                if (refs.length === 0) {
                    resultText = `No references found for symbol at ${path}:${line}`;
                } else {
                    resultText = `Found ${refs.length} reference(s):\n`;
                    
                    // Group by file
                    const grouped = new Map<string, typeof refs>();
                    for (const ref of refs) {
                        if (!grouped.has(ref.file)) {
                            grouped.set(ref.file, []);
                        }
                        grouped.get(ref.file)!.push(ref);
                    }
                    
                    for (const [file, fileRefs] of grouped) {
                        resultText += `\n${file}:\n`;
                        for (const ref of fileRefs) {
                            resultText += `  - Line ${ref.line}:${ref.character} to ${ref.endLine}:${ref.endCharacter}\n`;
                        }
                    }
                }
                
                return {
                    content: [{ type: 'text', text: resultText }]
                };
            } catch (error) {
                logger.error(`[get_references_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Refactor Tools
// ============================================

function registerRefactorTools(server: McpServer): void {
    server.tool(
        'rename_symbol_code',
        `Rename a symbol across the entire workspace using VS Code's rename provider.

        WHEN TO USE: Refactoring variable/function/class names, ensuring consistent naming.
        
        Performs semantic rename that updates all references. Set apply=false for preview only.`,
        {
            path: z.string().describe('The path to the file containing the symbol'),
            line: z.number().describe('The line number of the symbol (1-based)'),
            character: z.number().optional().describe('The character position in the line (0-based). If not provided, will search for the symbol name on the line.'),
            symbol: z.string().optional().describe('The symbol name to search for on the line (used if character is not provided)'),
            newName: z.string().describe('The new name for the symbol'),
            apply: z.boolean().optional().default(true).describe('Whether to apply the rename (default: true). Set to false to preview changes.')
        },
        async ({ path, line, character, symbol, newName, apply = true }): Promise<CallToolResult> => {
            logger.info(`[rename_symbol_code] path="${path}", line=${line}, newName="${newName}"`);
            
            try {
                const result = await coreRenameSymbol(path, line, character, symbol, newName, apply);
                
                if (!result.success) {
                    return {
                        content: [{ type: 'text', text: result.error! }],
                        isError: true
                    };
                }
                
                let summary = `Affected ${result.affectedFiles.length} file(s) with ${result.totalChanges} total change(s):\n`;
                for (const file of result.affectedFiles) {
                    summary += `  - ${file.file}: ${file.changes} change(s)\n`;
                }
                
                if (result.applied) {
                    return {
                        content: [{ type: 'text', text: `Rename to "${newName}" applied successfully.\n\n${summary}` }]
                    };
                } else {
                    return {
                        content: [{ type: 'text', text: `Rename preview (not applied):\n\nRenaming to "${newName}" would affect:\n${summary}` }]
                    };
                }
            } catch (error) {
                logger.error(`[rename_symbol_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'list_code_actions_code',
        `List available code actions (quick fixes, refactorings) for a code range.

        WHEN TO USE: Finding available fixes for diagnostics, discovering refactoring options.
        
        SCANNING ENTIRE FILE: Use startLine=1 and endLine=-1 to scan the entire file for all available code actions.
        This is the recommended approach when you need to check the whole file for issues or refactoring opportunities.
        
        Returns a requestId that can be used with apply_code_action_code. Results are cached for 60 seconds.`,
        {
            path: z.string().describe('The path to the file'),
            startLine: z.number().describe('Start line of the range (1-based). Use 1 for scanning from the beginning.'),
            startCharacter: z.number().optional().default(0).describe('Start character of the range (0-based, default: 0)'),
            endLine: z.number().optional().describe('End line of the range (1-based). Use -1 for end of file. Default: same as startLine.'),
            endCharacter: z.number().optional().describe('End character of the range (0-based, default: end of line)'),
            onlyKinds: z.array(z.string()).optional().describe('Filter by code action kinds (e.g., ["quickfix", "refactor"])'),
            includeSourceActions: z.boolean().optional().default(false).describe('Include source actions like organize imports (default: false)')
        },
        async ({ path, startLine, startCharacter = 0, endLine, endCharacter, onlyKinds, includeSourceActions = false }): Promise<CallToolResult> => {
            logger.info(`[list_code_actions_code] path="${path}", range=${startLine}-${endLine}`);
            
            cleanupExpiredCache();
            
            try {
                const result = await coreListActions(path, startLine, endLine, startCharacter, endCharacter, onlyKinds, includeSourceActions);
                
                if (!result.success) {
                    return {
                        content: [{ type: 'text', text: result.error! }],
                        isError: true
                    };
                }
                
                const data = result.data!;
                
                if (data.actions.length === 0) {
                    return {
                        content: [{ type: 'text', text: `No code actions available for the specified range in ${path}` }]
                    };
                }
                
                // Cache the actions
                const requestId = generateRequestId();
                codeActionsCache.set(requestId, {
                    actions: data.actions,
                    timestamp: Date.now(),
                    uri: data.uri,
                    range: data.range
                });
                
                let resultText = `Found ${data.actions.length} code action(s) for ${path}\n\n`;
                resultText += `Request ID: ${requestId} (valid for 60 seconds)\n\n`;
                resultText += `Available actions:\n`;
                
                data.formattedActions.forEach((action) => {
                    resultText += `\n[${action.index}] ${action.title}`;
                    if (action.kind) {
                        resultText += ` (${action.kind})`;
                    }
                    if (action.isPreferred) {
                        resultText += ' [PREFERRED]';
                    }
                    if (action.diagnostics.length > 0) {
                        resultText += `\n    Fixes: ${action.diagnostics.join(', ')}`;
                    }
                });
                
                resultText += `\n\nUse apply_code_action_code with requestId="${requestId}" and the action index to apply.`;
                
                return {
                    content: [{ type: 'text', text: resultText }]
                };
            } catch (error) {
                logger.error(`[list_code_actions_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'apply_code_action_code',
        `Apply a code action from a previous list_code_actions_code call.

        WHEN TO USE: After listing code actions, to apply a specific fix or refactoring.
        
        Requires the requestId from list_code_actions_code (valid for 60 seconds) and the action index.
        Use applyAll=true to apply all quickfix actions in sequence (useful for fixing multiple similar issues).
        Use applyPreferred=true to apply only preferred (*) quickfix actions.
        
        Priority: index > applyPreferred > applyAll`,
        {
            requestId: z.string().describe('The request ID from list_code_actions_code'),
            index: z.number().optional().describe('The index of the action to apply (from the list). Required when applyAll and applyPreferred are both false.'),
            applyAll: z.boolean().optional().default(false).describe('Apply all quickfix actions in sequence (default: false). When true, ignores index parameter.'),
            applyPreferred: z.boolean().optional().default(false).describe('Apply only preferred (*) quickfix actions (default: false). Takes priority over applyAll.')
        },
        async ({ requestId, index, applyAll = false, applyPreferred = false }): Promise<CallToolResult> => {
            logger.info(`[apply_code_action_code] requestId="${requestId}", index=${index}, applyAll=${applyAll}`);
            
            cleanupExpiredCache();
            
            try {
                const cached = codeActionsCache.get(requestId);
                
                if (!cached) {
                    return {
                        content: [{ type: 'text', text: `Request ID "${requestId}" not found or expired. Please run list_code_actions_code again.` }],
                        isError: true
                    };
                }
                
                if (Date.now() - cached.timestamp > CODE_ACTIONS_TTL) {
                    removeCachedActions(requestId);
                    return {
                        content: [{ type: 'text', text: `Request ID "${requestId}" has expired (> 60 seconds). Please run list_code_actions_code again.` }],
                        isError: true
                    };
                }
                
                let totalApplied = 0;
                let resultMessage = '';
                
                if (applyPreferred || applyAll) {
                    // Apply all/preferred quickfix actions
                    const quickfixes = cached.actions.filter(a =>
                        a.kind?.value?.startsWith('quickfix') &&
                        !isDangerousQuickfix(a) &&
                        (!applyPreferred || a.isPreferred === true)
                    );
                    
                    if (quickfixes.length === 0) {
                        return {
                            content: [{ type: 'text', text: applyPreferred ? 'No preferred quickfix actions found.' : 'No safe quickfix actions found.' }],
                            isError: true
                        };
                    }
                    
                    const applyResult = await coreApplyAllQuickfixes(cached.uri, cached.range, 50, applyPreferred);
                    totalApplied = applyResult.appliedCount;
                    resultMessage = applyResult.results.join('\n');
                    
                    if (totalApplied > 0) {
                        resultMessage += `\n\n✓ Successfully applied ${totalApplied} action(s).`;
                    }
                } else {
                    // Single action mode
                    if (index === undefined || index === null) {
                        return {
                            content: [{ type: 'text', text: 'index is required when applyAll and applyPreferred are both false' }],
                            isError: true
                        };
                    }
                    
                    if (index < 0 || index >= cached.actions.length) {
                        return {
                            content: [{ type: 'text', text: `Invalid action index ${index}. Valid range: 0 to ${cached.actions.length - 1}` }],
                            isError: true
                        };
                    }
                    
                    const action = cached.actions[index];
                    const applyResult = await coreApplySingleAction(action, cached.uri, cached.range);
                    resultMessage = applyResult.message;
                    totalApplied = applyResult.applied ? 1 : 0;
                }
                
                // Invalidate cache
                invalidateCacheForUri(cached.uri);
                removeCachedActions(requestId);
                await saveDocument(cached.uri);
                
                if (totalApplied > 0) {
                    return {
                        content: [{ type: 'text', text: resultMessage }]
                    };
                } else {
                    return {
                        content: [{ type: 'text', text: 'No actions were successfully applied.' }],
                        isError: true
                    };
                }
            } catch (error) {
                logger.error(`[apply_code_action_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Diagnostics Tools
// ============================================

function registerDiagnosticsTools(server: McpServer): void {
    server.tool(
        'get_diagnostics_code',
        `Gets diagnostic messages (errors, warnings) from VS Code.

        WHEN TO USE: Checking for compile errors, finding issues before/after edits.
        
        Omit path to check all open files. Provide path for specific file diagnostics.`,
        {
            path: z.string().optional().describe('Optional file path. If not provided, returns diagnostics for all files.')
        },
        async ({ path }): Promise<CallToolResult> => {
            logger.info(`[get_diagnostics_code] path="${path || 'all'}"`);
            
            try {
                const result = await coreGetFilteredDiagnostics(path);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                const text = formatDiagnosticsAsText(result.data!);
                
                return {
                    content: [{ type: 'text', text }]
                };
            } catch (error) {
                logger.error(`[get_diagnostics_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Definition Tools
// ============================================

function registerDefinitionTools(server: McpServer): void {
    server.tool(
        'get_symbol_definition_code',
        `Go to definition - finds where a symbol is defined.

        WHEN TO USE: "跳转定义", "查看定义", "go to definition"
        
        Returns file path and line/column of the definition.`,
        {
            path: z.string().describe('File path containing the symbol'),
            line: z.number().describe('Line number (1-based)'),
            character: z.number().optional().describe('Character position (0-based). If not provided, use symbol parameter.'),
            symbol: z.string().optional().describe('Symbol name to find on the line (if character not provided)')
        },
        async ({ path, line, character, symbol }): Promise<CallToolResult> => {
            logger.info(`[get_symbol_definition_code] path="${path}", line=${line}, character=${character}, symbol="${symbol}"`);
            
            try {
                const result = await coreGetDefinition(path, line, character, symbol);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                if (!result.data || result.data.length === 0) {
                    return {
                        content: [{ type: 'text', text: 'No definition found for this symbol.' }]
                    };
                }
                
                let text = `Found ${result.data.length} definition(s):\n\n`;
                for (const def of result.data) {
                    text += `${def.file}:${def.line}:${def.character}\n`;
                    text += `  Range: [${def.line}:${def.character}] to [${def.endLine}:${def.endCharacter}]\n\n`;
                }
                
                return {
                    content: [{ type: 'text', text }]
                };
            } catch (error) {
                logger.error(`[get_symbol_definition_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}

// ============================================
// Hover Tools
// ============================================

function registerHoverTools(server: McpServer): void {
    server.tool(
        'get_symbol_hover_code',
        `Get hover information for a symbol - type signature, documentation.

        WHEN TO USE: "查看类型", "什么类型", "check type", "hover"
        
        Returns type information and documentation for the symbol.`,
        {
            path: z.string().describe('File path containing the symbol'),
            line: z.number().describe('Line number (1-based)'),
            character: z.number().optional().describe('Character position (0-based). If not provided, use symbol parameter.'),
            symbol: z.string().optional().describe('Symbol name to find on the line (if character not provided)')
        },
        async ({ path, line, character, symbol }): Promise<CallToolResult> => {
            logger.info(`[get_symbol_hover_code] path="${path}", line=${line}, character=${character}, symbol="${symbol}"`);
            
            try {
                const result = await coreGetHover(path, line, character, symbol);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                if (!result.data || !result.data.hovers || result.data.hovers.length === 0) {
                    return {
                        content: [{ type: 'text', text: 'No hover information available for this symbol.' }]
                    };
                }
                
                let text = `Hover information for symbol at ${path}:${line}:\n\n`;
                
                for (const hover of result.data.hovers) {
                    if (hover.preview) {
                        text += `Code: \`${hover.preview}\`\n\n`;
                    }
                    
                    for (const content of hover.contents) {
                        text += `${content}\n\n`;
                    }
                    
                    if (hover.range) {
                        text += `Symbol range: [${hover.range.start.line}:${hover.range.start.character}] to [${hover.range.end.line}:${hover.range.end.character}]\n\n`;
                    }
                }
                
                return {
                    content: [{ type: 'text', text }]
                };
            } catch (error) {
                logger.error(`[get_symbol_hover_code] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}
