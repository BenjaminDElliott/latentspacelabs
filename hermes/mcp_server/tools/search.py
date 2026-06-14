"""Search tools for Hermes MCP server.

Tools: web_search, semantic_search, code_search
"""

TOOL_WEB_SEARCH = {
    "name": "search_web",
    "description": (
        "Perform a web search using DuckDuckGo. Returns search results with titles, "
        "URLs, and snippets."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query string",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return (default: 10)",
                "default": 10,
            },
        },
        "required": ["query"],
    },
}

TOOL_SEMANTIC_SEARCH = {
    "name": "search_semantic",
    "description": (
        "Perform a semantic (vector) search over the knowledge base. "
        "Finds content relevant to the query based on meaning, not just keywords."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query (supports natural language)",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results (default: 10)",
                "default": 10,
            },
            "category": {
                "type": "string",
                "description": "Filter by category (e.g., 'docs', 'decisions', 'prds')",
            },
        },
        "required": ["query"],
    },
}

TOOL_CODE_SEARCH = {
    "name": "search_code",
    "description": (
        "Search code files in the workspace using ripgrep-style patterns. "
        "Supports regex, word boundary, and file type filters."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Search pattern (supports regex)",
            },
            "path": {
                "type": "string",
                "description": "Root directory to search in (default: workspace root)",
            },
            "file_type": {
                "type": "string",
                "description": "Filter by file type (e.g., 'py', 'ts', 'md')",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results (default: 20)",
                "default": 20,
            },
        },
        "required": ["pattern"],
    },
}

ALL_TOOLS = [
    TOOL_WEB_SEARCH,
    TOOL_SEMANTIC_SEARCH,
    TOOL_CODE_SEARCH,
]


async def _handle_web_search(query: str, max_results: int = 10) -> str:
    """Perform web search."""
    return f"Web search for '{query}' (max {max_results} results): [results would be returned]"


async def _handle_semantic_search(
    query: str,
    max_results: int = 10,
    category: str | None = None,
) -> str:
    """Perform semantic search."""
    category_part = f" (category: {category})" if category else ""
    return f"Semantic search for '{query}'{category_part} (max {max_results}): [results would be returned]"


async def _handle_code_search(
    pattern: str,
    path: str | None = None,
    file_type: str | None = None,
    max_results: int = 20,
) -> str:
    """Search code."""
    path_part = f" (path: {path})" if path else ""
    file_part = f" (type: {file_type})" if file_type else ""
    return f"Code search for '{pattern}'{path_part}{file_part} (max {max_results}): [results would be returned]"


HANDLERS = {
    "search_web": _handle_web_search,
    "search_semantic": _handle_semantic_search,
    "search_code": _handle_code_search,
}
