#!/usr/bin/env python3
"""
Get hover information (type signature, documentation) for a symbol using VS Code MCP Server.

Usage:
    python get_hover.py <path> <line> <symbol> [--port PORT] [--json]
    
Example:
    python get_hover.py src/server.ts 25 MCPServer
    python get_hover.py src/utils.ts 10 myFunction --port 3001
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


def get_hover(path: str, line: int, symbol: str, port: int = None) -> dict:
    """Get hover information for a symbol."""
    base_url = get_base_url(port=port)
    
    url = f"{base_url}/symbols/hover?path={path}&line={line}&symbol={symbol}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server at {base_url}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            return {"error": response.json().get("error", "Hover info not found"), "hovers": []}
        print(f"Error: {e}")
        sys.exit(1)


def format_hover(data: dict, symbol: str) -> None:
    """Format and print hover information."""
    if "error" in data and data["error"]:
        print(f"❌ {data['error']}")
        return
    
    hovers = data.get('hovers', [])
    count = data.get('count', len(hovers))
    
    print(f"\n📝 Hover info for '{symbol}'")
    print(f"   Found: {count} hover result(s)")
    print("-" * 60)
    
    if not hovers:
        print("   No hover information available")
        return
    
    for i, hover in enumerate(hovers, 1):
        if i > 1:
            print()
            print("-" * 60)
        
        # Show preview/code context if available
        preview = hover.get('preview', '')
        if preview:
            print(f"\n💻 Code: {preview}")
        
        # Show contents (type signature, documentation)
        contents = hover.get('contents', [])
        for j, content in enumerate(contents):
            if j == 0:
                print(f"\n📋 Type/Signature:")
            print(f"   {content}")
        
        # Show range if available
        hover_range = hover.get('range')
        if hover_range:
            start = hover_range.get('start', {})
            end = hover_range.get('end', {})
            print(f"\n📍 Range: [{start.get('line', '?')}:{start.get('character', '?')}] - [{end.get('line', '?')}:{end.get('character', '?')}]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get hover information for a symbol")
    parser.add_argument("path", help="File path containing the symbol")
    parser.add_argument("line", type=int, help="Line number (1-based)")
    parser.add_argument("symbol", help="Symbol name")
    parser.add_argument("--port", type=int, default=None, help="Server port (default: from config)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = get_hover(args.path, args.line, args.symbol, args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_hover(data, args.symbol)
