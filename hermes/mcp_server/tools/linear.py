"""Linear project management tools for Hermes MCP server.

Tools: list_issues, get_issue, create_issue, update_issue,
       list_my_issues, list_issue_statuses, list_issue_labels,
       create_issue_label, list_projects, get_project,
       create_project, update_project, list_teams, get_team,
       list_users, create_comment
"""

TOOL_LIST_ISSUES = {
    "name": "linear_list_issues",
    "description": (
        "List issues in Linear workspace. Supports filtering by state, "
        "assignee, team, label, project, and priority."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "state": {"type": "string", "description": "Filter by state (e.g., 'backlog', 'todo', 'in_progress', 'done')"},
            "assignee": {"type": "string", "description": "Filter by assignee user ID or 'me'"},
            "team": {"type": "string", "description": "Filter by team name or ID"},
            "label": {"type": "string", "description": "Filter by label name or ID"},
            "project": {"type": "string", "description": "Filter by project name or ID"},
            "priority": {"type": "integer", "description": "Filter by priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)"},
            "limit": {"type": "integer", "description": "Max results to return (default: 50)", "default": 50},
        },
        "required": [],
    },
}

TOOL_GET_ISSUE = {
    "name": "linear_get_issue",
    "description": (
        "Get detailed information about a specific Linear issue by ID."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "issue_id": {
                "type": "string",
                "description": "Issue ID or identifier (e.g., 'LIN-123')",
            },
            "include_relations": {
                "type": "boolean",
                "description": "Include blocking/related/duplicate relations (default: false)",
                "default": False,
            },
        },
        "required": ["issue_id"],
    },
}

TOOL_CREATE_ISSUE = {
    "name": "linear_create_issue",
    "description": (
        "Create a new Linear issue with title, description, team, and optional fields."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Issue title (required)"},
            "description": {"type": "string", "description": "Issue description in Markdown"},
            "team": {"type": "string", "description": "Team name or ID (required)"},
            "state": {"type": "string", "description": "State type, name, or ID"},
            "priority": {"type": "integer", "description": "Priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)"},
            "assignee": {"type": "string", "description": "Assignee user ID, name, email, or 'me'"},
            "labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Label names or IDs",
            },
            "project": {"type": "string", "description": "Project name or ID"},
            "milestone": {"type": "string", "description": "Milestone name or ID"},
            "due_date": {"type": "string", "description": "Due date in ISO format"},
        },
        "required": ["title", "team"],
    },
}

TOOL_UPDATE_ISSUE = {
    "name": "linear_update_issue",
    "description": (
        "Update an existing Linear issue with new fields."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "issue_id": {"type": "string", "description": "Issue ID or identifier (e.g., 'LIN-123')"},
            "title": {"type": "string", "description": "New title"},
            "description": {"type": "string", "description": "New description in Markdown"},
            "state": {"type": "string", "description": "New state"},
            "priority": {"type": "integer", "description": "New priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)"},
            "assignee": {"type": "string", "description": "New assignee (user ID, name, email, or 'me')"},
            "labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "New labels",
            },
            "project": {"type": "string", "description": "New project"},
            "milestone": {"type": "string", "description": "New milestone"},
            "due_date": {"type": "string", "description": "New due date in ISO format"},
        },
        "required": ["issue_id"],
    },
}

TOOL_LIST_MY_ISSUES = {
    "name": "linear_list_my_issues",
    "description": (
        "List issues assigned to the current user."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "state": {"type": "string", "description": "Filter by state"},
            "limit": {"type": "integer", "description": "Max results (default: 50)", "default": 50},
        },
        "required": [],
    },
}

TOOL_LIST_ISSUE_STATUSES = {
    "name": "linear_list_issue_statuses",
    "description": (
        "List available issue statuses in a team."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "team": {"type": "string", "description": "Team name or ID"},
        },
        "required": ["team"],
    },
}

TOOL_LIST_ISSUE_LABELS = {
    "name": "linear_list_issue_labels",
    "description": (
        "List available issue labels in the workspace or team."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "team": {"type": "string", "description": "Team name or ID"},
            "name": {"type": "string", "description": "Filter by label name"},
        },
        "required": [],
    },
}

TOOL_CREATE_ISSUE_LABEL = {
    "name": "linear_create_issue_label",
    "description": (
        "Create a new Linear issue label."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Label name (required)"},
            "description": {"type": "string", "description": "Label description"},
            "color": {"type": "string", "description": "Hex color code"},
            "team_id": {"type": "string", "description": "Team UUID (omit for workspace label)"},
        },
        "required": ["name"],
    },
}

TOOL_LIST_PROJECTS = {
    "name": "linear_list_projects",
    "description": (
        "List projects in the workspace."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search project name"},
            "state": {"type": "string", "description": "Filter by state"},
            "team": {"type": "string", "description": "Filter by team"},
        },
        "required": [],
    },
}

TOOL_GET_PROJECT = {
    "name": "linear_get_project",
    "description": (
        "Get details of a specific project."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Project name, ID, or slug"},
        },
        "required": ["query"],
    },
}

TOOL_LIST_TEAMS = {
    "name": "linear_list_teams",
    "description": (
        "List teams in the workspace."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
        },
        "required": [],
    },
}

