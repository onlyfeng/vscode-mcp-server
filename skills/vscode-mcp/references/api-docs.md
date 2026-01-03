# VS Code MCP Server REST API Documentation

## Base URL

```
http://127.0.0.1:{port}/api
```

Default port: `3000`

---

## Server Endpoints

### GET /api/info

Get server information and list of available endpoints.

**Response:**
```json
{
  "name": "vscode-mcp-server",
  "version": "0.3.1",
  "description": "VS Code MCP Server REST API",
  "endpoints": [
    { "method": "GET", "path": "/api/info", "description": "Server information" },
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

## File Endpoints

### GET /api/files/list

List files in the workspace.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| path | string | No | "" | Relative path from workspace root |
| recursive | boolean | No | false | List files recursively |

**Example:**
```bash
curl "http://127.0.0.1:3000/api/files/list?path=src&recursive=true"
```

**Response:**
```json
{
  "files": ["src/main.ts", "src/utils.ts"],
  "count": 2
}
```

### GET /api/files/read

Read file contents.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| path | string | Yes | - | File path relative to workspace |
| startLine | number | No | - | Start line (1-based) |
| endLine | number | No | - | End line (1-based), use -1 for end of file |

**Example:**
```bash
# Read entire file
curl "http://127.0.0.1:3000/api/files/read?path=src/main.ts"

# Read lines 10-20
curl "http://127.0.0.1:3000/api/files/read?path=src/main.ts&startLine=10&endLine=20"
```

**Response:**
```json
{
  "content": "file contents here...",
  "lineCount": 150,
  "path": "src/main.ts"
}
```

---

## Diagnostics Endpoints

### GET /api/diagnostics

Get diagnostics (errors, warnings) for workspace or specific file.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| path | string | No | - | File path to get diagnostics for |

**Example:**
```bash
# Get all diagnostics
curl "http://127.0.0.1:3000/api/diagnostics"

# Get diagnostics for specific file
curl "http://127.0.0.1:3000/api/diagnostics?path=src/main.ts"
```

**Response:**
```json
{
  "diagnostics": [
    {
      "file": "src/main.ts",
      "diagnostics": [
        {
          "message": "Cannot find name 'foo'",
          "severity": "Error",
          "range": {
            "start": { "line": 10, "character": 5 },
            "end": { "line": 10, "character": 8 }
          },
          "source": "ts"
        }
      ]
    }
  ],
  "totalCount": 1,
  "fileCount": 1
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
  "path": "src/main.ts"
}
```

### GET /api/symbols/workspace

Search for symbols across the workspace.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Symbol name to search for |

**Example:**
```bash
curl "http://127.0.0.1:3000/api/symbols/workspace?query=MyClass"
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
      "character": 0
    }
  ],
  "count": 1,
  "query": "MyClass"
}
```

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

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status | Description |
|--------|-------------|
| 200 | Success |
| 400 | Bad Request (missing required parameters) |
| 404 | Not Found (symbol/file not found) |
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

# Get diagnostics
response = requests.get(f"{BASE_URL}/diagnostics")
data = response.json()

for file_diag in data["diagnostics"]:
    print(f"\n{file_diag['file']}:")
    for diag in file_diag["diagnostics"]:
        print(f"  Line {diag['range']['start']['line']}: {diag['message']}")
```

### JavaScript/Node.js

```javascript
const fetch = require('node-fetch');

const BASE_URL = 'http://127.0.0.1:3000/api';

async function getReferences(path, line, symbol) {
  const url = `${BASE_URL}/symbols/references?path=${path}&line=${line}&symbol=${symbol}`;
  const response = await fetch(url);
  return response.json();
}

// Usage
const refs = await getReferences('src/main.ts', 10, 'myFunction');
console.log(`Found ${refs.count} references`);
```

### Bash/curl

```bash
#!/bin/bash
BASE_URL="http://127.0.0.1:3000/api"

# Check health
curl -s "$BASE_URL/health" | jq .

# Get all diagnostics and format output
curl -s "$BASE_URL/diagnostics" | jq '.diagnostics[] | "\(.file): \(.diagnostics | length) issues"'
```
