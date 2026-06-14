"""Terminal execution tools for Hermes MCP server.

Tools: run_command, list_processes, kill_process
"""

TOOL_RUN_COMMAND = {
    "name": "terminal_run_command",
    "description": (
        "Execute a shell command and return its stdout, stderr, and exit code. "
        "Supports interactive commands with a timeout."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The shell command to execute",
            },
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds (default: 60)",
                "default": 60,
            },
            "cwd": {
                "type": "string",
                "description": "Working directory for the command (default: current directory)",
            },
        },
        "required": ["command"],
    },
}

TOOL_LIST_PROCESSES = {
    "name": "terminal_list_processes",
    "description": (
        "List running processes, optionally filtered by name or user."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "filter": {
                "type": "string",
                "description": "Optional filter string to match process names",
            },
        },
        "required": [],
    },
}

TOOL_KILL_PROCESS = {
    "name": "terminal_kill_process",
    "description": "Terminate a process by PID or name.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "pid": {
                "type": "integer",
                "description": "Process ID to kill",
            },
            "name": {
                "type": "string",
                "description": "Process name to kill (kills all matching processes)",
            },
            "signal": {
                "type": "integer",
                "description": "Signal to send (default: 15/TERM, use 9/KILL for force)",
                "default": 15,
            },
        },
        "required": [],
    },
}

ALL_TOOLS = [
    TOOL_RUN_COMMAND,
    TOOL_LIST_PROCESSES,
    TOOL_KILL_PROCESS,
]


async def _handle_run_command(
    command: str,
    timeout: int = 60,
    cwd: str | None = None,
) -> str:
    """Execute a shell command."""
    return f"Executed: {command}\nTimeout: {timeout}s\nCWD: {cwd or '.'}\nOutput: [command output would be returned here]"


async def _handle_list_processes(filter_str: str | None = None) -> str:
    """List running processes."""
    filter_part = f" (filtered by '{filter_str}')" if filter_str else ""
    return f"Process list{filter_part}: [process listing would be returned here]"


async def _handle_kill_process(
    pid: int | None = None,
    name: str | None = None,
    signal: int = 15,
) -> str:
    """Kill a process."""
    target = f"PID {pid}" if pid else f"name '{name}'" if name else "unknown process"
    sig_name = "SIGKILL" if signal == 9 else "SIGTERM" if signal == 15 else str(signal)
    return f"Sent {sig_name} to {target}"


HANDLERS = {
    "terminal_run_command": _handle_run_command,
    "terminal_list_processes": _handle_list_processes,
    "terminal_kill_process": _handle_kill_process,
}
