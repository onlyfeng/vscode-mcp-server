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
import json
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

# 默认配置
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000

# settings.json 中的配置键名
CONFIG_KEY_HOST = "vscode-mcp-server.host"
CONFIG_KEY_PORT = "vscode-mcp-server.port"


def _strip_jsonc_comments(json_str: str) -> str:
    """
    移除 JSONC 注释（// 与 /* */），保持字符串内容不被误删
    """
    result = []
    in_string = False
    escape = False
    i = 0
    length = len(json_str)

    while i < length:
        ch = json_str[i]

        if in_string:
            result.append(ch)
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
            continue

        if ch == '/' and i + 1 < length:
            next_ch = json_str[i + 1]
            if next_ch == '/':
                i += 2
                while i < length and json_str[i] not in '\r\n':
                    i += 1
                continue
            if next_ch == '*':
                i += 2
                saw_newline = False
                while i < length:
                    if i + 1 < length and json_str[i] == '*' and json_str[i + 1] == '/':
                        i += 2
                        break
                    if json_str[i] in '\r\n':
                        result.append(json_str[i])
                        saw_newline = True
                    i += 1
                if not saw_newline:
                    result.append(' ')
                continue

        result.append(ch)
        i += 1

    return ''.join(result)


def _remove_trailing_commas(json_str: str) -> str:
    """
    移除对象或数组末尾的尾随逗号（忽略字符串内容）
    """
    result = []
    in_string = False
    escape = False
    i = 0
    length = len(json_str)

    while i < length:
        ch = json_str[i]

        if in_string:
            result.append(ch)
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
            continue

        if ch == ',':
            j = i + 1
            while j < length and json_str[j].isspace():
                j += 1
            if j < length and json_str[j] in ('}', ']'):
                i += 1
                continue

        result.append(ch)
        i += 1

    return ''.join(result)


def _remove_json_comments(json_str: str) -> str:
    """
    移除 JSON 中的注释（支持 // 和 /* */ 风格）和尾随逗号
    VS Code 的 settings.json 使用 JSONC 格式
    """
    without_comments = _strip_jsonc_comments(json_str)
    return _remove_trailing_commas(without_comments)


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


def _find_settings_in_parents(start_dir: Path) -> Optional[Tuple[Dict[str, Any], Path]]:
    for parent in [start_dir] + list(start_dir.parents):
        for rel_path in (Path('.vscode/settings.json'), Path('.claude/settings.json')):
            settings_path = parent / rel_path
            settings = _load_json_with_comments(settings_path)
            if settings is not None:
                return settings, settings_path
    return None


def _get_workspace_settings() -> Tuple[Optional[Dict[str, Any]], Optional[Path]]:
    """
    读取工作区 settings.json
    优先从当前工作目录向上查找，找不到再从脚本目录向上查找
    """
    cwd = Path.cwd()
    result = _find_settings_in_parents(cwd)
    if result:
        return result

    script_dir = Path(__file__).resolve().parent
    if script_dir != cwd:
        result = _find_settings_in_parents(script_dir)
        if result:
            return result

    return None, None


def _get_cursor_user_settings() -> Tuple[Optional[Dict[str, Any]], Optional[Path]]:
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
    
    settings = _load_json_with_comments(settings_path)
    if settings is None:
        return None, None
    return settings, settings_path


def _get_vscode_user_settings() -> Tuple[Optional[Dict[str, Any]], Optional[Path]]:
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
    
    settings = _load_json_with_comments(settings_path)
    if settings is None:
        return None, None
    return settings, settings_path


def get_config() -> Dict[str, Any]:
    """
    获取 MCP Server 配置（host 和 port）
    
    读取优先级：
    1. 工作区 .vscode/settings.json
    2. Cursor 用户设置
    3. VS Code 用户设置
    4. 固定默认值 (127.0.0.1:3000)
    
    Returns:
        dict: 包含 host, port, source, source_path（配置来源路径）的字典
    """
    host = None
    port = None
    source = "default"
    source_path: Optional[str] = None
    
    # 1. 尝试读取工作区设置
    workspace_settings, workspace_path = _get_workspace_settings()
    if workspace_settings:
        if CONFIG_KEY_HOST in workspace_settings:
            host = workspace_settings[CONFIG_KEY_HOST]
            source = "workspace"
            source_path = str(workspace_path)
        if CONFIG_KEY_PORT in workspace_settings:
            port = workspace_settings[CONFIG_KEY_PORT]
            source = "workspace"
            source_path = str(workspace_path)
    
    # 2. 如果工作区没有，尝试 Cursor 用户设置
    if host is None or port is None:
        cursor_settings, cursor_path = _get_cursor_user_settings()
        if cursor_settings:
            if host is None and CONFIG_KEY_HOST in cursor_settings:
                host = cursor_settings[CONFIG_KEY_HOST]
                if source == "default":
                    source = "cursor-user"
                    source_path = str(cursor_path)
            if port is None and CONFIG_KEY_PORT in cursor_settings:
                port = cursor_settings[CONFIG_KEY_PORT]
                if source == "default":
                    source = "cursor-user"
                    source_path = str(cursor_path)
    
    # 3. 如果还是没有，尝试 VS Code 用户设置
    if host is None or port is None:
        vscode_settings, vscode_path = _get_vscode_user_settings()
        if vscode_settings:
            if host is None and CONFIG_KEY_HOST in vscode_settings:
                host = vscode_settings[CONFIG_KEY_HOST]
                if source == "default":
                    source = "vscode-user"
                    source_path = str(vscode_path)
            if port is None and CONFIG_KEY_PORT in vscode_settings:
                port = vscode_settings[CONFIG_KEY_PORT]
                if source == "default":
                    source = "vscode-user"
                    source_path = str(vscode_path)
    
    # 4. 使用默认值
    if host is None:
        host = DEFAULT_HOST
    if port is None:
        port = DEFAULT_PORT
    
    return {
        "host": host,
        "port": int(port),
        "source": source,
        "source_path": source_path
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
    source_path = config.get('source_path')
    if source_path:
        print(f"   Source: {source_path} ({config['source']})")
    else:
        print(f"   Source: {config['source']}")
    print(f"   Base URL: {get_base_url()}")


if __name__ == "__main__":
    print_config()
