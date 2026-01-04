# VS Code MCP Server REST API Documentation

## Base URL

```
http://127.0.0.1:{port}/api
```

Default port: `3000`

## Configuration

The server respects `enabledTools` configuration. With the recommended `semantic-only.json` preset:
- ✅ **Enabled**: Symbol operations, Refactor operations
- ❌ **Disabled**: File operations, Edit operations, Shell operations, Diagnostics (use Cursor's built-in tools)

Disabled endpoints return `403 Forbidden`:
```json
{
  "error": "File endpoints are disabled by configuration",
  "hint": "Update vscode-mcp-server.enabledTools setting to enable this feature"
}
```

---

## Server Endpoints (Always Available)

### GET /api/info

Get server information, enabled configuration, and endpoint status.

**Response:**
```json
{
  "name": "vscode-mcp-server",
  "version": "0.3.3",
  "description": "VS Code MCP Server REST API",
  "enabledTools": {
    "file": false,
    "edit": false,
    "shell": false,
    "diagnostics": false,
    "symbol": true,
    "refactor": true
  },
  "endpoints": [
    { "method": "GET", "path": "/api/health", "enabled": true },
    { "method": "GET", "path": "/api/symbols/document", "enabled": true },
    { "method": "GET", "path": "/api/files/list", "enabled": false },
    ...
  ]
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "workspace": "my-project"
}
```

---

## Symbol Endpoints

### GET /api/symbols/document

Get all symbols in a document.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | File path |

**Example:**
```bash
curl "http://127.0.0.1:3000/api/symbols/document?path=src/main.ts"
```

**Response:**
```json
{
  "symbols": [
    {
      "name": "MyClass",
      "kind": "Class",
      "range": {
        "start": { "line": 5, "character": 0 },
        "end": { "line": 50, "character": 1 }
      },
      "children": [
        {
          "name": "constructor",
          "kind": "Constructor",
          "range": { ... },
          "children": []
        }
      ]
    }
  ],
  "count": 1,
  "total": 15,
  "totalByKind": {
    "Class": 1,
    "Method": 8,
    "Property": 6
  },
  "path": "src/main.ts"
}
```

Note: `total` is the total number of symbols (including nested children), `totalByKind` provides a breakdown by symbol kind.

### GET /api/symbols/workspace

Search for symbols across the workspace.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| query | string | Yes | - | Symbol name to search for |
| maxResults | number | No | 10 | Maximum number of results to return |

**Example:**
```bash
curl "http://127.0.0.1:3000/api/symbols/workspace?query=MyClass&maxResults=20"
```

**Response:**
```json
{
  "symbols": [
    {
      "name": "MyClass",
      "kind": "Class",
      "file": "src/main.ts",
      "line": 5,
      "character": 0,
      "containerName": "MyNamespace"
    }
  ],
  "count": 1,
  "total": 5,
  "query": "MyClass"
}
```

Note: `total` is the total number of matching symbols found (may be greater than `count` if `maxResults` limits the response).

### GET /api/symbols/references

Find all references to a symbol.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | File path containing the symbol |
| line | number | Yes | Line number (1-based) |
| character | number | No* | Character position (0-based) |
| symbol | string | No* | Symbol name to find on the line |

*Either `character` or `symbol` must be provided.

**Example:**
```bash
# Using character position
curl "http://127.0.0.1:3000/api/symbols/references?path=src/main.ts&line=10&character=5"

# Using symbol name
curl "http://127.0.0.1:3000/api/symbols/references?path=src/main.ts&line=10&symbol=myFunction"
```

**Response:**
```json
{
  "references": [
    {
      "file": "src/main.ts",
      "line": 10,
      "character": 5,
      "endLine": 10,
      "endCharacter": 15
    },
    {
      "file": "src/utils.ts",
      "line": 25,
      "character": 10,
      "endLine": 25,
      "endCharacter": 20
    }
  ],
  "count": 2
}
```

### GET /api/symbols/definition

Go to definition of a symbol.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | File path containing the symbol |
| line | number | Yes | Line number (1-based) |
| character | number | No* | Character position (0-based) |
| symbol | string | No* | Symbol name to find on the line |

*Either `character` or `symbol` must be provided.

**Example:**
```bash
curl "http://127.0.0.1:3000/api/symbols/definition?path=src/main.ts&line=20&symbol=MyClass"
```

**Response:**
```json
{
  "definitions": [
    {
      "file": "src/types.ts",
      "line": 5,
      "character": 0,
      "endLine": 50,
      "endCharacter": 1
    }
  ],
  "count": 1
}
```

---

## Refactor Endpoints

### GET /api/refactor/code-actions

Get available code actions (quick fixes, refactorings) for a code range.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| path | string | Yes | - | File path |
| startLine | number | Yes | - | Start line (1-based) |
| endLine | number | No | startLine | End line (1-based), use -1 for end of file |

**Example:**
```bash
# Get code actions for entire file
curl "http://127.0.0.1:3000/api/refactor/code-actions?path=src/main.ts&startLine=1&endLine=-1"

# Get code actions for specific line
curl "http://127.0.0.1:3000/api/refactor/code-actions?path=src/main.ts&startLine=10"
```

**Response:**
```json
{
  "requestId": "ca_1704303600000_abc123",
  "actions": [
    {
      "index": 0,
      "title": "Remove unused import",
      "kind": "quickfix",
      "isPreferred": true,
      "diagnostics": ["'fs' is declared but never used."]
    },
    {
      "index": 1,
      "title": "Organize imports",
      "kind": "source.organizeImports",
      "isPreferred": false,
      "diagnostics": []
    }
  ],
  "count": 2,
  "expiresIn": "60 seconds"
}
```

### POST /api/refactor/apply-action

Apply a code action from a previous `/refactor/code-actions` request.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| requestId | string | Yes | Request ID from code-actions response |
| index | number | No* | Index of the action to apply |
| applyAll | boolean | No | Apply all quickfix actions (default: false) |

*Required when `applyAll` is false.

**Example:**
```bash
# Apply specific action
curl -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "ca_1704303600000_abc123", "index": 0}'

# Apply all quickfixes
curl -X POST "http://127.0.0.1:3000/api/refactor/apply-action" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "ca_1704303600000_abc123", "applyAll": true}'
```

**Response:**
```json
{
  "success": true,
  "appliedCount": 1,
  "results": ["Applied: Remove unused import"]
}
```

### POST /api/refactor/rename

Rename a symbol across the workspace.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | File path containing the symbol |
| line | number | Yes | Line number (1-based) |
| character | number | No* | Character position (0-based) |
| symbol | string | No* | Symbol name on the line |
| newName | string | Yes | New name for the symbol |
| apply | boolean | No | Apply the rename (default: true) |

*Either `character` or `symbol` must be provided.

**Example:**
```bash
# Rename with symbol name
curl -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path": "src/main.ts", "line": 10, "symbol": "oldName", "newName": "newName"}'

# Preview rename without applying
curl -X POST "http://127.0.0.1:3000/api/refactor/rename" \
  -H "Content-Type: application/json" \
  -d '{"path": "src/main.ts", "line": 10, "symbol": "oldName", "newName": "newName", "apply": false}'
```

**Response:**
```json
{
  "success": true,
  "applied": true,
  "newName": "newName",
  "affectedFiles": [
    { "file": "src/main.ts", "changes": 5 },
    { "file": "src/utils.ts", "changes": 3 }
  ],
  "totalChanges": 8
}
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status | Description |
|--------|-------------|
| 200 | Success |
| 400 | Bad Request (missing required parameters) |
| 403 | Forbidden (endpoint disabled by configuration) |
| 404 | Not Found (symbol/file not found) |
| 410 | Gone (code action request expired) |
| 500 | Internal Server Error |

Error response format:
```json
{
  "error": "Detailed error message"
}
```

---

## Usage Examples

### Python

```python
import requests

BASE_URL = "http://127.0.0.1:3000/api"

# Find all references to a symbol
response = requests.get(
    f"{BASE_URL}/symbols/references",
    params={"path": "src/main.ts", "line": 10, "symbol": "myFunction"}
)
refs = response.json()
print(f"Found {refs['count']} references")

# Apply code actions
actions = requests.get(
    f"{BASE_URL}/refactor/code-actions",
    params={"path": "src/main.ts", "startLine": 1, "endLine": -1}
).json()

if actions["count"] > 0:
    result = requests.post(
        f"{BASE_URL}/refactor/apply-action",
        json={"requestId": actions["requestId"], "applyAll": True}
    ).json()
    print(f"Applied {result['appliedCount']} fixes")
```

### JavaScript/Node.js

```javascript
const BASE_URL = 'http://127.0.0.1:3000/api';

async function getReferences(path, line, symbol) {
  const url = `${BASE_URL}/symbols/references?path=${path}&line=${line}&symbol=${symbol}`;
  const response = await fetch(url);
  return response.json();
}

async function renameSymbol(path, line, symbol, newName) {
  const response = await fetch(`${BASE_URL}/refactor/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, line, symbol, newName })
  });
  return response.json();
}

// Usage
const refs = await getReferences('src/main.ts', 10, 'myFunction');
console.log(`Found ${refs.count} references`);

const result = await renameSymbol('src/main.ts', 10, 'myFunction', 'newFunction');
console.log(`Renamed in ${result.totalChanges} locations`);
```

### PowerShell（直接会话 - 推荐）

```powershell
$BASE_URL = "http://127.0.0.1:3000/api"

# Check health (use ConvertTo-Json for readable output)
Invoke-RestMethod -Uri "$BASE_URL/health" | ConvertTo-Json

# Find references
$refs = Invoke-RestMethod -Uri "$BASE_URL/symbols/references?path=src/main.ts&line=10&symbol=MCPServer"
Write-Host "Found $($refs.count) references"
$refs.references | ConvertTo-Json

# Rename symbol
$body = @{ path = "src/main.ts"; line = 10; symbol = "oldName"; newName = "newName" } | ConvertTo-Json
Invoke-RestMethod -Uri "$BASE_URL/refactor/rename" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 3
```

### PowerShell（通过 powershell -Command 调用 - AI Agent 场景）

```powershell
# 注意：所有 $ 变量必须使用 `$ 转义

# Check health
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' | ConvertTo-Json"

# Find references
powershell -Command "`$refs = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/symbols/references?path=src/main.ts&line=10&symbol=MCPServer'; Write-Host 'Found' `$refs.count 'references'; `$refs.references | ConvertTo-Json"

# Rename symbol（注意 apply 使用 `$true）
powershell -Command "`$body = @{ path = 'src/main.ts'; line = 10; symbol = 'oldName'; newName = 'newName'; apply = `$true } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/refactor/rename' -Method Post -Body `$body -ContentType 'application/json' | ConvertTo-Json -Depth 3"
```

> **⚠️ Windows curl.exe 注意事项**：
> - 在 PowerShell 中使用 curl.exe 传递 JSON 需要复杂的引号转义
> - `curl -d @file.json` 语法在 PowerShell 中不可用（`@` 被解释为展开运算符）
> - **强烈推荐使用 Invoke-RestMethod**，避免所有转义问题

---

## Appendix: Optional Endpoints (Disabled by Default)

The following endpoints are available when `enabledTools` configuration enables them.
With `semantic-only.json` preset, these are disabled.

### File Endpoints (requires `file: true`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files/list?path=&recursive=true` | List files |
| GET | `/api/files/read?path=src/main.ts` | Read file content |

### Diagnostics Endpoints (requires `diagnostics: true`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/diagnostics` | Get all workspace diagnostics |
| GET | `/api/diagnostics?path=src/main.ts` | Get file-specific diagnostics |

To enable these endpoints, use `full-featured.json` preset or update settings:
```json
{
  "vscode-mcp-server.enabledTools": {
    "file": true,
    "diagnostics": true,
    ...
  }
}
```
