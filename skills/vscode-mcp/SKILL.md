---
name: vscode-mcp
description: "IDE Language Server (LSP) capabilities via REST API. Use this skill when: (1) 查找引用/在哪里被引用/被谁调用/find references - 查看变量、函数、类在哪里被使用; (2) 跳转定义/查看类型/go to definition - 查看符号的定义或类型; (3) 重命名/rename - 跨文件安全重命名符号; (4) quickfix/快速修复/Quick Fix/code actions - 先调用 list code actions 查看可用的修复建议，再调用 apply code action 执行修复; (5) 搜索符号/有哪些类/有哪些接口/有哪些方法 - 在工作区搜索类、接口、函数; (6) 文档大纲/列出函数/有哪些私有方法 - 获取文件中的符号结构。Cursor 内置工具不提供这些 LSP 语义分析能力。"
---

# VS Code MCP Server Skill

This skill provides **semantic code analysis** capabilities via VS Code's language server (LSP).

## When to Use This Skill

Use this skill for tasks that require **semantic understanding** of code:

| Task | Trigger Scenarios | API |
|------|-------------------|-----|
| **Find References** | 用户问"这个变量在哪里被使用"；重构前检查影响范围；确认修改是否遗漏 | `/api/symbols/references` |
| **Go to Definition** | 用户问"查看定义"；需要了解变量/函数的类型；跳转到实现 | `/api/symbols/definition` |
| **Rename Symbol** | 用户要求重命名；重构变量/函数/类名；跨文件安全替换 | `/api/refactor/rename` |
| **Code Actions / Quickfix** | 用户要求 quickfix/快速修复/Quick Fix；先 list 查看可用修复，再 apply 执行 | `/api/refactor/code-actions` → `/api/refactor/apply-action` |
| **Search Symbols** | 用户搜索某个类/函数；了解代码结构 | `/api/symbols/workspace` |
| **Document Outline** | 用户要求列出文件结构；快速了解模块组成 | `/api/symbols/document` |

### Agent 自动化任务中的典型触发场景

1. **Quickfix / Code Actions**：用户要求快速修复 → 先调用 list code actions 查看有哪些可用修复，再调用 apply 执行
2. **安全重构**：修改函数签名前 → 使用 references API 找到所有调用点，确保不遗漏
3. **批量重命名**：需要在多个文件中重命名变量 → 使用 rename API（比 grep + 手动替换更安全）
4. **理解代码**：需要了解某个变量的类型或来源 → 使用 definition API

> **Why this skill vs Cursor built-in tools?**
> - Cursor's `grep` finds text matches, but can't understand semantic scope
> - This skill uses VS Code's Language Server for **accurate symbol resolution** and **safe refactoring**

## Prerequisites

1. Install the **vscode-mcp-server** VS Code extension
2. Enable the MCP server (click status bar or run command `MCP: Start Server`)
3. Server runs at `http://127.0.0.1:3000` by default

## Quick Start

```powershell
# PowerShell (Windows) - 推荐使用 Invoke-RestMethod
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" | ConvertTo-Json

# Bash/curl (Linux/macOS)
curl http://127.0.0.1:3000/api/health
```

## Windows PowerShell 调用最佳实践

### 为什么推荐 Invoke-RestMethod 而非 curl.exe

在 Windows PowerShell 环境下，使用 `curl.exe` 传递 JSON 存在严重的转义问题：
- `"` 双引号需要转义为 `\"`
- `$` 符号会被解析为 PowerShell 变量
- `@` 符号会被解析为 PowerShell 展开运算符
- 复杂 JSON 在命令行中难以正确传递

**强烈推荐使用 `Invoke-RestMethod`**，这是 PowerShell 原生方式，无需担心 JSON 转义。

### GET 请求（两种方式都可靠）

```powershell
# Invoke-RestMethod（推荐）
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts" | ConvertTo-Json -Depth 3

# curl.exe（GET 请求无 JSON body，通常安全）
curl.exe -s "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts"
```

### POST 请求（仅推荐 Invoke-RestMethod）

