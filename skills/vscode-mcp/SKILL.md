---
name: vscode-mcp
description: VS Code MCP Server integration for AI coding agents. Provides REST API access to VS Code's language server features including diagnostics, symbol navigation, references, and code analysis. Use when you need to interact with VS Code's semantic code understanding capabilities via HTTP API calls from scripts.
---

# VS Code MCP Server Skill

This skill enables AI agents to interact with VS Code's language server capabilities through a simple REST API.

## Prerequisites

1. Install the **vscode-mcp-server** VS Code extension
2. Enable the MCP server (click status bar or run command)
3. Server runs at `http://127.0.0.1:3000` by default

## Quick Start

Test connection:
```bash
curl http://127.0.0.1:3000/api/health
```

## Available API Endpoints

### Server Info
- `GET /api/info` - List all available endpoints
- `GET /api/health` - Health check

### File Operations
- `GET /api/files/list?path=&recursive=true` - List files
- `GET /api/files/read?path=src/main.ts` - Read file content
- `GET /api/files/read?path=src/main.ts&startLine=1&endLine=50` - Read partial file

### Diagnostics
- `GET /api/diagnostics` - Get all diagnostics
- `GET /api/diagnostics?path=src/main.ts` - Get file diagnostics

### Symbol Operations
- `GET /api/symbols/document?path=src/main.ts` - Document symbols
- `GET /api/symbols/workspace?query=MyClass` - Search workspace symbols
- `GET /api/symbols/references?path=src/main.ts&line=10&symbol=myFunc` - Find references
- `GET /api/symbols/definition?path=src/main.ts&line=10&symbol=myFunc` - Go to definition

## Configuration Presets

For different use cases, apply configuration presets to VS Code settings:

- **Semantic-only mode** (for use with Claude Code): See `presets/semantic-only.json`
- **Full-featured mode**: See `presets/full-featured.json`
- **Read-only mode**: See `presets/readonly.json`

## Usage with Scripts

Use the provided Python scripts in `scripts/` directory:

```bash
# Test connection
python scripts/test_connection.py

# Get diagnostics
python scripts/get_diagnostics.py

# Find references
python scripts/find_references.py src/main.ts 10 myFunction
```

## API Response Format

All endpoints return JSON responses:

```json
{
  "data": "...",
  "count": 10,
  "error": null
}
```

Error responses include:
```json
{
  "error": "Error message"
}
```

## Detailed API Documentation

For complete API reference, see [references/api-docs.md](references/api-docs.md).
