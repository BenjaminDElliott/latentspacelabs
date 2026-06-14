"""Tool modules for the Hermes MCP server.

Each submodule defines tools (functions decorated with @tool or registered
via the FastMCP server) that are exposed to MCP clients.
"""

from hermes.mcp_server.tools import browser, terminal, file, web
from hermes.mcp_server.tools import linear, discord, cron, search
from hermes.mcp_server.tools import delegate, memory, skills

TOOL_MODULES = [
    browser,
    terminal,
    file,
    web,
    linear,
    discord,
    cron,
    search,
    delegate,
    memory,
    skills,
]

__all__ = [
    "browser",
    "terminal",
    "file",
    "web",
    "linear",
    "discord",
    "cron",
    "search",
    "delegate",
    "memory",
    "skills",
    "TOOL_MODULES",
]
