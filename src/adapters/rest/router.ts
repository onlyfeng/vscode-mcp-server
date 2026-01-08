/**
 * REST API Router - Unified REST endpoint routing
 * Routes REST requests to core layer functions
 */

import { Router, Request, Response } from 'express';
import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { ToolConfiguration, DEFAULT_TOOL_CONFIG } from '../../config';
import { requireToolEnabled } from './middleware/enabledToolsGuard';
import {
    cacheCodeActions,
    getCachedActions,
    removeCachedActions
} from '../../utils/code-actions-cache';

// Core imports
import {
    // Symbol operations
    getDocumentSymbols,
    searchWorkspaceSymbols,
    findReferences,
    getDefinition,
    getSymbolHoverInfo,
    // Refactor operations
    listCodeActions,
    applySingleCodeAction,
    applyAllQuickfixes,
    renameSymbol,
    // Diagnostics
    getDiagnostics,
    // File operations
    listWorkspaceFiles,
    readWorkspaceFile
} from '../../core';

/**
 * Creates and configures the REST API router
 * @param toolConfig Tool configuration to control which endpoints are enabled
 * @returns Express Router with all REST API endpoints
 */
export function createRestApiRouter(toolConfig?: ToolConfiguration): Router {
    const router = Router();
    
    const config: ToolConfiguration = toolConfig ?? { ...DEFAULT_TOOL_CONFIG };
    
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

    router.get('/files/list', fileMiddleware, async (req: Request, res: Response) => {
        try {
            const path = (req.query.path as string) || '';
            const recursive = req.query.recursive === 'true';

            const result = await listWorkspaceFiles(path, recursive);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            const files = result.data!.map(f => f.path);
            res.json({ files, count: files.length });
        } catch (error) {
            logger.error(`[REST API] /files/list error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

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

            if (startLineParam && isNaN(startLine!)) {
                return res.status(400).json({ error: 'startLine must be a valid integer' });
            }
            if (endLineParam && isNaN(endLine!)) {
                return res.status(400).json({ error: 'endLine must be a valid integer' });
            }

            // Convert 1-based to 0-based
            const zeroBasedStart = startLine !== undefined ? (startLine === -1 ? -1 : startLine - 1) : -1;
            const zeroBasedEnd = endLine !== undefined ? (endLine === -1 ? -1 : endLine - 1) : -1;

            const result = await readWorkspaceFile(path, {
                startLine: zeroBasedStart,
                endLine: zeroBasedEnd
            });

            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({
                content: result.data!.content,
                // Preferred: explicit range of lines returned (1-based, inclusive)
                linesRead: result.data!.linesRead,
                // Backward compatibility: historically exposed as "lineCount" but actually meant "end line"
                lineCount: result.data!.linesRead ? result.data!.linesRead.end : undefined,
                path
            });
        } catch (error) {
            logger.error(`[REST API] /files/read error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Diagnostics Operations (requires diagnostics: true)
    // ============================================
    const diagnosticsMiddleware = requireToolEnabled(config, 'diagnostics', 'Diagnostics');

    router.get('/diagnostics', diagnosticsMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string | undefined;
            
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

    router.get('/symbols/document', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const path = req.query.path as string;
            if (!path) {
                return res.status(400).json({ error: 'path parameter is required' });
            }

            const result = await getDocumentSymbols(path);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

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

    // NEW: Hover endpoint for type information
    router.get('/symbols/hover', symbolMiddleware, async (req: Request, res: Response) => {
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

            const result = await getSymbolHoverInfo(path, line, character, symbol);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ hovers: result.data!.hovers, count: result.data!.hovers.length });
        } catch (error) {
            logger.error(`[REST API] /symbols/hover error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    // ============================================
    // Refactor Operations (requires refactor: true)
    // ============================================
    const refactorMiddleware = requireToolEnabled(config, 'refactor', 'Refactor');

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
                true
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

    router.post('/refactor/apply-action', refactorMiddleware, async (req: Request, res: Response) => {
        try {
            const { requestId, index, applyAll = false, applyPreferred = false } = req.body;

            if (!requestId) {
                return res.status(400).json({ error: 'requestId is required' });
            }

            if (!applyAll && !applyPreferred && (index === undefined || index === null)) {
                return res.status(400).json({ error: 'index is required when applyAll and applyPreferred are both false' });
            }

            const cached = getCachedActions(requestId);
            if (!cached) {
                return res.status(404).json({ error: 'Request ID not found or expired. Please call /refactor/code-actions again.' });
            }

            let appliedCount = 0;
            const results: string[] = [];

            if (index !== undefined && index !== null) {
                if (cached.actions.length === 0) {
                    return res.status(400).json({ error: 'No actions available to apply' });
                }
                if (index < 0 || index >= cached.actions.length) {
                    return res.status(400).json({ error: `Invalid index ${index}. Valid range: 0 to ${cached.actions.length - 1}` });
                }

                const action = cached.actions[index];
                const actionResult = await applySingleCodeAction(action, cached.uri, cached.range);
                const resultMessage = actionResult.message?.trim();
                if (actionResult.applied) {
                    appliedCount++;
                    results.push(resultMessage ? `Applied: ${action.title}\n${resultMessage}` : `Applied: ${action.title}`);
                } else {
                    results.push(resultMessage ? `Failed to apply: ${action.title}\n${resultMessage}` : `Failed to apply: ${action.title}`);
                }
            } else if (applyPreferred) {
                const applyResult = await applyAllQuickfixes(cached.uri, cached.range, 50, true);
                appliedCount = applyResult.appliedCount;
                results.push(...applyResult.results);
            } else if (applyAll) {
                const applyResult = await applyAllQuickfixes(cached.uri, cached.range);
                appliedCount = applyResult.appliedCount;
                results.push(...applyResult.results);
            }

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

    router.get('/info', (_req: Request, res: Response) => {
        const endpoints = [
            { method: 'GET', path: '/api/health', description: 'Health check', enabled: true },
            { method: 'GET', path: '/api/info', description: 'Server information', enabled: true },
            { method: 'GET', path: '/api/files/list', description: 'List files', params: ['path?', 'recursive?'], enabled: config.file },
            { method: 'GET', path: '/api/files/read', description: 'Read file', params: ['path', 'startLine?', 'endLine?'], enabled: config.file },
            { method: 'GET', path: '/api/diagnostics', description: 'Get diagnostics', params: ['path?'], enabled: config.diagnostics },
            { method: 'GET', path: '/api/symbols/document', description: 'Document symbols', params: ['path'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/workspace', description: 'Search symbols', params: ['query', 'maxResults?'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/references', description: 'Find references', params: ['path', 'line', 'character|symbol'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/definition', description: 'Get definition location', params: ['path', 'line', 'character|symbol'], enabled: config.symbol },
            { method: 'GET', path: '/api/symbols/hover', description: 'Get hover/type info', params: ['path', 'line', 'character|symbol'], enabled: config.symbol },
            { method: 'GET', path: '/api/refactor/code-actions', description: 'Get code actions', params: ['path', 'startLine', 'endLine?'], enabled: config.refactor },
            { method: 'POST', path: '/api/refactor/apply-action', description: 'Apply code action', body: ['requestId', 'index?', 'applyAll?', 'applyPreferred?'], enabled: config.refactor },
            { method: 'POST', path: '/api/refactor/rename', description: 'Rename symbol', body: ['path', 'line', 'character|symbol', 'newName', 'apply?'], enabled: config.refactor }
        ];

        res.json({
            name: 'vscode-mcp-server',
            version: '0.4.0',
            description: 'VS Code MCP Server REST API',
            enabledTools: config,
            endpoints
        });
    });

    router.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            workspace: vscode.workspace.workspaceFolders?.[0]?.name || null
        });
    });

    return router;
}
