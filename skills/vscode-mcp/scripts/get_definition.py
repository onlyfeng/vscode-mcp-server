#!/usr/bin/env python3
"""
Go to symbol definition using VS Code MCP Server.

Usage:
    python get_definition.py <path> <line> <symbol> [--port PORT] [--json]
    
Example:
    python get_definition.py src/server.ts 25 MCPServer
    python get_definition.py src/utils.ts 10 myFunction --port 3001
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


def get_definition(path: str, line: int, symbol: str, port: int = 3000) -> dict:
    """Get symbol definition."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    url = f"{base_url}/symbols/definition?path={path}&line={line}&symbol={symbol}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server on port {port}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            return {"error": response.json().get("error", "Definition not found"), "definitions": []}
        print(f"Error: {e}")
        sys.exit(1)


def format_definitions(data: dict, symbol: str) -> None:
    """Format and print definitions."""
    if "error" in data and data["error"]:
        print(f"❌ {data['error']}")
        return
    
    definitions = data.get('definitions', [])
    count = data.get('count', len(definitions))
    
    print(f"\n📍 Definition of '{symbol}'")
    print(f"   Found: {count} definition(s)")
    print("-" * 50)
    
    if not definitions:
        print("   No definition found")
        return
    
    for i, defn in enumerate(definitions, 1):
        file_path = defn.get('file', 'unknown')
        # 使用扁平格式（与服务端返回格式一致）
        start_line = defn.get('line', '?')
        start_char = defn.get('character', '?')
        end_line = defn.get('endLine', '?')
        end_char = defn.get('endCharacter', '?')
        
        print(f"\n[{i}] 📁 {file_path}")
        print(f"    Location: Line {start_line}:{start_char} - {end_line}:{end_char}")
        
        # Show preview if available
        preview = defn.get('preview', '')
        if preview:
            print(f"    Preview: {preview[:100]}{'...' if len(preview) > 100 else ''}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get symbol definition")
    parser.add_argument("path", help="File path containing the symbol reference")
    parser.add_argument("line", type=int, help="Line number (1-based)")
    parser.add_argument("symbol", help="Symbol name")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = get_definition(args.path, args.line, args.symbol, args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_definitions(data, args.symbol)
