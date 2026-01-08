#!/usr/bin/env python3
"""
Get VS Code MCP Server information and endpoint status.

Usage:
    python server_info.py [--port PORT] [--json]
    
Example:
    python server_info.py
    python server_info.py --port 3001
    python server_info.py --json
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


def get_server_info(port: int = 3000) -> dict:
    """Get server info from VS Code MCP Server."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    try:
        response = requests.get(f"{base_url}/info", timeout=5)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to server on port {port}")
        print("Make sure the VS Code MCP Server extension is installed and running.")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"Error: {e}")
        sys.exit(1)


def get_health(port: int = 3000) -> dict:
    """Get health status from VS Code MCP Server."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        return {"status": "offline", "error": "Cannot connect"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def format_info(info: dict, health: dict) -> None:
    """Format and print server information."""
    print("\n🔌 VS Code MCP Server")
    print("=" * 60)
    
    # Health info
    status = health.get('status', 'unknown')
    status_icon = "✅" if status == "healthy" else "❌"
    print(f"\n{status_icon} Status: {status}")
    if 'workspace' in health:
        print(f"   Workspace: {health['workspace']}")
    if 'timestamp' in health:
        print(f"   Timestamp: {health['timestamp']}")
    
    # Server info
    print(f"\n📦 Name: {info.get('name', 'unknown')}")
    print(f"   Version: {info.get('version', 'unknown')}")
    
    # Enabled tools
    enabled_tools = info.get('enabledTools', {})
    if enabled_tools:
        print("\n🔧 Tool Categories:")
        for tool, enabled in enabled_tools.items():
            icon = "✅" if enabled else "❌"
            print(f"   {icon} {tool}")
    
    # Endpoints
    endpoints = info.get('endpoints', [])
    if endpoints:
        print(f"\n🔗 Endpoints ({len(endpoints)} available):")
        
        # Group by category
        by_category = {}
        for ep in endpoints:
            path = ep.get('path', '')
            # Extract category from path like /api/symbols/xxx -> symbols
            parts = path.split('/')
            category = parts[2] if len(parts) > 2 else 'other'
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(ep)
        
        for category, eps in by_category.items():
            print(f"\n   [{category}]")
            for ep in eps:
                path = ep.get('path', '')
                method = ep.get('method', 'GET')
                enabled = ep.get('enabled', True)
                icon = "✅" if enabled else "❌"
                print(f"   {icon} {method:6} {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get VS Code MCP Server info")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()
    
    info = get_server_info(args.port)
    health = get_health(args.port)
    
    if args.json:
        combined = {"info": info, "health": health}
        print(json.dumps(combined, indent=2, ensure_ascii=False))
    else:
        format_info(info, health)
