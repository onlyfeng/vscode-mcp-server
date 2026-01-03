/**
 * REST API endpoints for skill script direct access
 * These endpoints provide a simpler HTTP interface compared to MCP protocol
 * 
 * Uses shared services from ../services/ for core business logic
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import {
    cacheCodeActions,
    getCachedActions,
    removeCachedActions
} from '../utils/code-actions-cache';
import type { ToolConfiguration } from '../server';

// Import shared services
import {
    // Symbol services
    getDocumentSymbols,
    searchWorkspaceSymbols,
    findReferences,
    getDefinition,
    // Refactor services
    listCodeActions,
    applySingleCodeAction,
    applyAllQuickfixes,
    renameSymbol,
    // Diagnostics services
    getDiagnostics
} from '../services';

/**
 * Creates a middleware that checks if a tool category is enabled
 * @param config Tool configuration
 * @param category The category to check
 * @param categoryName Human-readable name for error messages
 */
function requireToolEnabled(
    config: ToolConfiguration,
    category: keyof ToolConfiguration,
    categoryName: string
) {
    return (_req: Request, res: Response, next: NextFunction) => {
        if (!config[category]) {
            logger.info(`[REST API] ${categoryName} endpoint blocked by configuration`);
            return res.status(403).json({
                error: `${categoryName} endpoints are disabled by configuration`,
                hint: 'Update vscode-mcp-server.enabledTools setting to enable this feature'
            });
        }
        next();
    };
}

/**
 * Creates and configures the REST API router
 * @param toolConfig Tool configuration to control which endpoints are enabled
 * @returns Express Router with all REST API endpoints
 */
