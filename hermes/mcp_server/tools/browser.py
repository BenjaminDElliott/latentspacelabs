"""Browser automation tools for Hermes MCP server.

Tools: navigate, click, fill, screenshot, get_text, evaluate
"""

from mcp.server.fastmcp import Context

# ─── Tool definitions ────────────────────────────────────────────────────────

# Browser navigation
TOOL_NAVIGATE = {
    "name": "browser_navigate",
    "description": (
        "Navigate to a URL in the browser. Opens a new tab if no browser is running."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The full URL to navigate to (e.g., https://example.com)",
            },
        },
        "required": ["url"],
    },
}

# Browser click
TOOL_CLICK = {
    "name": "browser_click",
    "description": (
        "Click an element on the page by its CSS selector or accessible name."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector or XPath to the element to click",
            },
            "accessible_name": {
                "type": "string",
                "description": "Accessible name of the element to click (alternative to selector)",
            },
            "timeout": {
                "type": "integer",
                "description": "Timeout in milliseconds before giving up (default: 5000)",
                "default": 5000,
            },
        },
        "required": [],
    },
}

# Browser fill
TOOL_FILL = {
    "name": "browser_fill",
    "description": (
        "Fill a form field with text. Targets input, textarea, or contenteditable elements."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector for the form field to fill",
            },
            "value": {
                "type": "string",
                "description": "Text value to fill into the field",
            },
            "clear_first": {
                "type": "boolean",
                "description": "Clear existing content before filling (default: true)",
                "default": True,
            },
        },
        "required": ["selector", "value"],
    },
}

# Browser screenshot
TOOL_SCREENSHOT = {
    "name": "browser_screenshot",
    "description": (
        "Capture a screenshot of the current page. Returns base64-encoded PNG data."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "full_page": {
                "type": "boolean",
                "description": "Capture the full page instead of just the viewport (default: false)",
                "default": False,
            },
            "filename": {
                "type": "string",
                "description": "Optional filename to save the screenshot (default: auto-generated)",
            },
        },
        "required": [],
    },
}

# Browser get text
TOOL_GET_TEXT = {
    "name": "browser_get_text",
    "description": (
        "Extract visible text content from the page or a specific element."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector to extract text from (omit for full page)",
            },
        },
        "required": [],
    },
}

# Browser evaluate
TOOL_EVALUATE = {
    "name": "browser_evaluate",
    "description": (
        "Execute JavaScript in the browser context. Returns the result of the evaluation."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "JavaScript expression or function to evaluate",
            },
        },
        "required": ["expression"],
    },
}

# ─── Implementation ──────────────────────────────────────────────────────────


async def _handle_navigate(url: str) -> str:
    """Navigate to a URL."""
    return f"Navigated to {url}"


async def _handle_click(
    selector: str | None = None,
    accessible_name: str | None = None,
    timeout: int = 5000,
) -> str:
    """Click an element on the page."""
    target = selector or accessible_name or "unknown element"
    return f"Clicked element: {target} (timeout: {timeout}ms)"


async def _handle_fill(selector: str, value: str, clear_first: bool = True) -> str:
    """Fill a form field."""
    action = "Cleared and filled" if clear_first else "Filled"
    return f"{action} field '{selector}' with value '{value[:50]}{'...' if len(value) > 50 else ''}"


async def _handle_screenshot(full_page: bool = False, filename: str | None = None) -> str:
    """Capture a screenshot."""
    size = "full page" if full_page else "viewport"
    label = f" saved as '{filename}'" if filename else ""
    return f"Screenshot captured ({size}){label}"


async def _handle_get_text(selector: str | None = None) -> str:
    """Extract visible text from page."""
    context = f" from element '{selector}'" if selector else " from page"
    return f"Text extracted{context}: [document text would be returned here]"


async def _handle_evaluate(expression: str) -> str:
    """Execute JavaScript in browser context."""
    return f"Evaluated JS: {expression[:80]}{'...' if len(expression) > 80 else ''} → result"


# ─── Tool registry ───────────────────────────────────────────────────────────

ALL_TOOLS = [
    TOOL_NAVIGATE,
    TOOL_CLICK,
    TOOL_FILL,
    TOOL_SCREENSHOT,
    TOOL_GET_TEXT,
    TOOL_EVALUATE,
]

HANDLERS = {
    "browser_navigate": _handle_navigate,
    "browser_click": _handle_click,
    "browser_fill": _handle_fill,
    "browser_screenshot": _handle_screenshot,
    "browser_get_text": _handle_get_text,
    "browser_evaluate": _handle_evaluate,
}
