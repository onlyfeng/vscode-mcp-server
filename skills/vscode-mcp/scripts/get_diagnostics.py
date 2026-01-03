#!/usr/bin/env python3
"""
Get diagnostics from VS Code MCP Server.

NOTE: This script requires diagnostics to be enabled in vscode-mcp-server configuration.
With semantic-only.json preset, this endpoint is disabled (403).

Usage:
    python get_diagnostics.py [path] [--port PORT]
    
Example:
    python get_diagnostics.py                     # Get all diagnostics
    python get_diagnostics.py src/main.ts         # Get diagnostics for specific file
    python get_diagnostics.py --port 3001         # Use custom port
"""

import sys
import argparse

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)


def get_diagnostics(path: str = None, port: int = 3000) -> dict:
    """Get diagnostics from VS Code MCP Server."""
    base_url = f"http://127.0.0.1:{port}/api"
    
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
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    args = parser.parse_args()
    
    data = get_diagnostics(args.path, args.port)
    format_diagnostics(data)
