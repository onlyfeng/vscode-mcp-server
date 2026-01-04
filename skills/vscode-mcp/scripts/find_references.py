#!/usr/bin/env python3
"""
Find all references to a symbol using VS Code MCP Server.

Usage:
    python find_references.py <path> <line> <symbol> [--port PORT]
    
Example:
    python find_references.py src/main.ts 10 myFunction
    python find_references.py src/utils.ts 25 MyClass --port 3001
"""

import sys
import io

# 设置 stdout 编码为 UTF-8，解决 Windows 控制台 GBK 编码问题
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import argparse

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)


def find_references(path: str, line: int, symbol: str, port: int = 3000) -> dict:
    """Find all references to a symbol."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    url = f"{base_url}/symbols/references?path={path}&line={line}&symbol={symbol}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server on port {port}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            return {"error": response.json().get("error", "Not found"), "references": [], "count": 0}
        print(f"Error: {e}")
        sys.exit(1)


def format_references(data: dict, symbol: str) -> None:
    """Format and print references."""
    if "error" in data and data["error"]:
        print(f"❌ {data['error']}")
        return
    
    count = data.get('count', 0)
    references = data.get('references', [])
    
    print(f"\n🔍 References to '{symbol}'")
    print(f"   Found: {count} reference(s)")
    print("-" * 50)
    
    # Group by file
    by_file = {}
    for ref in references:
        file_path = ref.get('file', 'unknown')
        if file_path not in by_file:
            by_file[file_path] = []
        by_file[file_path].append(ref)
    
    for file_path, refs in by_file.items():
        print(f"\n📁 {file_path}")
        for ref in refs:
            line = ref.get('line', '?')
            char = ref.get('character', '?')
            print(f"   • Line {line}:{char}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Find symbol references")
    parser.add_argument("path", help="File path containing the symbol")
    parser.add_argument("line", type=int, help="Line number (1-based)")
    parser.add_argument("symbol", help="Symbol name")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    args = parser.parse_args()
    
    data = find_references(args.path, args.line, args.symbol, args.port)
    format_references(data, args.symbol)
