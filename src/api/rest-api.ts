/**
 * REST API endpoints for skill script direct access
 * These endpoints provide a simpler HTTP interface compared to MCP protocol
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
 * Apply a single code action
 */
async function applyCodeAction(action: vscode.CodeAction, targetUri: vscode.Uri): Promise<boolean> {
    try {
        // Resolve action if needed
        if (!action.edit && action.command) {
            try {
                const resolved = await vscode.commands.executeCommand<vscode.CodeAction>(
                    'vscode.resolveCodeAction',
                    action
                );
                if (resolved?.edit) {
                    action.edit = resolved.edit;
                }
            } catch {
                // Ignore resolve errors
            }
        }

        // Apply workspace edit
        if (action.edit) {
            const success = await vscode.workspace.applyEdit(action.edit);
            if (success) {
                // Save affected documents
                for (const [uri] of action.edit.entries()) {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    if (doc.isDirty) {
                        await doc.save();
                    }
                }
                return true;
            }
        }

        // Execute command
        if (action.command) {
            await vscode.commands.executeCommand(
                action.command.command,
                ...(action.command.arguments || [])
            );
            return true;
        }

        return false;
    } catch (error) {
        logger.error(`[applyCodeAction] Error: ${error}`);
        return false;
    }
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

            const startLine = req.query.startLine ? parseInt(req.query.startLine as string) : undefined;
            const endLine = req.query.endLine ? parseInt(req.query.endLine as string) : undefined;

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
            
            let diagnostics: { file: string; diagnostics: any[] }[] = [];

            if (path) {
                if (!vscode.workspace.workspaceFolders) {
                    return res.status(400).json({ error: 'No workspace folder open' });
                }
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
                const fileUri = vscode.Uri.joinPath(workspaceRoot, path);
                const fileDiagnostics = vscode.languages.getDiagnostics(fileUri);
                diagnostics.push({
                    file: path,
                    diagnostics: fileDiagnostics.map(d => ({
                        message: d.message,
                        severity: vscode.DiagnosticSeverity[d.severity],
                        range: {
                            start: { line: d.range.start.line + 1, character: d.range.start.character },
                            end: { line: d.range.end.line + 1, character: d.range.end.character }
                        },
                        source: d.source
                    }))
                });
            } else {
                const allDiagnostics = vscode.languages.getDiagnostics();
                for (const [uri, fileDiagnostics] of allDiagnostics) {
                    if (fileDiagnostics.length > 0) {
                        diagnostics.push({
                            file: vscode.workspace.asRelativePath(uri),
                            diagnostics: fileDiagnostics.map(d => ({
                                message: d.message,
                                severity: vscode.DiagnosticSeverity[d.severity],
                                range: {
                                    start: { line: d.range.start.line + 1, character: d.range.start.character },
                                    end: { line: d.range.end.line + 1, character: d.range.end.character }
                                },
                                source: d.source
                            }))
                        });
                    }
                }
            }

            const totalCount = diagnostics.reduce((sum, d) => sum + d.diagnostics.length, 0);
            res.json({ diagnostics, totalCount, fileCount: diagnostics.length });
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

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                fileUri
            );

            const formattedSymbols = formatSymbols(symbols || []);
            res.json({ symbols: formattedSymbols, count: formattedSymbols.length, path });
        } catch (error) {
            logger.error(`[REST API] /symbols/document error: ${error}`);
            res.status(500).json({ error: String(error) });
        }
    });

    /**
     * GET /api/symbols/workspace
     * Search symbols in the workspace
     * Query params: query (required)
     */
    router.get('/symbols/workspace', symbolMiddleware, async (req: Request, res: Response) => {
        try {
            const query = req.query.query as string;
            if (!query) {
                return res.status(400).json({ error: 'query parameter is required' });
            }

            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                query
            );

            const formattedSymbols = (symbols || []).map(s => ({
                name: s.name,
                kind: vscode.SymbolKind[s.kind],
                file: vscode.workspace.asRelativePath(s.location.uri),
                line: s.location.range.start.line + 1,
                character: s.location.range.start.character
            }));

            res.json({ symbols: formattedSymbols, count: formattedSymbols.length, query });
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
            const character = req.query.character ? parseInt(req.query.character as string) : undefined;
            const symbol = req.query.symbol as string | undefined;

            if (!path || isNaN(line)) {
                return res.status(400).json({ error: 'path and line parameters are required' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol parameter is required' });
            }

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            // Open document and validate line number
            const document = await vscode.workspace.openTextDocument(fileUri);
            if (line < 1 || line > document.lineCount) {
                return res.status(400).json({
                    error: `Invalid line ${line}. Valid range: 1 to ${document.lineCount}`
                });
            }

            let charPosition = character;
            if (charPosition === undefined && symbol) {
                const lineText = document.lineAt(line - 1).text;
                charPosition = lineText.indexOf(symbol);
                if (charPosition === -1) {
                    return res.status(404).json({ error: `Symbol "${symbol}" not found on line ${line}` });
                }
            }

            const position = new vscode.Position(line - 1, charPosition!);
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                fileUri,
                position
            ) || [];

            const formattedRefs = references.map(ref => ({
                file: vscode.workspace.asRelativePath(ref.uri),
                line: ref.range.start.line + 1,
                character: ref.range.start.character,
                endLine: ref.range.end.line + 1,
                endCharacter: ref.range.end.character
            }));

            res.json({ references: formattedRefs, count: formattedRefs.length });
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
            const character = req.query.character ? parseInt(req.query.character as string) : undefined;
            const symbol = req.query.symbol as string | undefined;

            if (!path || isNaN(line)) {
                return res.status(400).json({ error: 'path and line parameters are required' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol parameter is required' });
            }

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            // Open document and validate line number
            const document = await vscode.workspace.openTextDocument(fileUri);
            if (line < 1 || line > document.lineCount) {
                return res.status(400).json({
                    error: `Invalid line ${line}. Valid range: 1 to ${document.lineCount}`
                });
            }

            let charPosition = character;
            if (charPosition === undefined && symbol) {
                const lineText = document.lineAt(line - 1).text;
                charPosition = lineText.indexOf(symbol);
                if (charPosition === -1) {
                    return res.status(404).json({ error: `Symbol "${symbol}" not found on line ${line}` });
                }
            }

            const position = new vscode.Position(line - 1, charPosition!);
            const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                fileUri,
                position
            ) || [];

            const formattedDefs = definitions.map(def => ({
                file: vscode.workspace.asRelativePath(def.uri),
                line: def.range.start.line + 1,
                character: def.range.start.character,
                endLine: def.range.end.line + 1,
                endCharacter: def.range.end.character
            }));

            res.json({ definitions: formattedDefs, count: formattedDefs.length });
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
            const endLine = req.query.endLine ? parseInt(req.query.endLine as string) : startLine;

            if (!path || isNaN(startLine)) {
                return res.status(400).json({ error: 'path and startLine parameters are required' });
            }

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            const document = await vscode.workspace.openTextDocument(fileUri);
            
            // Handle empty files
            if (document.lineCount === 0) {
                // Empty file has no code actions, but still cache for consistency
                const emptyRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(0, 0)
                );
                const requestId = cacheCodeActions([], fileUri, emptyRange);
                return res.json({
                    requestId,
                    actions: [],
                    count: 0,
                    expiresIn: '60 seconds'
                });
            }
            
            // Validate startLine is within bounds
            if (startLine < 1 || startLine > document.lineCount) {
                return res.status(400).json({ 
                    error: `Invalid startLine ${startLine}. Valid range: 1 to ${document.lineCount}` 
                });
            }
            
            // Handle endLine: -1 means end of file
            const actualEndLine = endLine === -1 ? document.lineCount : endLine;
            
            // Validate endLine is within bounds (if not -1)
            if (endLine !== -1 && (actualEndLine < 1 || actualEndLine > document.lineCount)) {
                return res.status(400).json({ 
                    error: `Invalid endLine ${endLine}. Valid range: 1 to ${document.lineCount}, or -1 for end of file` 
                });
            }
            
            // Validate startLine <= actualEndLine
            if (startLine > actualEndLine) {
                return res.status(400).json({
                    error: `Invalid range: startLine (${startLine}) cannot be greater than endLine (${actualEndLine})`
                });
            }
            
            const endChar = document.lineAt(actualEndLine - 1).text.length;

            const range = new vscode.Range(
                new vscode.Position(startLine - 1, 0),
                new vscode.Position(actualEndLine - 1, endChar)
            );

            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider',
                fileUri,
                range
            ) || [];

            // Generate request ID and cache actions using shared cache
            const requestId = cacheCodeActions(actions, fileUri, range);

            const formattedActions = actions.map((action, index) => ({
                index,
                title: action.title,
                kind: action.kind?.value || null,
                isPreferred: action.isPreferred || false,
                diagnostics: action.diagnostics?.map(d => d.message) || []
            }));

            res.json({
                requestId,
                actions: formattedActions,
                count: formattedActions.length,
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
                // Apply all quickfix actions (only quickfix kind, not other preferred actions)
                const quickfixes = cached.actions.filter(a => 
                    a.kind?.value?.startsWith('quickfix')
                );

                for (const action of quickfixes) {
                    const success = await applyCodeAction(action, cached.uri);
                    if (success) {
                        appliedCount++;
                        results.push(`Applied: ${action.title}`);
                    }
                }
            } else {
                // Apply single action
                if (cached.actions.length === 0) {
                    return res.status(400).json({ error: 'No actions available to apply' });
                }
                if (index < 0 || index >= cached.actions.length) {
                    return res.status(400).json({ error: `Invalid index ${index}. Valid range: 0 to ${cached.actions.length - 1}` });
                }

                const action = cached.actions[index];
                const success = await applyCodeAction(action, cached.uri);
                if (success) {
                    appliedCount++;
                    results.push(`Applied: ${action.title}`);
                } else {
                    results.push(`Failed to apply: ${action.title}`);
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

            if (!path || !line || !newName) {
                return res.status(400).json({ error: 'path, line, and newName are required' });
            }

            if (character === undefined && !symbol) {
                return res.status(400).json({ error: 'Either character or symbol is required' });
            }

            if (!vscode.workspace.workspaceFolders) {
                return res.status(400).json({ error: 'No workspace folder open' });
            }

            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceRoot, path);

            // Open document and validate line number
            const document = await vscode.workspace.openTextDocument(fileUri);
            if (line < 1 || line > document.lineCount) {
                return res.status(400).json({
                    error: `Invalid line ${line}. Valid range: 1 to ${document.lineCount}`
                });
            }

            let charPosition = character;
            if (charPosition === undefined && symbol) {
                const lineText = document.lineAt(line - 1).text;
                charPosition = lineText.indexOf(symbol);
                if (charPosition === -1) {
                    return res.status(404).json({ error: `Symbol "${symbol}" not found on line ${line}` });
                }
            }

            const position = new vscode.Position(line - 1, charPosition!);

            // Execute rename provider
            const workspaceEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                'vscode.executeDocumentRenameProvider',
                fileUri,
                position,
                newName
            );

            if (!workspaceEdit || workspaceEdit.size === 0) {
                return res.status(400).json({ error: 'No rename edits generated. Symbol may not be renameable.' });
            }

            // Format affected files
            const affectedFiles: { file: string; changes: number }[] = [];
            for (const [uri, edits] of workspaceEdit.entries()) {
                affectedFiles.push({
                    file: vscode.workspace.asRelativePath(uri),
                    changes: edits.length
                });
            }

            if (apply) {
                const success = await vscode.workspace.applyEdit(workspaceEdit);
                if (!success) {
                    return res.status(500).json({ error: 'Failed to apply rename' });
                }

                res.json({
                    success: true,
                    applied: true,
                    newName,
                    affectedFiles,
                    totalChanges: affectedFiles.reduce((sum, f) => sum + f.changes, 0)
                });
            } else {
                res.json({
                    success: true,
                    applied: false,
                    preview: true,
                    newName,
                    affectedFiles,
                    totalChanges: affectedFiles.reduce((sum, f) => sum + f.changes, 0)
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
            { method: 'GET', path: '/api/symbols/workspace', description: 'Search symbols', params: ['query'], enabled: config.symbol },
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

function formatSymbols(symbols: vscode.DocumentSymbol[]): any[] {
    return symbols.map(s => ({
        name: s.name,
        kind: vscode.SymbolKind[s.kind],
        range: {
            start: { line: s.range.start.line + 1, character: s.range.start.character },
            end: { line: s.range.end.line + 1, character: s.range.end.character }
        },
        children: s.children ? formatSymbols(s.children) : []
    }));
}