TOOL_GET_TEAM = {
    "name": "linear_get_team",
    "description": (
        "Get details of a specific team."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Team UUID, key, or name"},
        },
        "required": ["query"],
    },
}

TOOL_LIST_USERS = {
    "name": "linear_list_users",
    "description": (
        "List users in the workspace."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Filter by name or email"},
            "team": {"type": "string", "description": "Filter by team"},
        },
        "required": [],
    },
}

TOOL_CREATE_COMMENT = {
    "name": "linear_create_comment",
    "description": (
        "Create or update a comment on a Linear issue, project, or document."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "issue_id": {"type": "string", "description": "Issue ID to comment on"},
            "body": {"type": "string", "description": "Comment body in Markdown"},
        },
        "required": ["body"],
    },
}

ALL_TOOLS = [
    TOOL_LIST_ISSUES,
    TOOL_GET_ISSUE,
    TOOL_CREATE_ISSUE,
    TOOL_UPDATE_ISSUE,
    TOOL_LIST_MY_ISSUES,
    TOOL_LIST_ISSUE_STATUSES,
    TOOL_LIST_ISSUE_LABELS,
    TOOL_CREATE_ISSUE_LABEL,
    TOOL_LIST_PROJECTS,
    TOOL_GET_PROJECT,
    TOOL_LIST_TEAMS,
    TOOL_GET_TEAM,
    TOOL_LIST_USERS,
    TOOL_CREATE_COMMENT,
]


async def _handle_list_issues(
    state: str | None = None,
    assignee: str | None = None,
    team: str | None = None,
    label: str | None = None,
    project: str | None = None,
    priority: int | None = None,
    limit: int = 50,
) -> str:
    """List Linear issues."""
    return f"Listed up to {limit} issues (state={state}, assignee={assignee}, team={team}, label={label}, project={project}, priority={priority})"


async def _handle_get_issue(issue_id: str, include_relations: bool = False) -> str:
    """Get Linear issue."""
    return f"Got issue {issue_id} (relations={include_relations})"


async def _handle_create_issue(
    title: str,
    team: str,
    description: str | None = None,
    state: str | None = None,
    priority: int | None = None,
    assignee: str | None = None,
    labels: list[str] | None = None,
    project: str | None = None,
    milestone: str | None = None,
    due_date: str | None = None,
) -> str:
    """Create Linear issue."""
    return f"Created issue: '{title}' on team '{team}'"


async def _handle_update_issue(issue_id: str, **kwargs) -> str:
    """Update Linear issue."""
    fields = [k for k in kwargs if k != "issue_id" and kwargs[k] is not None]
    return f"Updated issue {issue_id}: fields modified = {fields}"


async def _handle_list_my_issues(state: str | None = None, limit: int = 50) -> str:
    """List issues assigned to me."""
    return f"Listed my issues (state={state}, limit={limit})"


async def _handle_list_issue_statuses(team: str) -> str:
    """List issue statuses."""
    return f"Statuses for team '{team}': [status list would be returned]"


async def _handle_list_issue_labels(team: str | None = None, name: str | None = None) -> str:
    """List issue labels."""
    team_filter = f" (team={team})" if team else ""
    return f"Labels{team_filter}: [labels would be returned]"


async def _handle_create_issue_label(
    name: str,
    description: str | None = None,
    color: str | None = None,
    team_id: str | None = None,
) -> str:
    """Create issue label."""
    team_filter = f" (team={team_id})" if team_id else ""
    return f"Created label '{name}'{team_filter}"


async def _handle_list_projects(query: str | None = None, state: str | None = None, team: str | None = None) -> str:
    """List projects."""
    return f"Listed projects (query={query}, state={state}, team={team})"


async def _handle_get_project(query: str) -> str:
    """Get project."""
    return f"Got project: '{query}'"


async def _handle_list_teams(query: str | None = None) -> str:
    """List teams."""
    return f"Listed teams (query={query})"


async def _handle_get_team(query: str) -> str:
    """Get team."""
    return f"Got team: '{query}'"


async def _handle_list_users(query: str | None = None, team: str | None = None) -> str:
    """List users."""
    return f"Listed users (query={query}, team={team})"


async def _handle_create_comment(body: str, issue_id: str | None = None) -> str:
    """Create comment."""
    target = f"issue {issue_id}" if issue_id else "target"
    return f"Comment on {target}: {body[:80]}{'...' if len(body) > 80 else ''}"


HANDLERS = {
    "linear_list_issues": _handle_list_issues,
    "linear_get_issue": _handle_get_issue,
    "linear_create_issue": _handle_create_issue,
    "linear_update_issue": _handle_update_issue,
    "linear_list_my_issues": _handle_list_my_issues,
    "linear_list_issue_statuses": _handle_list_issue_statuses,
    "linear_list_issue_labels": _handle_list_issue_labels,
    "linear_create_issue_label": _handle_create_issue_label,
    "linear_list_projects": _handle_list_projects,
    "linear_get_project": _handle_get_project,
    "linear_list_teams": _handle_list_teams,
    "linear_get_team": _handle_get_team,
    "linear_list_users": _handle_list_users,
    "linear_create_comment": _handle_create_comment,
}