```powershell
# ✅ Invoke-RestMethod（推荐 - 无转义问题）
$body = @{ requestId = "ca_123"; index = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json"

# ❌ curl.exe（不推荐 - 转义复杂且易出错）
# 以下写法在 PowerShell 中容易因引号和变量解析出错
# curl.exe -X POST ... -d '{"key":"value"}'  # 单引号在 PowerShell 中不能用于 curl.exe 参数
```

### 通过 powershell -Command 调用（AI Agent 场景）

当通过外部调用 `powershell -Command "..."` 时，`$` 变量会被外层 shell 提前解析。必须使用反引号转义：

```powershell
# ✅ 正确写法（`$ 转义）
powershell -Command "`$body = @{ requestId = 'ca_123'; index = 0 } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json'"

# ❌ 错误写法（$ 未转义，会丢失变量）
powershell -Command "$body = @{ requestId = 'ca_123'; index = 0 } | ConvertTo-Json; ..."
```

### 布尔值处理

PowerShell 中布尔值为 `$true` / `$false`，通过 `powershell -Command` 调用时需转义为 `` `$true `` / `` `$false ``：

```powershell
# 直接 PowerShell 会话
$body = @{ requestId = "ca_123"; applyAll = $true } | ConvertTo-Json

# 通过 powershell -Command 调用
powershell -Command "`$body = @{ requestId = 'ca_123'; applyAll = `$true } | ConvertTo-Json; ..."
```

### curl.exe 替代方案（如必须使用）

如果必须使用 curl.exe 进行 POST 请求，推荐使用临时文件避免命令行转义问题：

```powershell
# 方法1：写入临时文件（推荐）
$json = '{"requestId":"ca_123","index":0}'
$json | Out-File -FilePath "$env:TEMP\body.json" -Encoding utf8 -NoNewline
curl.exe -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" -H "Content-Type: application/json" --data-binary "@$env:TEMP\body.json"

# 方法2：使用 ConvertTo-Json 确保正确格式
$body = @{ requestId = "ca_123"; index = 0 } | ConvertTo-Json -Compress
$body | Out-File -FilePath "$env:TEMP\body.json" -Encoding utf8 -NoNewline
curl.exe -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" -H "Content-Type: application/json" --data-binary "@$env:TEMP\body.json"
```

> **注意**：使用 `--data-binary "@path"` 读取文件时，路径中的 `@` 需要紧跟文件路径，且在 PowerShell 中需要正确处理路径变量。

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

**PowerShell（推荐）**
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts" | ConvertTo-Json -Depth 3
```

**通过 powershell -Command 调用**
```powershell
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/symbols/document?path=src/server.ts' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS**
```bash
curl -s "http://127.0.0.1:3000/api/symbols/document?path=src/server.ts"
```

### Find All References

**PowerShell（推荐）**
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer" | ConvertTo-Json -Depth 3
```

