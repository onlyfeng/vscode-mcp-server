#!/usr/bin/env python3
"""
Get and apply code actions using VS Code MCP Server.

Usage:
    python code_actions.py <path> [--startLine N] [--endLine N] [--port PORT]
    python code_actions.py <path> --apply <requestId> <index>
    python code_actions.py <path> --apply-all <requestId>
    
Example:
    python code_actions.py src/server.ts
    python code_actions.py src/server.ts --startLine 1 --endLine -1
    python code_actions.py src/server.ts --apply ca_123_abc 0
    python code_actions.py src/server.ts --apply-all ca_123_abc
"""

import sys
import argparse
import json

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)


def get_code_actions(path: str, start_line: int = 1, end_line: int = -1, port: int = 3000) -> dict:
    """Get available code actions for a file range."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    url = f"{base_url}/refactor/code-actions?path={path}&startLine={start_line}&endLine={end_line}"
    
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


def apply_code_action(request_id: str, index: int = None, apply_all: bool = False, port: int = 3000) -> dict:
    """Apply a code action."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    body = {"requestId": request_id}
    if apply_all:
        body["applyAll"] = True
    else:
        body["index"] = index
    
    try:
        response = requests.post(
            f"{base_url}/refactor/apply-action",
            json=body,
            timeout=30
        )
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


def format_actions(data: dict) -> None:
    """Format and print code actions."""
    print(f"\n🔧 Code Actions for file")
    print(f"   Request ID: {data.get('requestId')}")
    print(f"   Expires in: {data.get('expiresIn')}")
    print(f"   Found: {data.get('count', 0)} action(s)")
    print("-" * 60)
    
    actions = data.get('actions', [])
    if not actions:
        print("   No code actions available")
        return
    
    for action in actions:
        idx = action.get('index', '?')
        title = action.get('title', 'Unknown')
        kind = action.get('kind', '')
        preferred = " ⭐" if action.get('isPreferred') else ""
        
        print(f"\n[{idx}] {title}{preferred}")
        if kind:
            print(f"    Kind: {kind}")
        
        diagnostics = action.get('diagnostics', [])
        if diagnostics:
            print(f"    Fixes: {', '.join(diagnostics)}")
    
    print("\n" + "-" * 60)
    print(f"To apply: python code_actions.py <path> --apply {data.get('requestId')} <index>")
    print(f"To apply all: python code_actions.py <path> --apply-all {data.get('requestId')}")


def format_apply_result(data: dict) -> None:
    """Format and print apply result."""
    success = data.get('success', False)
    applied = data.get('appliedCount', 0)
    
    if success:
        print(f"\n✅ Successfully applied {applied} action(s)")
    else:
        print(f"\n❌ Failed to apply actions")
    
    results = data.get('results', [])
    for result in results:
        print(f"   • {result}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get and apply code actions")
    parser.add_argument("path", help="File path")
    parser.add_argument("--startLine", type=int, default=1, help="Start line (1-based, default: 1)")
    parser.add_argument("--endLine", type=int, default=-1, help="End line (1-based, -1 for end of file)")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--apply", nargs=2, metavar=('REQUEST_ID', 'INDEX'), help="Apply action by request ID and index")
    parser.add_argument("--apply-all", metavar='REQUEST_ID', help="Apply all quickfix actions")
    args = parser.parse_args()
    
    if args.apply:
        request_id, index = args.apply
        data = apply_code_action(request_id, int(index), port=args.port)
        format_apply_result(data)
    elif args.apply_all:
        data = apply_code_action(args.apply_all, apply_all=True, port=args.port)
        format_apply_result(data)
    else:
        data = get_code_actions(args.path, args.startLine, args.endLine, args.port)
        format_actions(data)
