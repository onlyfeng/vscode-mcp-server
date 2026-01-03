#!/usr/bin/env python3
"""
Test connection to VS Code MCP Server REST API.

Usage:
    python test_connection.py [port]
    
Example:
    python test_connection.py
    python test_connection.py 3001
"""

import sys
import json

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Run: pip install requests")
    sys.exit(1)


def test_connection(port: int = 3000) -> bool:
    """Test connection to the VS Code MCP Server."""
    base_url = f"http://127.0.0.1:{port}/api"
    
    print(f"Testing connection to {base_url}...")
    print("-" * 50)
    
    # Test health endpoint
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check passed")
            print(f"   Status: {data.get('status')}")
            print(f"   Workspace: {data.get('workspace')}")
            print(f"   Timestamp: {data.get('timestamp')}")
        else:
            print(f"❌ Health check failed with status {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection failed - is the MCP server running on port {port}?")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    
    print("-" * 50)
    
    # Test info endpoint
    try:
        response = requests.get(f"{base_url}/info", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Server info retrieved")
            print(f"   Name: {data.get('name')}")
            print(f"   Version: {data.get('version')}")
            print(f"   Endpoints available: {len(data.get('endpoints', []))}")
        else:
            print(f"❌ Info endpoint failed with status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Error getting info: {e}")
        return False
    
    print("-" * 50)
    print("✅ All connection tests passed!")
    return True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    success = test_connection(port)
    sys.exit(0 if success else 1)
