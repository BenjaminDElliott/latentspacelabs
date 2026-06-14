"""Hermes MCP Server — stdio transport for exposing tool definitions and context.

Implements LAT-323: MCP server implementation for Hermes agent communication.

This package provides a Model Context Protocol (MCP) server that exposes
Hermes tool definitions to other agents (Claude Code, Gemini CLI, local agents)
via the standard JSON-RPC over stdio transport.

Architecture: MCP server → Message bus → Context sharing → Local IPC
Leverages Anemoi's semi-centralized architecture pattern.

Tool categories exposed:
- browser: Browser automation tools (navigate, click, screenshot, fill)
- terminal: Terminal execution tools (run commands, capture output)
- file: Filesystem tools (read, write, list, search files)
- web: Web request tools (GET, POST, scrape)
- linear: Linear project management tools (issues, projects, teams)
- discord: Discord communication tools (channels, messages, reactions)
- cron: Cron scheduling tools (list, create, delete schedules)
- search: Search tools (web search, semantic search)
- delegate: Agent delegation tools (delegate tasks to other agents)
- memory: Memory/context tools (read, write, forget context)
- skills: Skill management tools (list, activate, deactivate skills)

Context sharing: A shared state mechanism allowing agents to exchange
context through the MCP server, supporting both in-process and
remote (stdio/SSE) deployments.

Usage:
    python3 -m hermes.mcp_server          # stdio transport (default)
    python3 -m hermes.mcp_server --help   # show options
"""

from hermes.mcp_server.server import create_server, run_server
from hermes.mcp_server.context import ContextBus

__all__ = ["create_server", "run_server", "ContextBus"]
__version__ = "0.1.0"
