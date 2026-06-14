"""Main MCP server module for Hermes.

Creates and runs the FastMCP server with all tool definitions and
context sharing capabilities.

Usage:
    python3 -m hermes.mcp_server          # runs as stdio transport
    python3 -m hermes.mcp_server --help   # show options
"""

import json
import sys
import traceback
from typing import Any, Dict, Optional

from mcp.server.fastmcp import FastMCP

from hermes.mcp_server.context import ContextBus, get_context_bus
from hermes.mcp_server.tools import (
    browser,
    cron,
    delegate,
    discord,
    file,
    search,
    skills,
    linear,
    memory,
    terminal,
    web,
)


# ─── Server factory ──────────────────────────────────────────────────────────

def create_server() -> FastMCP:
    """Create and configure the Hermes MCP server.

    Returns:
        Configured FastMCP instance ready to run.

    Tools registered:
        browser: browser_navigate, browser_click, browser_fill,
                 browser_screenshot, browser_get_text, browser_evaluate
        terminal: terminal_run_command, terminal_list_processes,
                  terminal_kill_process
        file: file_read, file_write, file_list_directory,
              file_search, file_create_directory
        web: web_get, web_post, web_scrape
        linear: linear_list_issues, linear_get_issue, linear_create_issue,
                linear_update_issue, linear_list_my_issues, linear_list_issue_statuses,
                linear_list_issue_labels, linear_create_issue_label,
                linear_list_projects, linear_get_project, linear_list_teams,
                linear_get_team, linear_list_users, linear_create_comment
        discord: discord_list_channels, discord_get_channel, discord_send_message,
                 discord_list_messages, discord_add_reaction, discord_remove_reaction,
                 discord_list_roles
        cron: cron_list, cron_create, cron_update, cron_delete, cron_run
        search: search_web, search_semantic, search_code
        delegate: delegate_task, delegate_status, delegate_cancel
        memory: memory_read, memory_write, memory_delete, memory_list,
                memory_forget
        skills: skills_list, skills_get, skills_activate, skills_deactivate
    """
    server = FastMCP(
        name="hermes",
        instructions=(
            "Hermes MCP Server — exposes tool definitions and context sharing "
            "to other agents. Part of LAT-316 (Multi-Agent Communication Protocols). "
            "Leverages Anemoi's semi-centralized architecture: "
            "MCP server → Message bus → Context sharing → Local IPC."
        ),
        debug=False,
    )

    # ── Register context-aware tools ──
    _register_context_tools(server)

    # ── Register browser tools ──
    _register_tools(server, browser.ALL_TOOLS, browser.HANDLERS)

    # ── Register terminal tools ──
    _register_tools(server, terminal.ALL_TOOLS, terminal.HANDLERS)

    # ── Register file tools ──
    _register_tools(server, file.ALL_TOOLS, file.HANDLERS)

    # ── Register web tools ──
    _register_tools(server, web.ALL_TOOLS, web.HANDLERS)

    # ── Register Linear tools ──
    _register_tools(server, linear.ALL_TOOLS, linear.HANDLERS)

    # ── Register Discord tools ──
    _register_tools(server, discord.ALL_TOOLS, discord.HANDLERS)

    # ── Register Cron tools ──
    _register_tools(server, cron.ALL_TOOLS, cron.HANDLERS)

    # ── Register Search tools ──
    _register_tools(server, search.ALL_TOOLS, search.HANDLERS)

    # ── Register Delegate tools ──
    _register_tools(server, delegate.ALL_TOOLS, delegate.HANDLERS)

    # ── Register Memory tools ──
    _register_tools(server, memory.ALL_TOOLS, memory.HANDLERS)

    # ── Register Skills tools ──
    _register_tools(server, skills.ALL_TOOLS, skills.HANDLERS)

    return server


