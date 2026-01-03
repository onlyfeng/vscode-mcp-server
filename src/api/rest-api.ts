/**
 * REST API endpoints for skill script direct access
 * These endpoints provide a simpler HTTP interface compared to MCP protocol
 */

import { Router, Request, Response } from 'express';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';

/**
 * Creates and configures the REST API router
 * @returns Express Router with all REST API endpoints
 */
export function createRestApiRouter(): Router {
    const router = Router();

    // Middleware to log all API requests
    router.use((req, res, next) => {
        logger.info(`[REST API] ${req.method} ${req.path}`);
        next();
    });

    // ============================================
    // File Operations
    // ============================================

    /**
     * GET /api/files/list
     * List files in the workspace
     * Query params: path (optional), recursive (optional, default: false)
     */
    router.get('/files/list', async (req: Request, res: Response) => {
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
    router.get('/files/read', async (req: Request, res: Response) => {
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
                const start = startLine ? startLine - 1 : 0;
                const end = endLine === -1 ? lineCount - 1 : (endLine ? endLine - 1 : lineCount - 1);
                const lines: string[] = [];
                for (let i = start; i <= Math.min(end, lineCount - 1); i++) {
                    lines.push(document.lineAt(i).text);
                }
                content = lines.join('\n');
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
    // Diagnostics Operations
    // ============================================

    /**
     * GET /api/diagnostics
     * Get diagnostics for the workspace or specific file
     * Query params: path (optional)
     */
    router.get('/diagnostics', async (req: Request, res: Response) => {
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
    // Symbol Operations
    // ============================================

    /**
     * GET /api/symbols/document
     * Get document symbols for a file
     * Query params: path (required)
     */
    router.get('/symbols/document', async (req: Request, res: Response) => {
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
    router.get('/symbols/workspace', async (req: Request, res: Response) => {
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
    router.get('/symbols/references', async (req: Request, res: Response) => {
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

            let charPosition = character;
            if (charPosition === undefined && symbol) {
                const document = await vscode.workspace.openTextDocument(fileUri);
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
    router.get('/symbols/definition', async (req: Request, res: Response) => {
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

            let charPosition = character;
            if (charPosition === undefined && symbol) {
                const document = await vscode.workspace.openTextDocument(fileUri);
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
    // Server Info & Configuration
    // ============================================

    /**
     * GET /api/info
     * Get server information and available endpoints
     */
    router.get('/info', (_req: Request, res: Response) => {
        res.json({
            name: 'vscode-mcp-server',
            version: '0.3.1',
            description: 'VS Code MCP Server REST API',
            endpoints: [
                { method: 'GET', path: '/api/info', description: 'Server information' },
                { method: 'GET', path: '/api/files/list', description: 'List files', params: ['path?', 'recursive?'] },
                { method: 'GET', path: '/api/files/read', description: 'Read file', params: ['path', 'startLine?', 'endLine?'] },
                { method: 'GET', path: '/api/diagnostics', description: 'Get diagnostics', params: ['path?'] },
                { method: 'GET', path: '/api/symbols/document', description: 'Document symbols', params: ['path'] },
                { method: 'GET', path: '/api/symbols/workspace', description: 'Search symbols', params: ['query'] },
                { method: 'GET', path: '/api/symbols/references', description: 'Find references', params: ['path', 'line', 'character|symbol'] },
                { method: 'GET', path: '/api/symbols/definition', description: 'Get definition', params: ['path', 'line', 'character|symbol'] }
            ]
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