**通过 powershell -Command 调用**
```powershell
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS**
```bash
curl -s "http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer"
```

### Get Code Actions

**PowerShell（推荐）**
```powershell
# Get all code actions for a file (endLine=-1 means entire file)
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1" | ConvertTo-Json -Depth 3
```

**通过 powershell -Command 调用**
```powershell
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS**
```bash
curl -s "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"
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

**PowerShell（直接会话 - 推荐）**
```powershell
# Apply specific action by index
$body = @{ requestId = "ca_1234567890_abc123"; index = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5

# Apply all quickfix actions at once
$body = @{ requestId = "ca_1234567890_abc123"; applyAll = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
```

**通过 powershell -Command 调用（AI Agent 场景 - 注意 `$ 转义）**
```powershell
# Apply specific action by index
powershell -Command "`$body = @{ requestId = 'ca_1234567890_abc123'; index = 0 } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"

# Apply all quickfix actions at once（注意 `$true 转义）
powershell -Command "`$body = @{ requestId = 'ca_1234567890_abc123'; applyAll = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"
```

**Bash/Linux/macOS**
```bash
# Apply specific action by index
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"ca_1234567890_abc123","index":0}'

# Apply all quickfix actions
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"ca_1234567890_abc123","applyAll":true}'
```

> **⚠️ Windows curl.exe 注意事项**：
> - `curl -d @file.json` 语法在 PowerShell 中不可用（`@` 被解释为展开运算符）
> - 直接在命令行传递 JSON 需要复杂的引号转义，极易出错
> - **强烈推荐使用 `Invoke-RestMethod`**，避免所有转义问题

> **💡 AI Agent 调用提示**：当通过 `powershell -Command "..."` 调用时：
> - `$` 变量必须转义为 `` `$ ``（如 `` `$body `` 而非 `$body`）
> - `$true`/`$false` 必须转义为 `` `$true ``/`` `$false ``
> - 使用单引号包裹字符串值（如 `'ca_123'` 而非 `"ca_123"`）

### Batch Fix (Fix All & Quickfix Sweep)

- Set `applyAll=true` with `apply_code_action_code` or the REST `/api/refactor/apply-action` endpoint to run the same sequential quickfix sweep that the MCP tools expose (great for multiple "Prefix 'req' with an underscore" items).
- When a provider exposes a `source.fixAll` / `refactor.fixAll` action such as "Prefix all unused declarations" but fails to return edits, the REST layer automatically falls back to this quickfix sweep so you still get a complete batch fix.
- Recommended flow:
  1. Call `list_code_actions_code` or `/api/refactor/code-actions?startLine=1&endLine=-1` to obtain a `requestId`;
  2. Apply the desired `source.fixAll` action (single index). If it produces no changes, the server transparently runs the quickfix sweep and surfaces detailed logs;
  3. Alternatively, call `/api/refactor/apply-action` with `applyAll=true` directly to trigger the sweep explicitly.

**PowerShell（直接会话 - 推荐）**
```powershell
# Step 1: Get code actions
$list = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"
$list | ConvertTo-Json -Depth 3

# Step 2: Apply all quickfix actions（使用返回的 requestId）
$body = @{ requestId = $list.requestId; applyAll = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/apply-action" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
```

**通过 powershell -Command 调用（需转义 `$ 变量）**
```powershell
# Step 1: Get code actions（记录返回的 requestId）
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1' | ConvertTo-Json -Depth 3"

# Step 2: Apply all quickfix actions（手动替换 requestId 为上一步返回的值）
powershell -Command "`$body = @{ requestId = 'ca_xxxxxxxxx_xxxxxx'; applyAll = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/apply-action' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 5"
```

**Bash/Linux/macOS**
```bash
# Step 1: Get code actions and note the requestId
curl -s "http://127.0.0.1:3000/api/refactor/code-actions?path=src/server.ts&startLine=1&endLine=-1"

# Step 2: Apply all quickfix actions
curl -s -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"ca_xxxxxxxxx_xxxxxx","applyAll":true}'
```

### Rename Symbol

**PowerShell（直接会话 - 推荐）**
```powershell
# Preview rename (apply=$false)
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $false } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3

# Apply rename (apply=$true)
$body = @{ path = "src/server.ts"; line = 25; symbol = "MCPServer"; newName = "McpServer"; apply = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3
```

**通过 powershell -Command 调用（注意 `$false / `$true 转义）**
```powershell
# Preview rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$false } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"

# Apply rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS**
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

**PowerShell（直接会话 - 推荐）**
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

**通过 powershell -Command 调用（注意所有 `$ 转义）**
```powershell
# Step 1: Find all references
powershell -Command "`$refs = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/symbols/references?path=src/server.ts&line=25&symbol=MCPServer'; Write-Host 'Found' `$refs.count 'references'; `$refs.references | ConvertTo-Json"

# Step 2: Preview rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$false } | ConvertTo-Json; `$preview = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json'; `$preview.affectedFiles | ConvertTo-Json"

# Step 3: Apply rename
powershell -Command "`$body = @{ path = 'src/server.ts'; line = 25; symbol = 'MCPServer'; newName = 'McpServer'; apply = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"
```

**Bash/Linux/macOS**
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