def _register_context_tools(server: FastMCP) -> None:
    """Register context sharing tools on the MCP server."""
    bus = get_context_bus()

    @server.tool()
    async def context_read(namespace: str, key: str) -> str:
        """Read a value from the shared context bus.

        Args:
            namespace: Context namespace (e.g., 'workspace', 'shared', 'session')
            key: Key to look up within the namespace

        Returns:
            The stored value as a JSON string, or 'null' if not found.
        """
        value = bus.read(namespace, key)
        if value is None:
            return json.dumps({"error": f"No value found for {namespace}:{key}"})
        return json.dumps({"value": value})

    @server.tool()
    async def context_write(
        namespace: str,
        key: str,
        value: str,
        ttl: int = 0,
    ) -> str:
        """Write a value to the shared context bus.

        Args:
            namespace: Context namespace (e.g., 'workspace', 'shared', 'session')
            key: Key to store under
            value: JSON-serializable value (as string)
            ttl: Time-to-live in seconds (0 = no expiry)

        Returns:
            Confirmation with the context path.
        """
        try:
            parsed_value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            parsed_value = value

        path = bus.write(namespace, key, parsed_value, ttl=ttl)
        return json.dumps({"path": path, "written": True})

    @server.tool()
    async def context_delete(namespace: str, key: str) -> str:
        """Delete a value from the shared context bus.

        Args:
            namespace: Context namespace
            key: Key to delete

        Returns:
            Confirmation of deletion.
        """
        deleted = bus.delete(namespace, key)
        return json.dumps({"deleted": deleted})

    @server.tool()
    async def context_list(namespace: str, include_expired: bool = False) -> str:
        """List all keys in a context namespace.

        Args:
            namespace: Context namespace to list
            include_expired: Whether to include expired entries

        Returns:
            JSON array of keys.
        """
        keys = bus.list_keys(namespace, include_expired=include_expired)
        return json.dumps({"keys": keys})

    @server.tool()
    async def context_snapshot(namespace: str) -> str:
        """Get a snapshot of all context in a namespace.

        Args:
            namespace: Context namespace to snapshot

        Returns:
            JSON object of all key-value pairs in the namespace.
        """
        snapshot = bus.get_snapshot(namespace)
        return json.dumps(snapshot)

    @server.tool()
    async def context_cleanup() -> str:
        """Remove all expired context entries.

        Returns:
            Number of entries cleaned up.
        """
        removed = bus.cleanup_expired()
        return json.dumps({"removed": removed})

    @server.tool()
    async def context_export() -> str:
        """Export the entire context bus state as JSON.

        Returns:
            Full JSON serialization of all context namespaces.
        """
        return bus.to_json()


def _register_tools(
    server: FastMCP,
    tool_defs: list,
    handlers: dict,
) -> None:
    """Register a set of tool definitions with the MCP server.

    Args:
        server: The FastMCP server instance
        tool_defs: List of tool definition dicts (each with name, description, inputSchema)
        handlers: Dict mapping tool names to async handler functions
    """
    for tool_def in tool_defs:
        tool_name = tool_def["name"]
        handler = handlers.get(tool_name)
        tool_desc = tool_def["description"]
        tool_schema = tool_def["inputSchema"]

        def _make_handler(tn, hd, sd):
            async def _tool_wrapper(**kwargs):
                """Wrapper that dispatches to the actual handler."""
                try:
                    if hd is None:
                        return json.dumps({
                            "error": f"No handler for tool '{tn}'",
                            "tool": tn,
                        })
                    result = await hd(**kwargs)
                    return json.dumps({"result": result, "tool": tn})
                except Exception as e:
                    return json.dumps({
                        "error": str(e),
                        "traceback": traceback.format_exc(),
                        "tool": tn,
                    })
            _tool_wrapper.__doc__ = f"MCP tool: {sd}"
            return _tool_wrapper

        wrapped = _make_handler(tool_name, handler, tool_schema)
        wrapped.__doc__ = tool_desc
        server.add_tool(wrapped, name=tool_name, description=tool_desc)


# ─── Server runner ───────────────────────────────────────────────────────────

def run_server() -> None:
    """Run the Hermes MCP server on stdio transport.

    This is the entry point when running as:
        python3 -m hermes.mcp_server
    """
    server = create_server()
    server.run(transport="stdio")


# ─── CLI entry point ─────────────────────────────────────────────────────────

def main() -> None:
    """CLI entry point with argument parsing."""
    # Default: run as stdio transport
    run_server()


if __name__ == "__main__":
    main()
