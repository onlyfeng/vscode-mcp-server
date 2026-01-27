---
name: vscode-mcp
description: "IDE Language Server (LSP) capabilities via REST API. Use this skill when: (1) 引用/调用/find references/where used/who calls/谁调用了/哪里用到 - 查看变量、函数、类在哪里被使用; (2) 跳转定义/查看类型/什么类型/检查类型/go to definition/type/hover - 查看符号的定义或类型; (3) 重命名/rename/改名 - 跨文件安全重命名符号; (4) quickfix/快速修复/Quick Fix/code actions - 先调用 list code actions 查看可用的修复建议，再调用 apply code action 执行修复; (5) 搜索符号/哪些类/哪些接口/search symbols/workspace symbols/找类/找接口/找函数 - 在工作区搜索类、接口、函数; (6) 文档大纲/哪些方法/公开方法/私有方法/outline/list symbols/methods/文件结构 - 获取文件中的符号结构; (7) 重构/refactor/extract/inline/提取/拆分/移动方法/提取接口 - 执行重构任务时涉及跨文件符号修改，应使用 LSP rename/references 确保安全而非手动 grep 替换。Cursor 内置工具不提供这些 LSP 语义分析能力。"
---

# VS Code MCP Server Skill

This skill provides **semantic code analysis** capabilities via VS Code's language server (LSP).

## When to Use This Skill

Use this skill for tasks that require **semantic understanding** of code:

| Task | Trigger Scenarios | Python Script |
|------|-------------------|---------------|
| **Find References** | 用户问"这个变量在哪里被使用"；重构前检查影响范围；确认修改是否遗漏 | `find_references.py` |
| **Go to Definition** | 用户问"查看定义"；需要了解变量/函数的类型；跳转到实现 | `get_definition.py` |
| **Rename Symbol** | 用户要求重命名；重构变量/函数/类名；跨文件安全替换 | `rename_symbol.py` |
| **Code Actions / Quickfix** | 用户要求 quickfix/快速修复/Quick Fix；先 list 查看可用修复，再 apply 执行 | `code_actions.py` |
| **Search Symbols** | 用户搜索某个类/函数；了解代码结构 | `search_symbols.py` |
| **Document Outline** | 用户要求列出文件结构；快速了解模块组成 | `get_document_symbols.py` |

### Agent 自动化任务中的典型触发场景

1. **Quickfix / Code Actions**：用户要求快速修复 → 先调用 `code_actions.py` 查看有哪些可用修复，再调用 `--apply` 执行
2. **安全重构**：修改函数签名前 → 使用 `find_references.py` 找到所有调用点，确保不遗漏
3. **批量重命名**：需要在多个文件中重命名变量 → 使用 `rename_symbol.py`（比 grep + 手动替换更安全）
4. **理解代码**：需要了解某个变量的类型或来源 → 使用 `get_definition.py`

> **Why this skill vs Cursor built-in tools?**
> - Cursor's `grep` finds text matches, but can't understand semantic scope
> - This skill uses VS Code's Language Server for **accurate symbol resolution** and **safe refactoring**

## Prerequisites

1. Install the **vscode-mcp-server** VS Code extension
2. Enable the MCP server (click status bar or run command `MCP: Start Server`)
3. Install Python dependencies: `pip install -r scripts/requirements.txt`

### Port/Host Configuration

All scripts automatically read port/host from VS Code/Cursor settings. Configuration priority:

1. **Workspace settings**: `.vscode/settings.json`
2. **Cursor user settings**: `~/Library/Application Support/Cursor/User/settings.json`
3. **VS Code user settings**: `~/Library/Application Support/Code/User/settings.json`
4. **Default**: `127.0.0.1:3000`

Configure in settings.json:
```json
{
  "vscode-mcp-server.host": "127.0.0.1",
  "vscode-mcp-server.port": 3001
}
```

Check current configuration:
```bash
python scripts/config.py
```

## Quick Start

```bash
# Install dependencies
pip install -r scripts/requirements.txt

# Test connection
python scripts/test_connection.py

# Get server info
python scripts/server_info.py
```

## Python Scripts

All API capabilities are exposed via Python scripts in the `scripts/` directory. This approach avoids cross-platform issues with PowerShell/curl JSON escaping.

### Server Operations

```bash
# Test connection and health check
python scripts/test_connection.py
python scripts/test_connection.py 3001  # Custom port

# Get server info and endpoint status
python scripts/server_info.py
python scripts/server_info.py --json  # Raw JSON output
```

### Document Symbols (文档大纲)

Get all symbols (classes, functions, variables) in a file:

```bash
python scripts/get_document_symbols.py src/server.ts
python scripts/get_document_symbols.py src/utils.ts --port 3001
python scripts/get_document_symbols.py src/server.ts --json
```

### Search Workspace Symbols (搜索符号)

