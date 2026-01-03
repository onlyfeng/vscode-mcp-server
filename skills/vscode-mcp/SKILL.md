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
# PowerShell (Windows) - use ConvertTo-Json for readable output
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" | ConvertTo-Json

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
| GET | `/api/symbols/workspace?query=MyClass&maxResults=10` | Search symbols across workspace (maxResults optional, default: 10) |
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
# PowerShell (direct pipe - works in shell and via powershell -Command)
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts" | ConvertTo-Json -Depth 3
```

```bash
# curl (Linux/macOS/Windows)
curl.exe -s "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts"
```

### Find All References
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer" | ConvertTo-Json -Depth 3
```

```bash
curl.exe -s "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer"
```

### Get Code Actions
```powershell
# Get all code actions for a file (endLine=-1 means entire file)
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1" | ConvertTo-Json -Depth 3
```

```bash
curl.exe -s "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"
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

**PowerShell (直接在 PowerShell 会话中使用)**
```powershell
# Apply specific action by index
$body = @{ requestId = "ca_1234567890_abc123"; index = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5

# Apply all quickfix actions at once
$body = @{ requestId = "ca_1234567890_abc123"; applyAll = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
```

**PowerShell (通过 powershell -Command 调用，需转义 $ 变量)**
```powershell
# Apply specific action by index (注意 `$ 转义)
powershell -Command "`$body = @{ requestId = 'ca_1234567890_abc123'; index = 0 } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"

# Apply all quickfix actions at once
powershell -Command "`$body = @{ requestId = 'ca_1234567890_abc123'; applyAll = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"
```

**Bash/Linux/macOS (curl)**
```bash
# Apply specific action by index (replace requestId with actual value from code-actions response)
# First create body.json with content: {"requestId":"ca_1234567890_abc123","index":0}
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" -H "Content-Type: application/json" -d @body.json

# Or inline JSON (bash only):
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"ca_1234567890_abc123","applyAll":true}'
```

> **Note**: `curl -d @file.json` 语法在 PowerShell 中不可用（`@` 被解释为展开运算符）。Windows PowerShell 用户请使用上述 `Invoke-RestMethod` 方法。

> **重要 (AI Agent 调用)**: 当通过 `powershell -Command "..."` 调用时，`$` 变量会被外层 shell 提前解析导致丢失。必须使用反引号转义：`` `$body `` 而非 `$body`，`` `$true `` 而非 `$true`。上述示例中已提供两种写法。

### Batch Fix (Fix All & Quickfix Sweep)

- Set `applyAll=true` with `apply_code_action_code` or the REST `/api/refactor/apply-action` endpoint to run the same sequential quickfix sweep that the MCP tools expose (great for multiple “Prefix 'req' with an underscore” items).
- When a provider exposes a `source.fixAll` / `refactor.fixAll` action such as “Prefix all unused declarations” but fails to return edits, the REST layer automatically falls back to this quickfix sweep so you still get a complete batch fix.
- Recommended flow:
  1. Call `list_code_actions_code` or `/api/refactor/code-actions?startLine=1&endLine=-1` to obtain a `requestId`;
  2. Apply the desired `source.fixAll` action (single index). If it produces no changes, the server transparently runs the quickfix sweep and surfaces detailed logs;
  3. Alternatively, call `/api/refactor/apply-action` with `applyAll=true` directly to trigger the sweep explicitly.

**PowerShell (直接在 PowerShell 会话中使用)**
```powershell
# Step 1: Get code actions
$list = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"
$list | ConvertTo-Json -Depth 3

# Step 2: Apply all quickfix actions (使用返回的 requestId)
$body = @{ requestId = $list.requestId; applyAll = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
```

**PowerShell (通过 powershell -Command 调用，需转义 $ 变量)**
```powershell
# Step 1: Get code actions
powershell -Command "`$list = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1'; `$list | ConvertTo-Json -Depth 3"

# Step 2: Apply all quickfix actions (需手动替换 requestId)
powershell -Command "`$body = @{ requestId = 'ca_xxxxxxxxx_xxxxxx'; applyAll = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"
```

**Bash/Linux/macOS (curl)**
```bash
# Step 1: Get code actions and note the requestId
curl -s "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"

# Step 2: Apply all quickfix actions (inline JSON)
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"ca_xxxxxxxxx_xxxxxx","applyAll":true}'
```

### Rename Symbol

**PowerShell (直接在 PowerShell 会话中使用)**
```powershell
# Preview rename (apply=$false)
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $false } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3

# Apply rename (apply=$true)
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3
```

**PowerShell (通过 powershell -Command 调用，需转义 $ 变量)**
```powershell
# Preview rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$false } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"

# Apply rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS (curl)**
```bash
# Preview rename
curl -s -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path":"src/server.ts","line":25,"symbol":"MCPServer","newName":"McpServer","apply":false}'

# Apply rename
curl -s -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path":"src/server.ts","line":25,"symbol":"MCPServer","newName":"McpServer","apply":true}'
```

## Workflow: Find References and Rename

**PowerShell (直接在 PowerShell 会话中使用)**
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
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3
```

**PowerShell (通过 powershell -Command 调用，需转义 $ 变量)**
```powershell
# Step 1: Find all references
powershell -Command "`$refs = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer'; Write-Host 'Found' `$refs.count 'references'; `$refs.references | ConvertTo-Json"

# Step 2: Preview rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$false } | ConvertTo-Json; `$preview = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json'; `$preview.affectedFiles | ConvertTo-Json"

# Step 3: Apply rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS (curl)**
```bash
# Step 1: Find all references to understand impact
curl -s "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer"

# Step 2: Preview rename
curl -s -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path":"src/server.ts","line":25,"symbol":"MCPServer","newName":"McpServer","apply":false}'

# Step 3: Apply rename
curl -s -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path":"src/server.ts","line":25,"symbol":"MCPServer","newName":"McpServer","apply":true}'
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
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/info" | ConvertTo-Json -Depth 3
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

**Symbol Operations:**
- `get_document_symbols_code` - Get document symbols
- `search_symbols_code` - Search workspace symbols
- `get_symbol_definition_code` - Navigate to symbol definition
- `get_references_code` - Find all references to a symbol

**Refactor Operations:**
- `list_code_actions_code` - List available code actions  
- `apply_code_action_code` - Apply a cached code action
- `rename_symbol_code` - Rename symbol across workspace

Note: File, Edit, Shell, and Diagnostics tools are available via MCP protocol but not exposed via REST API (use Cursor's built-in tools instead).

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
