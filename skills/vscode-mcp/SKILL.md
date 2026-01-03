---
name: vscode-mcp
description: VS Code MCP Server semantic analysis skill for AI coding agents. Provides diagnostics, symbol navigation, references, and refactoring capabilities via REST API. Recommended for Claude Code - complements existing file/edit/shell tools with VS Code's language server features.
---

# VS Code MCP Server Skill

This skill enables AI agents to access VS Code's language server capabilities for semantic code analysis.

**Recommended for Claude Code**: This skill provides diagnostics, symbol analysis, and refactoring tools that complement Claude Code's built-in file/edit/shell capabilities.

## Recommended Configuration (Semantic-Only)

Add to your VS Code `settings.json` to enable only semantic tools:

```json
{
  "vscode-mcp-server.enabledTools": {
    "file": false,
    "edit": false,
    "shell": false,
    "diagnostics": true,
    "symbol": true,
    "refactor": true
  }
}
```

This configuration:
- ❌ Disables file/edit/shell (use Claude Code's native tools)
- ✅ Enables diagnostics (linter errors, warnings)
- ✅ Enables symbol tools (document symbols, workspace search, references, definitions)
- ✅ Enables refactor tools (rename, code actions)

## Prerequisites

1. Install the **vscode-mcp-server** VS Code extension
2. Apply the semantic-only configuration above
3. Enable the MCP server (click status bar or run command)
4. Server runs at `http://127.0.0.1:3000` by default

## Quick Start

Test connection:
```bash
curl http://127.0.0.1:3000/api/health
```

## Available API Endpoints

### Server Info
- `GET /api/info` - List all available endpoints
- `GET /api/health` - Health check

### Diagnostics
- `GET /api/diagnostics` - Get all diagnostics
- `GET /api/diagnostics?path=src/main.ts` - Get file diagnostics

### Symbol Operations
- `GET /api/symbols/document?path=src/main.ts` - Document symbols
- `GET /api/symbols/workspace?query=MyClass` - Search workspace symbols
- `GET /api/symbols/references?path=src/main.ts&line=10&symbol=myFunc` - Find references
- `GET /api/symbols/definition?path=src/main.ts&line=10&symbol=myFunc` - Go to definition

### File Operations (if enabled)
- `GET /api/files/list?path=&recursive=true` - List files
- `GET /api/files/read?path=src/main.ts` - Read file content

## Configuration Presets

Available in `presets/` directory:

- **semantic-only.json** ⭐ (Recommended for Claude Code)
- **full-featured.json** (All tools enabled)
- **readonly.json** (Read-only access)

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
