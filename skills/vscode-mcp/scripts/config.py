#!/usr/bin/env python3
"""
VS Code MCP Server 配置读取模块

统一的端口/Host获取方式，按以下优先级读取：
1. 工作区 .vscode/settings.json
2. Cursor 用户设置
3. VS Code 用户设置  
4. 固定默认值 (3000/127.0.0.1)

Usage:
    from config import get_config, get_base_url, DEFAULT_PORT, DEFAULT_HOST
    
    # 获取完整配置
    config = get_config()
    print(config['port'], config['host'])
    
    # 获取 base_url
    base_url = get_base_url()  # http://127.0.0.1:3000/api
    
    # 打印配置信息
    print_config()
"""

import os
import re
import json
from pathlib import Path
from typing import Optional, Dict, Any

# 默认配置
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000

# settings.json 中的配置键名
CONFIG_KEY_HOST = "vscode-mcp-server.host"
CONFIG_KEY_PORT = "vscode-mcp-server.port"


def _remove_json_comments(json_str: str) -> str:
    """
    移除 JSON 中的注释（支持 // 和 /* */ 风格）和尾随逗号
    VS Code 的 settings.json 使用 JSONC 格式
    """
    # 移除单行注释 // ...
    json_str = re.sub(r'//.*?(?=\n|$)', '', json_str)
    # 移除多行注释 /* ... */
    json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
    # 移除尾随逗号（对象和数组末尾的逗号）
    json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
    return json_str


def _load_json_with_comments(file_path: Path) -> Optional[Dict[str, Any]]:
    """
    加载可能包含注释的 JSON 文件（JSONC 格式）
    """
    if not file_path.exists():
        return None
    
    try:
        content = file_path.read_text(encoding='utf-8')
        clean_content = _remove_json_comments(content)
        return json.loads(clean_content)
    except (json.JSONDecodeError, OSError):
        return None


def _get_workspace_settings() -> Optional[Dict[str, Any]]:
    """
    读取工作区 .vscode/settings.json
    从当前工作目录向上查找
    """
    cwd = Path.cwd()
    
    # 向上查找 .vscode/settings.json
    for parent in [cwd] + list(cwd.parents):
        settings_path = parent / '.vscode' / 'settings.json'
        settings = _load_json_with_comments(settings_path)
        if settings is not None:
            return settings
    
    return None


def _get_cursor_user_settings() -> Optional[Dict[str, Any]]:
    """
    读取 Cursor 用户设置
    macOS: ~/Library/Application Support/Cursor/User/settings.json
    Windows: %APPDATA%/Cursor/User/settings.json
    Linux: ~/.config/Cursor/User/settings.json
    """
    home = Path.home()
    
    if os.name == 'nt':  # Windows
        settings_path = Path(os.environ.get('APPDATA', '')) / 'Cursor' / 'User' / 'settings.json'
    elif os.uname().sysname == 'Darwin':  # macOS
        settings_path = home / 'Library' / 'Application Support' / 'Cursor' / 'User' / 'settings.json'
    else:  # Linux
        settings_path = home / '.config' / 'Cursor' / 'User' / 'settings.json'
    
    return _load_json_with_comments(settings_path)


def _get_vscode_user_settings() -> Optional[Dict[str, Any]]:
    """
    读取 VS Code 用户设置
    macOS: ~/Library/Application Support/Code/User/settings.json
    Windows: %APPDATA%/Code/User/settings.json
    Linux: ~/.config/Code/User/settings.json
    """
    home = Path.home()
    
    if os.name == 'nt':  # Windows
        settings_path = Path(os.environ.get('APPDATA', '')) / 'Code' / 'User' / 'settings.json'
    elif os.uname().sysname == 'Darwin':  # macOS
        settings_path = home / 'Library' / 'Application Support' / 'Code' / 'User' / 'settings.json'
    else:  # Linux
        settings_path = home / '.config' / 'Code' / 'User' / 'settings.json'
    
    return _load_json_with_comments(settings_path)


def get_config() -> Dict[str, Any]:
    """
    获取 MCP Server 配置（host 和 port）
    
    读取优先级：
    1. 工作区 .vscode/settings.json
    2. Cursor 用户设置
    3. VS Code 用户设置
    4. 固定默认值 (127.0.0.1:3000)
    
    Returns:
        dict: 包含 host, port, source（配置来源）的字典
    """
    host = None
    port = None
    source = "default"
    
    # 1. 尝试读取工作区设置
    workspace_settings = _get_workspace_settings()
    if workspace_settings:
        if CONFIG_KEY_HOST in workspace_settings:
            host = workspace_settings[CONFIG_KEY_HOST]
            source = "workspace"
        if CONFIG_KEY_PORT in workspace_settings:
            port = workspace_settings[CONFIG_KEY_PORT]
            source = "workspace"
    
    # 2. 如果工作区没有，尝试 Cursor 用户设置
    if host is None or port is None:
        cursor_settings = _get_cursor_user_settings()
        if cursor_settings:
            if host is None and CONFIG_KEY_HOST in cursor_settings:
                host = cursor_settings[CONFIG_KEY_HOST]
                if source == "default":
                    source = "cursor-user"
            if port is None and CONFIG_KEY_PORT in cursor_settings:
                port = cursor_settings[CONFIG_KEY_PORT]
                if source == "default":
                    source = "cursor-user"
    
    # 3. 如果还是没有，尝试 VS Code 用户设置
    if host is None or port is None:
        vscode_settings = _get_vscode_user_settings()
        if vscode_settings:
            if host is None and CONFIG_KEY_HOST in vscode_settings:
                host = vscode_settings[CONFIG_KEY_HOST]
                if source == "default":
                    source = "vscode-user"
            if port is None and CONFIG_KEY_PORT in vscode_settings:
                port = vscode_settings[CONFIG_KEY_PORT]
                if source == "default":
                    source = "vscode-user"
    
    # 4. 使用默认值
    if host is None:
        host = DEFAULT_HOST
    if port is None:
        port = DEFAULT_PORT
    
    return {
        "host": host,
        "port": int(port),
        "source": source
    }


def get_base_url(port: Optional[int] = None, host: Optional[str] = None) -> str:
    """
    获取 API base URL
    
    Args:
        port: 可选的端口覆盖（命令行参数）
        host: 可选的主机覆盖（命令行参数）
    
    Returns:
        str: 完整的 base URL，如 http://127.0.0.1:3000/api
    """
    config = get_config()
    
    actual_host = host if host is not None else config["host"]
    actual_port = port if port is not None else config["port"]
    
    return f"http://{actual_host}:{actual_port}/api"


def print_config() -> None:
    """
    打印当前配置信息（用于调试）
    """
    config = get_config()
    print(f"📋 MCP Server Configuration")
    print(f"   Host: {config['host']}")
    print(f"   Port: {config['port']}")
    print(f"   Source: {config['source']}")
    print(f"   Base URL: {get_base_url()}")


if __name__ == "__main__":
    print_config()
