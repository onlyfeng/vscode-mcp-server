#!/usr/bin/env python3
"""
Search symbols across workspace using VS Code MCP Server.

Usage:
    python search_symbols.py <query> [--max N] [--port PORT] [--json]
    
Example:
    python search_symbols.py MyClass
    python search_symbols.py Handler --max 20
    python search_symbols.py "get*" --json
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
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)


def search_symbols(query: str, max_results: int = 10, port: int = 3000) -> dict:
    """Search symbols across workspace."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    # URL encode the query for special characters
    encoded_query = quote(query)
    url = f"{base_url}/symbols/workspace?query={encoded_query}&maxResults={max_results}"
    
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


# Symbol kind mapping (from VS Code SymbolKind enum)
SYMBOL_KIND_ICONS = {
    1: "📄",   # File
    2: "📦",   # Module
    3: "🔷",   # Namespace
    4: "📦",   # Package
    5: "🔶",   # Class
    6: "🔸",   # Method
    7: "🏷️",   # Property
    8: "📌",   # Field
    9: "🔧",   # Constructor
    10: "📋",  # Enum
    11: "🔗",  # Interface
    12: "⚡",  # Function
    13: "📊",  # Variable
    14: "🔢",  # Constant
    15: "📝",  # String
    16: "🔢",  # Number
    17: "✅",  # Boolean
    18: "📚",  # Array
    19: "🗂️",  # Object
    20: "🔑",  # Key
    21: "❌",  # Null
    22: "🔤",  # EnumMember
    23: "📐",  # Struct
    24: "📅",  # Event
    25: "⚙️",  # Operator
    26: "🧬",  # TypeParameter
}

SYMBOL_KIND_NAMES = {
    1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
    6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
    11: "Interface", 12: "Function", 13: "Variable", 14: "Constant", 15: "String",
    16: "Number", 17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
    21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event", 25: "Operator",
    26: "TypeParameter"
}


def format_symbols(data: dict, query: str) -> None:
    """Format and print workspace symbols."""
    if "error" in data:
        print(f"❌ {data['error']}")
        return
    
    symbols = data.get('symbols', [])
    count = data.get('count', len(symbols))
    
    print(f"\n🔍 Workspace Symbols: '{query}'")
    print(f"   Found: {count} symbol(s)")
    print("-" * 60)
    
    if not symbols:
        print("   No symbols found")
        return
    
    # Group by file
    by_file = {}
    for symbol in symbols:
        file_path = symbol.get('file', 'unknown')
        if file_path not in by_file:
            by_file[file_path] = []
        by_file[file_path].append(symbol)
    
    for file_path, file_symbols in by_file.items():
        print(f"\n📁 {file_path}")
        for symbol in file_symbols:
            name = symbol.get('name', 'unknown')
            kind = symbol.get('kind', 0)
            icon = SYMBOL_KIND_ICONS.get(kind, "•")
            kind_name = SYMBOL_KIND_NAMES.get(kind, "Unknown")
            line = symbol.get('line', '?')
            container = symbol.get('containerName', '')
            
            if container:
                print(f"   {icon} {name} ({kind_name}) in {container} - Line {line}")
            else:
                print(f"   {icon} {name} ({kind_name}) - Line {line}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Search workspace symbols")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--max", type=int, default=10, dest="max_results", help="Max results (default: 10)")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = search_symbols(args.query, args.max_results, args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_symbols(data, args.query)