Search for symbols across the entire workspace:

```bash
python scripts/search_symbols.py MyClass
python scripts/search_symbols.py Handler --max 20
python scripts/search_symbols.py "get*" --json
```

### Find References (查找引用)

Find all references to a symbol:

```bash
python scripts/find_references.py src/server.ts 25 MCPServer
python scripts/find_references.py src/utils.ts 10 myFunction --port 3001
```

### Go to Definition (跳转定义)

Get the definition location of a symbol:

```bash
python scripts/get_definition.py src/server.ts 25 MCPServer
python scripts/get_definition.py src/utils.ts 10 myFunction --json
```

### Rename Symbol (重命名)

Safely rename a symbol across the entire workspace:

```bash
# Preview rename (不执行实际修改)
python scripts/rename_symbol.py src/server.ts 25 MCPServer McpServer --preview

# Apply rename (执行实际修改)
python scripts/rename_symbol.py src/server.ts 25 MCPServer McpServer
```

### Code Actions / Quickfix (快速修复)

List and apply code actions:

```bash
# List available code actions for entire file
python scripts/code_actions.py src/server.ts

# List code actions for specific line range
python scripts/code_actions.py src/server.ts --startLine 10 --endLine 20

# Apply specific action by index
python scripts/code_actions.py src/server.ts --apply ca_1234567890_abc123 0

# Apply only preferred (⭐) quickfix actions (recommended)
python scripts/code_actions.py src/server.ts --apply-preferred ca_1234567890_abc123

# Apply all quickfix actions
python scripts/code_actions.py src/server.ts --apply-all ca_1234567890_abc123
```

**优先级规则**: `--apply <index>` > `--apply-preferred` > `--apply-all`

### Get Diagnostics (获取诊断)

> Note: Requires diagnostics to be enabled in server configuration.

```bash
python scripts/get_diagnostics.py                  # All diagnostics
python scripts/get_diagnostics.py src/server.ts   # Specific file
```

## Workflow Examples

### Workflow 1: Find References and Rename

```bash
# Step 1: Find all references to understand impact
python scripts/find_references.py src/server.ts 25 MCPServer

# Step 2: Preview rename changes
python scripts/rename_symbol.py src/server.ts 25 MCPServer McpServer --preview

# Step 3: Apply rename if satisfied
python scripts/rename_symbol.py src/server.ts 25 MCPServer McpServer
```

### Workflow 2: Batch Fix with Code Actions

```bash
# Step 1: Get code actions (记录返回的 requestId)
python scripts/code_actions.py src/server.ts --startLine 1 --endLine -1

# Step 2a: Apply only preferred (⭐) quickfix actions (推荐)
python scripts/code_actions.py src/server.ts --apply-preferred ca_xxxxxxxxx_xxxxxx

# Step 2b: Or apply all quickfix actions
python scripts/code_actions.py src/server.ts --apply-all ca_xxxxxxxxx_xxxxxx
```

### Workflow 3: Understand Code Structure

```bash
# Get document outline
python scripts/get_document_symbols.py src/server.ts

# Search for related symbols in workspace
python scripts/search_symbols.py Handler --max 20

# Get definition of a symbol
python scripts/get_definition.py src/server.ts 25 MCPServer
```

## REST API Reference

For direct API access, all endpoints are available via HTTP:

### Server Info (Always Available)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/info` | List all endpoints and their enabled status |

### Symbol Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/symbols/document?path=src/main.ts` | Get document symbols |
| GET | `/api/symbols/workspace?query=MyClass&maxResults=10` | Search workspace symbols |
| GET | `/api/symbols/references?path=...&line=10&symbol=myFunc` | Find all references |
| GET | `/api/symbols/definition?path=...&line=10&symbol=myFunc` | Go to definition |
| GET | `/api/symbols/hover?path=...&line=10&symbol=myFunc` | Get hover info (type signature, docs) |

### Refactor Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/refactor/code-actions?path=...&startLine=1&endLine=-1` | List available code actions |
| POST | `/api/refactor/apply-action` | Apply a code action |
| POST | `/api/refactor/rename` | Rename symbol across workspace |

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

```bash
python scripts/server_info.py
```

## MCP Tools (via MCP Protocol)

Available MCP tools for direct protocol access:

**Symbol Operations:**
- `get_document_symbols_code` - Get document symbols
- `search_symbols_code` - Search workspace symbols
- `get_symbol_definition_code` - Go to definition location
- `get_symbol_hover_code` - Get hover info (type signature, documentation)
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

## Script Options

All scripts support common options:

| Option | Description |
|--------|-------------|
| `--port PORT` | Server port (default: from `scripts/config.py`) |
| `--json` | Output raw JSON (where supported) |
| `--help` | Show help message |

## Detailed API Documentation

For complete API reference including all presets, see [references/api-docs.md](references/api-docs.md).