export function createRestApiRouter(toolConfig?: ToolConfiguration): Router {
    const router = Router();
    
    // Default configuration (all enabled)
    const config: ToolConfiguration = toolConfig || {
        file: true,
        edit: true,
        shell: true,
        diagnostics: true,
        symbol: true,
        refactor: true
    };
    
    logger.info(`[REST API] Initializing with config: ${JSON.stringify(config)}`);

    // Middleware to log all API requests
    router.use((req, _res, next) => {
        logger.info(`[REST API] ${req.method} ${req.path}`);
        next();
    });

    // ============================================
    // File Operations (requires file: true)
    // ============================================
    const fileMiddleware = requireToolEnabled(config, 'file', 'File');

    /**
     * GET /api/files/list
     * List files in the workspace
     * Query params: path (optional), recursive (optional, default: false)
     */
    router.get('/files/list', fileMiddleware, async (req: Request, res: Response) => {
        try {
            const path = (req.query.path as string) || '';
            const recursive = req.query.recursive === 'true';

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const targetUri = path ? vscode.Uri.joinPath(workspaceRoot, path) : workspaceRoot;

            const files: string[] = [];
            await listFilesRecursive(targetUri, workspaceRoot, files, recursive);

            res.json({ files, count: files.length });
        } catch (error) {
            logger.error(`[REST API] /files/list error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * GET /api/files/read
     * Read file contents
     * Query params: path (required), startLine (optional), endLine (optional)
     */
    router.get('/files/read', fileMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            if (!path) {
                return res.status(400).json({ error: 'path parameter is required' });
            }

            const startLineParam = req.query.startLine as string | undefined;
            const endLineParam = req.query.endLine as string | undefined;
            const startLine = startLineParam ? parseInt(startLineParam) : undefined;
            const endLine = endLineParam ? parseInt(endLineParam) : undefined;

            // Validate parsed line numbers are valid integers
            if (startLineParam && isNaN(startLine!)) {
                return res.status(400).json({ error: 'startLine must be a valid integer' });
            }
            if (endLineParam && isNaN(endLine!)) {
                return res.status(400).json({ error: 'endLine must be a valid integer' });
            }

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            const document = await vscode.workspace.openTextDocument(fileUri);
            let content: string;
            let lineCount = document.lineCount;

            if (startLine !== undefined || endLine !== undefined) {
                // Handle empty files - return empty content
                if (lineCount === 0) {
                    content = '';
                } else {
                    // Handle startLine: undefined or -1 means beginning of file, otherwise convert 1-based to 0-based
                    const start = (startLine === undefined || startLine === -1) ? 0 : startLine - 1;
                    // Handle endLine: undefined or -1 means end of file, otherwise convert 1-based to 0-based
                    const end = (endLine === undefined || endLine === -1) ? lineCount - 1 : endLine - 1;
                    
                    // Validate line numbers are within bounds (don't silently clamp)
                    if (start < 0) {
                        return res.status(400).json({
                            error: `Invalid startLine ${startLine}. Line numbers must be >= 1 (or -1 for beginning of file)`
                        });
                    }
                    if (start >= lineCount) {
                        return res.status(400).json({
                            error: `Invalid startLine ${startLine}. File only has ${lineCount} line(s). Valid range: 1 to ${lineCount}`
                        });
                    }
                    if (end < 0) {
                        return res.status(400).json({
                            error: `Invalid endLine ${endLine}. Line numbers must be >= 1 (or -1 for end of file)`
                        });
                    }
                    if (end >= lineCount) {
                        return res.status(400).json({
                            error: `Invalid endLine ${endLine}. File only has ${lineCount} line(s). Valid range: 1 to ${lineCount}`
                        });
                    }
                    
                    // Handle invalid range (start > end)
                    if (start > end) {
                        return res.status(400).json({
                            error: `Invalid range: startLine (${startLine}) cannot be greater than endLine (${endLine})`
                        });
                    }
                    
                    const lines: string[] = [];
                    for (let i = start; i <= end; i++) {
                        lines.push(document.lineAt(i).text);
                    }
                    content = lines.join('\n');
                }
            } else {
                content = document.getText();
            }

            res.json({ content, lineCount, path });
        } catch (error) {
            logger.error(`[REST API] /files/read error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Diagnostics Operations (requires diagnostics: true)
    // ============================================
    const diagnosticsMiddleware = requireToolEnabled(config, 'diagnostics', 'Diagnostics');

    /**
     * GET /api/diagnostics
     * Get diagnostics for the workspace or specific file
     * Query params: path (optional)
     */
    router.get('/diagnostics', diagnosticsMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string | undefined;
            
            // Use shared service
            const result = await getDiagnostics(path);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({
                diagnostics: result.data!.diagnostics,
                totalCount: result.data!.totalCount,
                fileCount: result.data!.fileCount
            });
        } catch (error) {
            logger.error(`[REST API] /diagnostics error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Symbol Operations (requires symbol: true)
    // ============================================
    const symbolMiddleware = requireToolEnabled(config, 'symbol', 'Symbol');

    /**
     * GET /api/symbols/document
     * Get document symbols for a file
     * Query params: path (required)
     */
    router.get('/symbols/document', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            if (!path) {
                return res.status(400).json({ error: 'path parameter is required' });
            }

            // Use shared service
            const result = await getDocumentSymbols(path);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            // Format symbols for API response (simplified format)
            const formattedSymbols = result.data!.symbols.map(s => ({
                name: s.name,
                kind: s.kind,
                range: s.range,
                children: s.children || []
            }));

            res.json({ 
                symbols: formattedSymbols, 
                count: formattedSymbols.length, 
                total: result.data!.total,
                totalByKind: result.data!.totalByKind,
                path 
            });
        } catch (error) {
            logger.error(`[REST API] /symbols/document error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * GET /api/symbols/workspace
     * Search symbols in the workspace
     * Query params: query (required), maxResults (optional, default: 10)
     */
    router.get('/symbols/workspace', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const query = req.query.query as string;
            if (!query) {
                return res.status(400).json({ error: 'query parameter is required' });
            }

            const maxResultsParam = req.query.maxResults as string | undefined;
            const maxResults = maxResultsParam ? parseInt(maxResultsParam) : 10;

            if (maxResultsParam && isNaN(maxResults)) {
                return res.status(400).json({ error: 'maxResults must be a valid integer' });
            }

            // Use shared service
            const result = await searchWorkspaceSymbols(query, maxResults);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ 
                symbols: result.data!.symbols, 
                count: result.data!.symbols.length,
                total: result.data!.total,
                query 
            });
        } catch (error) {
            logger.error(`[REST API] /symbols/workspace error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * GET /api/symbols/references
     * Find all references to a symbol
     * Query params: path, line, character (or symbol)
     */
    router.get('/symbols/references', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            const line = parseInt(req.query.line as string);
            const characterParam = req.query.character as string | undefined;
            const character = characterParam !== undefined ? parseInt(characterParam) : undefined;
            const symbol = req.query.symbol as string | undefined;

            if (!path || isNaN(line)) {
                return res.status(400).json({ error: 'path and line parameters are required' });
            }

            if (characterParam !== undefined && isNaN(character!)) {
                return res.status(400).json({ error: 'character must be a valid integer' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol parameter is required' });
            }

            // Use shared service
            const result = await findReferences(path, line, character, symbol, true);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ references: result.data, count: result.data!.length });
        } catch (error) {
            logger.error(`[REST API] /symbols/references error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * GET /api/symbols/definition
     * Get symbol definition
     * Query params: path, line, character (or symbol)
     */
    router.get('/symbols/definition', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            const line = parseInt(req.query.line as string);
            const characterParam = req.query.character as string | undefined;
            const character = characterParam !== undefined ? parseInt(characterParam) : undefined;
            const symbol = req.query.symbol as string | undefined;

            if (!path || isNaN(line)) {
                return res.status(400).json({ error: 'path and line parameters are required' });
            }

            if (characterParam !== undefined && isNaN(character!)) {
                return res.status(400).json({ error: 'character must be a valid integer' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol parameter is required' });
            }

            // Use shared service
            const result = await getDefinition(path, line, character, symbol);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ definitions: result.data, count: result.data!.length });
        } catch (error) {
            logger.error(`[REST API] /symbols/definition error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Refactor Operations (requires refactor: true)
    // ============================================
    const refactorMiddleware = requireToolEnabled(config, 'refactor', 'Refactor');

    /**
     * GET /api/refactor/code-actions
     * Get available code actions for a range
     * Query params: path, startLine, endLine (optional, default: startLine)
     */
    router.get('/refactor/code-actions', refactorMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            const startLine = parseInt(req.query.startLine as string);
            const endLineParam = req.query.endLine as string | undefined;

            if (!path || isNaN(startLine)) {
                return res.status(400).json({ error: 'path and startLine parameters are required' });
            }

            let endLine: number | undefined = undefined;
            if (endLineParam !== undefined) {
                endLine = parseInt(endLineParam);
                if (isNaN(endLine)) {
                    return res.status(400).json({ error: 'endLine must be a valid integer' });
                }
            }

            const result = await listCodeActions(
                path,
                startLine,
                endLine ?? undefined,
                0,
                undefined,
                undefined,
                true // include source actions so fix-all entries are available
            );

            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            const data = result.data!;
            const requestId = cacheCodeActions(data.actions, data.uri, data.range);

            res.json({
                requestId,
                actions: data.formattedActions,
                count: data.formattedActions.length,
                expiresIn: '60 seconds'
            });
        } catch (error) {
            logger.error(`[REST API] /refactor/code-actions error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * POST /api/refactor/apply-action
     * Apply a code action from cache
     * Body: { requestId, index, applyAll? }
     */
    router.post('/refactor/apply-action', refactorMiddleware, async (req: Request, res: Response) => {
        try {
            const { requestId, index, applyAll = false } = req.body;

            if (!requestId) {
                return res.status(400).json({ error: 'requestId is required' });
            }

            if (!applyAll && (index === undefined || index === null)) {
                return res.status(400).json({ error: 'index is required when applyAll is false' });
            }

            const cached = getCachedActions(requestId);
            if (!cached) {
                return res.status(404).json({ error: 'Request ID not found or expired. Please call /refactor/code-actions again.' });
            }

            let appliedCount = 0;
            const results: string[] = [];

            if (applyAll) {
                // Use shared service for applyAll - re-fetches after each action
                const applyResult = await applyAllQuickfixes(cached.uri, cached.range);
                appliedCount = applyResult.appliedCount;
                results.push(...applyResult.results);
            } else {
                // Apply single action
                if (cached.actions.length === 0) {
                    return res.status(400).json({ error: 'No actions available to apply' });
                }
                if (index < 0 || index >= cached.actions.length) {
                    return res.status(400).json({ error: `Invalid index ${index}. Valid range: 0 to ${cached.actions.length - 1}` });
                }

                // Use shared service for single action
                const action = cached.actions[index];
                const actionResult = await applySingleCodeAction(action, cached.uri, cached.range);
                const resultMessage = actionResult.message?.trim();
                if (actionResult.applied) {
                    appliedCount++;
                    results.push(resultMessage ? `Applied: ${action.title}\n${resultMessage}` : `Applied: ${action.title}`);
                } else {
                    results.push(resultMessage ? `Failed to apply: ${action.title}\n${resultMessage}` : `Failed to apply: ${action.title}`);
                }
            }

            // Invalidate cache
            removeCachedActions(requestId);

            res.json({
                success: appliedCount > 0,
                appliedCount,
                results
            });
        } catch (error) {
            logger.error(`[REST API] /refactor/apply-action error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * POST /api/refactor/rename
     * Rename a symbol
     * Body: { path, line, character?, symbol?, newName, apply? }
     */
    router.post('/refactor/rename', refactorMiddleware, async (req: Request, res: Response) => {
        try {
            const { path, line, character, symbol, newName, apply = true } = req.body;

            if (!path || line === undefined || line === null || !newName) {
                return res.status(400).json({ error: 'path, line, and newName are required' });
            }

            if (typeof line !== 'number' || isNaN(line) || !Number.isInteger(line)) {
                return res.status(400).json({ error: 'line must be a valid integer' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol is required' });
            }

            if (character !== undefined && (typeof character !== 'number' || isNaN(character) || !Number.isInteger(character))) {
                return res.status(400).json({ error: 'character must be a valid integer' });
            }

            // Use shared service
            const result = await renameSymbol(path, line, character, symbol, newName, apply);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            if (apply) {
                res.json({
                    success: true,
                    applied: true,
                    newName: result.newName,
                    affectedFiles: result.affectedFiles,
                    totalChanges: result.totalChanges
                });
            } else {
                res.json({
                    success: true,
                    applied: false,
                    preview: true,
                    newName: result.newName,
                    affectedFiles: result.affectedFiles,
                    totalChanges: result.totalChanges
                });
            }
        } catch (error) {
            logger.error(`[REST API] /refactor/rename error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Server Info & Configuration
    // ============================================

    /**
     * GET /api/info
     * Get server information and available endpoints
     */
    router.get('/info', (_req: Request, res: Response) => {
        // Build endpoints list based on configuration
        const endpoints: { method: string; path: string; description: string; params?: string[]; body?: string[]; enabled: boolean }[] = [
            { method: 'GET', path: '/api/health', description: 'Health check', enabled: true },
            { method: 'GET', path: '/api/info', description: 'Server information', enabled: true },
            { method: 'GET', path: '/api/files/list', description: 'List files', params: ['path?', 'recursive?'], enabled: config.file },
            { method: 'GET', path: '/api/files/read', description: 'Read file', params: ['path', 'startLine?', 'endLine?'], enabled: config.file },
            { method: 'GET', path: '/api/diagnostics', description: 'Get diagnostics', params: ['path?'], enabled: config.diagnostics },
            { method: 'GET', path: '/api/symbols/document', description: 'Document symbols', params: ['path'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/workspace', description: 'Search symbols', params: ['query', 'maxResults?'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/references', description: 'Find references', params: ['path', 'line', 'character|symbol'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/definition', description: 'Get definition', params: ['path', 'line', 'character|symbol'], enabled: config.symbol },
            { method: 'GET', path: '/api/refactor/code-actions', description: 'Get code actions', params: ['path', 'startLine', 'endLine?'], enabled: config.refactor },
            { method: 'POST', path: '/api/refactor/apply-action', description: 'Apply code action', body: ['requestId', 'index', 'applyAll?'], enabled: config.refactor },
            { method: 'POST', path: '/api/refactor/rename', description: 'Rename symbol', body: ['path', 'line', 'character|symbol', 'newName', 'apply?'], enabled: config.refactor }
        ];

        res.json({
            name: 'vscode-mcp-server',
            version: '0.3.3',
            description: 'VS Code MCP Server REST API',
            enabledTools: config,
            endpoints
        });
    });

    /**
     * GET /api/health
     * Health check endpoint
     */
    router.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            workspace: vscode.workspace.workspaceFolders?.[0]?.name || null
        });
    });

    return router;
}

// ============================================
// Helper Functions
// ============================================

async function listFilesRecursive(
    uri: vscode.Uri,
    workspaceRoot: vscode.Uri,
    files: string[],
    recursive: boolean
): Promise<void> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
            const entryUri = vscode.Uri.joinPath(uri, name);
            const relativePath = vscode.workspace.asRelativePath(entryUri);
            
            if (type === vscode.FileType.File) {
                files.push(relativePath);
            } else if (type === vscode.FileType.Directory && recursive) {
                await listFilesRecursive(entryUri, workspaceRoot, files, recursive);
            }
        }
    } catch (error) {
        logger.error(`[REST API] Error listing files: ${error}`);
    }
}

// Note: Symbol formatting functions are now in services/symbol-service.ts
