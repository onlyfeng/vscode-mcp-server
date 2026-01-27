#!/usr/bin/env python3
"""
Rename a symbol using VS Code MCP Server.

Usage:
    python rename_symbol.py <path> <line> <symbol> <newName> [--port PORT] [--preview] [--json]
    
Example:
    python rename_symbol.py src/server.ts 25 MCPServer McpServer
    python rename_symbol.py src/server.ts 25 MCPServer McpServer --preview
    python rename_symbol.py src/server.ts 25 MCPServer McpServer --json
"""

import sys
import io

# 设置 stdout 编码为 UTF-8，解决 Windows 控制台 GBK 编码问题
encoding = sys.stdout.encoding
if encoding is None or encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import argparse
import json

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)

from config import get_base_url


def rename_symbol(path: str, line: int, symbol: str, new_name: str, apply: bool = True, port: int = None) -> dict:
    """Rename a symbol."""
    base_url = get_base_url(port=port)
    
    body = {
        "path": path,
        "line": line,
        "symbol": symbol,
        "newName": new_name,
        "apply": apply
    }
    
    try:
        response = requests.post(
            f"{base_url}/refactor/rename",
            json=body,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server at {base_url}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"Error: {e}")
        if response.text:
            print(f"Details: {response.text}")
        sys.exit(1)


def format_result(data: dict, preview: bool) -> None:
    """Format and print rename result."""
    success = data.get('success', False)
    applied = data.get('applied', False)
    new_name = data.get('newName', '')
    total_changes = data.get('totalChanges', 0)
    
    if not success:
        print(f"\n❌ Rename failed")
        if 'error' in data:
            print(f"   Error: {data['error']}")
        return
    
    if preview:
        print(f"\n📋 Rename Preview (not applied)")
    else:
        print(f"\n✅ Rename completed")
    
    print(f"   New name: {new_name}")
    print(f"   Total changes: {total_changes}")
    print("-" * 50)
    
    affected_files = data.get('affectedFiles', [])
    for file_info in affected_files:
        file_path = file_info.get('file', 'unknown')
        changes = file_info.get('changes', 0)
        print(f"   📁 {file_path}: {changes} change(s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rename symbol")
    parser.add_argument("path", help="File path containing the symbol")
    parser.add_argument("line", type=int, help="Line number (1-based)")
    parser.add_argument("symbol", help="Symbol name to rename")
    parser.add_argument("newName", help="New name for the symbol")
    parser.add_argument("--port", type=int, default=None, help="Server port (default: from config)")
    parser.add_argument("--preview", action="store_true", help="Preview changes without applying")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = rename_symbol(args.path, args.line, args.symbol, args.newName, apply=not args.preview, port=args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_result(data, args.preview)
