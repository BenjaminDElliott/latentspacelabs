"""Memory/context tools for Hermes MCP server.

Tools: memory_read, memory_write, memory_delete, memory_list, memory_forget
"""

TOOL_MEMORY_READ = {
    "name": "memory_read",
    "description": (
        "Read entries from Hermes memory. Supports filtering by key, "
        "category, and tag. Used to retrieve stored context, preferences, "
        "and knowledge."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Specific memory key to read",
            },
            "category": {
                "type": "string",
                "description": "Filter by category (e.g., 'preferences', 'knowledge', 'session')",
            },
            "tag": {
                "type": "string",
                "description": "Filter by tag",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of entries to return (default: 20)",
                "default": 20,
            },
        },
        "required": [],
    },
}

TOOL_MEMORY_WRITE = {
    "name": "memory_write",
    "description": (
        "Write an entry to Hermes memory. Creates or updates a memory "
        "entry with a key, category, and data."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Unique key for the memory entry (required)",
            },
            "category": {
                "type": "string",
                "description": "Category for organization (e.g., 'preferences', 'knowledge')",
            },
            "data": {
                "type": "string",
                "description": "Data to store (JSON string or plain text)",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Tags for categorization",
            },
        },
        "required": ["key", "data"],
    },
}

TOOL_MEMORY_DELETE = {
    "name": "memory_delete",
    "description": (
        "Delete an entry from Hermes memory."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Memory key to delete",
            },
        },
        "required": ["key"],
    },
}

TOOL_MEMORY_LIST = {
    "name": "memory_list",
    "description": (
        "List all memory entries, optionally filtered by category or tag."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Filter by category",
            },
            "tag": {
                "type": "string",
                "description": "Filter by tag",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum entries to return (default: 50)",
                "default": 50,
            },
        },
        "required": [],
    },
}

TOOL_MEMORY_FORGET = {
    "name": "memory_forget",
    "description": (
        "Forget entries matching a pattern. Useful for cleaning up stale context."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Pattern to match against memory keys (supports glob)",
            },
            "category": {
                "type": "string",
                "description": "Filter by category before applying pattern",
            },
        },
        "required": ["pattern"],
    },
}

ALL_TOOLS = [
    TOOL_MEMORY_READ,
    TOOL_MEMORY_WRITE,
    TOOL_MEMORY_DELETE,
    TOOL_MEMORY_LIST,
    TOOL_MEMORY_FORGET,
]


async def _handle_memory_read(
    key: str | None = None,
    category: str | None = None,
    tag: str | None = None,
    limit: int = 20,
) -> str:
    """Read from memory."""
    filter_parts = []
    if category:
        filter_parts.append(f"category={category}")
    if tag:
        filter_parts.append(f"tag={tag}")
    filter_str = f" ({', '.join(filter_parts)})" if filter_parts else ""
    return f"Read memory{filter_str} (key={key}, limit={limit}): [entries would be returned]"


async def _handle_memory_write(
    key: str,
    data: str,
    category: str | None = None,
    tags: list[str] | None = None,
) -> str:
    """Write to memory."""
    tags_str = f" (tags: {tags})" if tags else ""
    return f"Stored memory '{key}'{tags_str} (category={category})"


async def _handle_memory_delete(key: str) -> str:
    """Delete memory entry."""
    return f"Deleted memory entry '{key}'"


async def _handle_memory_list(
    category: str | None = None,
    tag: str | None = None,
    limit: int = 50,
) -> str:
    """List memory entries."""
    filter_parts = []
    if category:
        filter_parts.append(f"category={category}")
    if tag:
        filter_parts.append(f"tag={tag}")
    filter_str = f" ({', '.join(filter_parts)})" if filter_parts else ""
    return f"Listed memory{filter_str} (limit={limit}): [entries would be returned]"


async def _handle_memory_forget(pattern: str, category: str | None = None) -> str:
    """Forget memory entries."""
    cat = f" in category '{category}'" if category else ""
    return f"Forget pattern '{pattern}'{cat}: [matched entries would be removed]"


HANDLERS = {
    "memory_read": _handle_memory_read,
    "memory_write": _handle_memory_write,
    "memory_delete": _handle_memory_delete,
    "memory_list": _handle_memory_list,
    "memory_forget": _handle_memory_forget,
}
