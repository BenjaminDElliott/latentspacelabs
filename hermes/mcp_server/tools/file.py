"""Filesystem tools for Hermes MCP server.

Tools: read_file, write_file, list_directory, search_files, create_directory
"""

TOOL_READ_FILE = {
    "name": "file_read",
    "description": (
        "Read the contents of a file. Returns file content as text."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute or relative path to the file to read",
            },
            "encoding": {
                "type": "string",
                "description": "File encoding (default: 'utf-8')",
                "default": "utf-8",
            },
            "max_lines": {
                "type": "integer",
                "description": "Maximum number of lines to read (default: 1000)",
                "default": 1000,
            },
        },
        "required": ["path"],
    },
}

TOOL_WRITE_FILE = {
    "name": "file_write",
    "description": (
        "Write content to a file. Creates parent directories if they don't exist."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the file to write",
            },
            "content": {
                "type": "string",
                "description": "Content to write to the file",
            },
            "append": {
                "type": "boolean",
                "description": "Append to file instead of overwriting (default: false)",
                "default": False,
            },
        },
        "required": ["path", "content"],
    },
}

TOOL_LIST_DIRECTORY = {
    "name": "file_list_directory",
    "description": (
        "List files and directories in a path. Supports glob patterns."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory path to list",
            },
            "pattern": {
                "type": "string",
                "description": "Glob pattern to filter results (e.g., '*.py')",
            },
            "recursive": {
                "type": "boolean",
                "description": "List recursively (default: false)",
                "default": False,
            },
        },
        "required": ["path"],
    },
}

TOOL_SEARCH_FILES = {
    "name": "file_search",
    "description": (
        "Search for files by name pattern within a directory tree."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Filename pattern to search for (supports glob, regex)",
            },
            "path": {
                "type": "string",
                "description": "Root directory to search in (default: current directory)",
            },
        },
        "required": ["pattern"],
    },
}

TOOL_CREATE_DIRECTORY = {
    "name": "file_create_directory",
    "description": (
        "Create a directory and any parent directories that don't exist."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path of the directory to create",
            },
            "parents": {
                "type": "boolean",
                "description": "Create parent directories (default: true)",
                "default": True,
            },
        },
        "required": ["path"],
    },
}

ALL_TOOLS = [
    TOOL_READ_FILE,
    TOOL_WRITE_FILE,
    TOOL_LIST_DIRECTORY,
    TOOL_SEARCH_FILES,
    TOOL_CREATE_DIRECTORY,
]


async def _handle_read_file(path: str, encoding: str = "utf-8", max_lines: int = 1000) -> str:
    """Read file contents."""
    return f"Read {max_lines} lines from '{path}' (encoding: {encoding})\nContent: [file contents would be returned here]"


async def _handle_write_file(path: str, content: str, append: bool = False) -> str:
    """Write file contents."""
    action = "Appended" if append else "Wrote"
    return f"{action} {len(content)} bytes to '{path}'"


async def _handle_list_directory(
    path: str, pattern: str | None = None, recursive: bool = False
) -> str:
    """List directory contents."""
    filter_part = f" ({pattern})" if pattern else ""
    depth = "recursive" if recursive else "one level"
    return f"Directory listing{filter_part} at '{path}' ({depth}): [directory listing would be returned here]"


async def _handle_search_files(pattern: str, path: str | None = None) -> str:
    """Search for files."""
    search_path = path or "."
    return f"Search for '{pattern}' in '{search_path}': [matching file paths would be returned here]"


async def _handle_create_directory(path: str, parents: bool = True) -> str:
    """Create a directory."""
    opt = ", parents=True" if parents else ""
    return f"Created directory '{path}'{opt}"


HANDLERS = {
    "file_read": _handle_read_file,
    "file_write": _handle_write_file,
    "file_list_directory": _handle_list_directory,
    "file_search": _handle_search_files,
    "file_create_directory": _handle_create_directory,
}
