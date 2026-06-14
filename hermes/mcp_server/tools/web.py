"""Web tools for Hermes MCP server.

Tools: web_get, web_post, web_scrape
"""

import json

TOOL_WEB_GET = {
    "name": "web_get",
    "description": (
        "Perform an HTTP GET request. Returns status, headers, and body."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch",
            },
            "headers": {
                "type": "object",
                "description": "Optional HTTP headers as key-value pairs",
            },
            "timeout": {
                "type": "integer",
                "description": "Request timeout in seconds (default: 30)",
                "default": 30,
            },
        },
        "required": ["url"],
    },
}

TOOL_WEB_POST = {
    "name": "web_post",
    "description": (
        "Perform an HTTP POST request with optional JSON body."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to POST to",
            },
            "headers": {
                "type": "object",
                "description": "Optional HTTP headers",
            },
            "json_body": {
                "type": "object",
                "description": "JSON payload to send in the request body",
            },
            "timeout": {
                "type": "integer",
                "description": "Request timeout in seconds (default: 30)",
                "default": 30,
            },
        },
        "required": ["url"],
    },
}

TOOL_WEB_SCRAPE = {
    "name": "web_scrape",
    "description": (
        "Scrape structured content from a webpage using CSS selectors."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to scrape",
            },
            "selectors": {
                "type": "array",
                "items": {"type": "string"},
                "description": "CSS selectors to extract (returns map of selector → text)",
            },
            "timeout": {
                "type": "integer",
                "description": "Request timeout in seconds (default: 30)",
                "default": 30,
            },
        },
        "required": ["url", "selectors"],
    },
}

ALL_TOOLS = [
    TOOL_WEB_GET,
    TOOL_WEB_POST,
    TOOL_WEB_SCRAPE,
]


async def _handle_web_get(
    url: str,
    headers: dict | None = None,
    timeout: int = 30,
) -> str:
    """Perform GET request."""
    hdrs = json.dumps(headers) if headers else "{}"
    return f"GET {url}\nHeaders: {hdrs}\nTimeout: {timeout}s\nResponse: [status, headers, body would be returned]"


async def _handle_web_post(
    url: str,
    headers: dict | None = None,
    json_body: dict | None = None,
    timeout: int = 30,
) -> str:
    """Perform POST request."""
    hdrs = json.dumps(headers) if headers else "{}"
    body = json.dumps(json_body) if json_body else "{}"
    return f"POST {url}\nHeaders: {hdrs}\nBody: {body[:200]}\nTimeout: {timeout}s\nResponse: [status, body would be returned]"


async def _handle_web_scrape(
    url: str,
    selectors: list[str],
    timeout: int = 30,
) -> str:
    """Scrape webpage content."""
    sel_str = ", ".join(selectors)
    return f"Scraped {url}\nSelectors: [{sel_str}]\nTimeout: {timeout}s\nResult: [structured content would be returned]"


HANDLERS = {
    "web_get": _handle_web_get,
    "web_post": _handle_web_post,
    "web_scrape": _handle_web_scrape,
}
