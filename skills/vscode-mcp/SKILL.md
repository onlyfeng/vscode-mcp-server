---
name: vscode-mcp
description: VS Code MCP Server semantic analysis skill for AI coding agents. Provides symbol navigation, references, and refactoring capabilities via REST API. Recommended for Cursor/Claude Code - complements existing file/edit/shell tools with VS Code's language server features.
---

# VS Code MCP Server Skill

This skill provides **semantic code analysis** capabilities via VS Code's language server.

**For Cursor/Claude Code users**: Use `semantic-only.json` preset - this skill focuses on symbol analysis and refactoring, complementing Cursor's built-in file/edit/shell/diagnostics tools.

## Prerequisites

1. Install the **vscode-mcp-server** VS Code extension
2. Enable the MCP server (click status bar or run command `MCP: Start Server`)
3. Server runs at `http://127.0.0.1:3000` by default

## Quick Start

```powershell
# PowerShell (Windows)
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health"

# Bash/curl (Linux/macOS)
curl http://127.0.0.1:3000/api/health
```

## Core REST API Endpoints

### Server Info (Always Available)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/info` | List all endpoints and their enabled status |

### Symbol Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/symbols/document?path=src/main.ts` | Get document symbols (classes, functions, etc.) |
| GET | `/api/symbols/workspace?query=MyClass` | Search symbols across workspace |
| GET | `/api/symbols/references?path=...&line=10&symbol=myFunc` | Find all references to a symbol |
| GET | `/api/symbols/definition?path=...&line=10&symbol=myFunc` | Go to definition |

### Refactor Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/refactor/code-actions?path=...&startLine=1&endLine=-1` | List available code actions |
| POST | `/api/refactor/apply-action` | Apply a code action |
| POST | `/api/refactor/rename` | Rename symbol across workspace |

## Usage Examples

### Get Document Symbols
```powershell
$symbols = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts"
$symbols.symbols | ConvertTo-Json -Depth 3
```

### Find All References
```powershell
$refs = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer"
$refs.references | ConvertTo-Json
```

### Get Code Actions
```powershell
# Get all code actions for a file (endLine=-1 means entire file)
$actions = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"
$actions.actions | ConvertTo-Json
```

Response:
```json
{
  "requestId": "ca_1234567890_abc123",
  "actions": [
    { "index": 0, "title": "Remove unused import", "kind": "quickfix", "isPreferred": true },
    { "index": 1, "title": "Organize imports", "kind": "source.organizeImports" }
  ],
  "count": 2,
  "expiresIn": "60 seconds"
}
```

### Apply Code Action
```powershell
# Apply specific action by index
$body = @{ requestId = "ca_1234567890_abc123"; index = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json"

# Apply all quickfix actions at once
$body = @{ requestId = "ca_1234567890_abc123"; applyAll = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json"
```

### Rename Symbol
```powershell
# Preview rename (apply=false)
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $false } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json"

# Apply rename
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json"
```

## Workflow: Find References and Rename

```powershell
# Step 1: Find all references to understand impact
$refs = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer"
Write-Host "Found $($refs.count) references"
$refs.references | ConvertTo-Json

# Step 2: Preview rename changes
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $false } | ConvertTo-Json
$preview = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json"
$preview.affectedFiles | ConvertTo-Json

# Step 3: Apply rename if satisfied
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json"
```

## Configuration

### Recommended: semantic-only.json

Copy `presets/semantic-only.json` to your VS Code settings:

```json
{
  "vscode-mcp-server.enabledTools": {
    "file": false,
    "edit": false,
    "shell": false,
    "diagnostics": false,
    "symbol": true,
    "refactor": true
  }
}
```

This configuration:
- ✅ Enables: Symbol analysis, refactoring, code actions, rename
- ❌ Disables: File/edit/shell/diagnostics (use Cursor's built-in tools)

### Check Current Configuration

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/info"
```

Response shows enabled status for each endpoint:
```json
{
  "enabledTools": { "file": false, "symbol": true, "refactor": true, ... },
  "endpoints": [
    { "path": "/api/symbols/document", "enabled": true },
    { "path": "/api/refactor/rename", "enabled": true },
    ...
  ]
}
```

## Python Scripts

Helper scripts in `scripts/` directory:

```bash
pip install -r scripts/requirements.txt

# Test connection
python scripts/test_connection.py

# Find references
python scripts/find_references.py src/server.ts 25 MCPServer
```

## MCP Tools (via MCP Protocol)

Available MCP tools for direct protocol access:

- `get_references_code` - Find all references to a symbol
- `list_code_actions_code` - List available code actions  
- `apply_code_action_code` - Apply a cached code action
- `rename_symbol_code` - Rename symbol across workspace
- `get_document_symbols_code` - Get document symbols
- `search_symbols_code` - Search workspace symbols
- `get_symbol_definition_code` - Navigate to symbol definition

## API Response Format

Success:
```json
{ "data": "...", "count": 10, "success": true }
```

Error:
```json
{ "error": "Error message" }
```

Disabled endpoint (403):
```json
{ "error": "File endpoints are disabled by configuration", "hint": "Update vscode-mcp-server.enabledTools setting" }
```

## Detailed API Documentation

For complete API reference including all presets, see [references/api-docs.md](references/api-docs.md).
