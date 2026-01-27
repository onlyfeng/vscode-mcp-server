#!/usr/bin/env python3
"""
Get document symbols (classes, functions, variables) from VS Code MCP Server.

Usage:
    python get_document_symbols.py <path> [--port PORT] [--json]
    
Example:
    python get_document_symbols.py src/server.ts
    python get_document_symbols.py src/utils.ts --port 3001
    python get_document_symbols.py src/server.ts --json
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


def get_document_symbols(path: str, port: int = None) -> dict:
    """Get document symbols for a file."""
    base_url = get_base_url(port=port)
    
    url = f"{base_url}/symbols/document?path={path}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server on port {port}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"Error: {e}")
        if response.text:
            print(f"Details: {response.text}")
        sys.exit(1)


# Symbol kind icons mapping (服务端返回字符串类型的 kind)
SYMBOL_KIND_ICONS = {
    "File": "📄",
    "Module": "📦",
    "Namespace": "🔷",
    "Package": "📦",
    "Class": "🔶",
    "Method": "🔸",
    "Property": "🏷️",
    "Field": "📌",
    "Constructor": "🔧",
    "Enum": "📋",
    "Interface": "🔗",
    "Function": "⚡",
    "Variable": "📊",
    "Constant": "🔢",
    "String": "📝",
    "Number": "🔢",
    "Boolean": "✅",
    "Array": "📚",
    "Object": "🗂️",
    "Key": "🔑",
    "Null": "❌",
    "EnumMember": "🔤",
    "Struct": "📐",
    "Event": "📅",
    "Operator": "⚙️",
    "TypeParameter": "🧬",
}


def format_symbol(symbol: dict, indent: int = 0) -> list:
    """Format a symbol and its children recursively."""
    lines = []
    prefix = "  " * indent
    
    name = symbol.get('name', 'unknown')
    kind = symbol.get('kind', 'Unknown')  # 服务端返回字符串类型
    icon = SYMBOL_KIND_ICONS.get(kind, "•")
    
    # Get location
    start = symbol.get('range', {}).get('start', {})
    line = start.get('line', '?')
    
    lines.append(f"{prefix}{icon} {name} ({kind}) - Line {line}")
    
    # Process children
    children = symbol.get('children', [])
    for child in children:
        lines.extend(format_symbol(child, indent + 1))
    
    return lines


def format_symbols(data: dict, path: str) -> None:
    """Format and print document symbols."""
    if "error" in data:
        print(f"❌ {data['error']}")
        return
    
    symbols = data.get('symbols', [])
    count = data.get('count', len(symbols))
    
    print(f"\n📁 Document Symbols: {path}")
    print(f"   Found: {count} top-level symbol(s)")
    print("-" * 60)
    
    if not symbols:
        print("   No symbols found")
        return
    
    for symbol in symbols:
        lines = format_symbol(symbol)
        for line in lines:
            print(line)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get document symbols")
    parser.add_argument("path", help="File path")
    parser.add_argument("--port", type=int, default=None, help="Server port (default: from config)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = get_document_symbols(args.path, args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_symbols(data, args.path)
