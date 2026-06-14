"""Cron scheduling tools for Hermes MCP server.

Tools: list_crons, create_cron, update_cron, delete_cron, run_cron
"""

TOOL_LIST_CRONS = {
    "name": "cron_list",
    "description": (
        "List all scheduled cron jobs for the current user or workspace."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "active_only": {
                "type": "boolean",
                "description": "Only list active schedules (default: false)",
                "default": False,
            },
        },
        "required": [],
    },
}

TOOL_CREATE_CRON = {
    "name": "cron_create",
    "description": (
        "Create a new scheduled cron job. Schedules run a command or task "
        "at regular intervals."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Human-readable name for the cron schedule",
            },
            "command": {
                "type": "string",
                "description": "Shell command to execute when the cron fires",
            },
            "schedule": {
                "type": "string",
                "description": "Cron expression (e.g., '*/5 * * * *' for every 5 min) "
                "or interval (e.g., '1h', '1d')",
            },
            "team": {
                "type": "string",
                "description": "Team to associate the cron with",
            },
            "active": {
                "type": "boolean",
                "description": "Whether the cron is active immediately (default: true)",
                "default": True,
            },
        },
        "required": ["name", "command", "schedule"],
    },
}

TOOL_UPDATE_CRON = {
    "name": "cron_update",
    "description": "Update an existing scheduled cron job.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "cron_id": {
                "type": "string",
                "description": "Cron schedule ID or identifier",
            },
            "name": {
                "type": "string",
                "description": "New name",
            },
            "command": {
                "type": "string",
                "description": "New command to execute",
            },
            "schedule": {
                "type": "string",
                "description": "New cron expression or interval",
            },
            "active": {
                "type": "boolean",
                "description": "Toggle active status",
            },
        },
        "required": ["cron_id"],
    },
}

TOOL_DELETE_CRON = {
    "name": "cron_delete",
    "description": "Delete a scheduled cron job.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "cron_id": {
                "type": "string",
                "description": "Cron schedule ID or identifier to delete",
            },
        },
        "required": ["cron_id"],
    },
}

TOOL_RUN_CRON = {
    "name": "cron_run",
    "description": (
        "Manually trigger a cron job immediately (bypassing its schedule)."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "cron_id": {
                "type": "string",
                "description": "Cron schedule ID or identifier to run",
            },
        },
        "required": ["cron_id"],
    },
}

ALL_TOOLS = [
    TOOL_LIST_CRONS,
    TOOL_CREATE_CRON,
    TOOL_UPDATE_CRON,
    TOOL_DELETE_CRON,
    TOOL_RUN_CRON,
]


async def _handle_list_crons(active_only: bool = False) -> str:
    """List cron schedules."""
    filter_part = " (active only)" if active_only else ""
    return f"Listed cron schedules{filter_part}: [cron list would be returned]"


async def _handle_create_cron(
    name: str,
    command: str,
    schedule: str,
    team: str | None = None,
    active: bool = True,
) -> str:
    """Create cron schedule."""
    return f"Created cron '{name}' → '{command}' (schedule: {schedule}, team={team}, active={active})"


async def _handle_update_cron(
    cron_id: str,
    name: str | None = None,
    command: str | None = None,
    schedule: str | None = None,
    active: bool | None = None,
) -> str:
    """Update cron schedule."""
    fields = [k for k in [name, command, schedule] if k is not None]
    if active is not None:
        fields.append("active")
    return f"Updated cron {cron_id}: fields modified = {fields}"


async def _handle_delete_cron(cron_id: str) -> str:
    """Delete cron schedule."""
    return f"Deleted cron {cron_id}"


async def _handle_run_cron(cron_id: str) -> str:
    """Run cron immediately."""
    return f"Manually triggered cron {cron_id}: [execution result would be returned]"


HANDLERS = {
    "cron_list": _handle_list_crons,
    "cron_create": _handle_create_cron,
    "cron_update": _handle_update_cron,
    "cron_delete": _handle_delete_cron,
    "cron_run": _handle_run_cron,
}
