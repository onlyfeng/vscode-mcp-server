#!/usr/bin/env python3
"""
Get diagnostics from VS Code MCP Server.

NOTE: This script requires diagnostics to be enabled in vscode-mcp-server configuration.
With semantic-only.json preset, this endpoint is disabled (403).

Usage:
    python get_diagnostics.py [path] [--port PORT] [--json]
    
Example:
    python get_diagnostics.py                     # Get all diagnostics
    python get_diagnostics.py src/main.ts         # Get diagnostics for specific file
    python get_diagnostics.py --port 3001         # Use custom port
    python get_diagnostics.py src/main.ts --json  # Output raw JSON
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


def get_diagnostics(path: str = None, port: int = None) -> dict:
    """Get diagnostics from VS Code MCP Server."""
    base_url = get_base_url(port=port)
    
    url = f"{base_url}/diagnostics"
    if path:
        url += f"?path={path}"
    
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 403:
            return {"error": "Diagnostics endpoint is disabled by configuration", "diagnostics": []}
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server on port {port}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"Error: {e}")
        sys.exit(1)


def format_diagnostics(data: dict) -> None:
    """Format and print diagnostics."""
    if "error" in data and data["error"]:
        print(f"⚠️  {data['error']}")
        return
        
    print(f"\n📋 Diagnostics Summary")
    print(f"   Total issues: {data.get('totalCount', 0)}")
    print(f"   Files with issues: {data.get('fileCount', 0)}")
    print("-" * 50)
    
    for file_diag in data.get('diagnostics', []):
        file_path = file_diag.get('file', 'unknown')
        diagnostics = file_diag.get('diagnostics', [])
        
        print(f"\n📁 {file_path} ({len(diagnostics)} issues)")
        
        for diag in diagnostics:
            severity = diag.get('severity', 'Unknown')
            message = diag.get('message', '')
            source = diag.get('source', '')
            start = diag.get('range', {}).get('start', {})
            line = start.get('line', '?')
            char = start.get('character', '?')
            
            # Severity emoji
            emoji = {
                'Error': '❌',
                'Warning': '⚠️',
                'Information': 'ℹ️',
                'Hint': '💡'
            }.get(severity, '•')
            
            print(f"   {emoji} Line {line}:{char} [{source}] {message}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get VS Code diagnostics")
    parser.add_argument("path", nargs="?", help="File path (optional)")
    parser.add_argument("--port", type=int, default=None, help="Server port (default: from config)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    data = get_diagnostics(args.path, args.port)
    
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        format_diagnostics(data)
