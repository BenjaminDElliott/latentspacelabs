"""Agent delegation tools for Hermes MCP server.

Tools: delegate_task, get_delegation_status, cancel_delegation
"""

TOOL_DELEGATE_TASK = {
    "name": "delegate_task",
    "description": (
        "Delegate a task to another agent (e.g., Linear agent, coding agent). "
        "Supports specifying target agent, task description, and priority."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Target agent name or ID (e.g., 'Linear', 'coding-agent')",
            },
            "task": {
                "type": "string",
                "description": "Task description to delegate",
            },
            "priority": {
                "type": "integer",
                "description": "Priority level (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)",
                "default": 3,
            },
            "context": {
                "type": "string",
                "description": "Additional context to provide to the delegate agent",
            },
            "parent_issue": {
                "type": "string",
                "description": "Parent issue ID if delegation is related to an issue",
            },
        },
        "required": ["agent", "task"],
    },
}

TOOL_GET_DELEGATION_STATUS = {
    "name": "delegate_status",
    "description": (
        "Check the status of a previously delegated task."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "delegation_id": {
                "type": "string",
                "description": "Delegation/task ID to check status for",
            },
        },
        "required": ["delegation_id"],
    },
}

TOOL_CANCEL_DELEGATION = {
    "name": "delegate_cancel",
    "description": (
        "Cancel a previously delegated task."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "delegation_id": {
                "type": "string",
                "description": "Delegation/task ID to cancel",
            },
            "reason": {
                "type": "string",
                "description": "Reason for cancellation",
            },
        },
        "required": ["delegation_id"],
    },
}

ALL_TOOLS = [
    TOOL_DELEGATE_TASK,
    TOOL_GET_DELEGATION_STATUS,
    TOOL_CANCEL_DELEGATION,
]


async def _handle_delegate_task(
    agent: str,
    task: str,
    priority: int = 3,
    context: str | None = None,
    parent_issue: str | None = None,
) -> str:
    """Delegate a task."""
    ctx = f" (context: {context[:50]}...)" if context else ""
    issue = f" (parent: {parent_issue})" if parent_issue else ""
    return f"Delegated to '{agent}': '{task[:80]}...' (priority={priority}){ctx}{issue}"


async def _handle_get_delegation_status(delegation_id: str) -> str:
    """Get delegation status."""
    return f"Status of {delegation_id}: [status would be returned]"


async def _handle_cancel_delegation(
    delegation_id: str,
    reason: str | None = None,
) -> str:
    """Cancel delegation."""
    reason_part = f" (reason: {reason})" if reason else ""
    return f"Cancelled delegation {delegation_id}{reason_part}"


HANDLERS = {
    "delegate_task": _handle_delegate_task,
    "delegate_status": _handle_get_delegation_status,
    "delegate_cancel": _handle_cancel_delegation,
}
