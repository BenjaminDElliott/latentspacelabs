"""Skills management tools for Hermes MCP server.

Tools: list_skills, get_skill, activate_skill, deactivate_skill
"""

TOOL_LIST_SKILLS = {
    "name": "skills_list",
    "description": (
        "List all available skills in the Hermes workspace. "
        "Returns skill names, descriptions, and enabled status."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "enabled_only": {
                "type": "boolean",
                "description": "Only list enabled skills (default: false)",
                "default": False,
            },
            "category": {
                "type": "string",
                "description": "Filter by skill category",
            },
        },
        "required": [],
    },
}

TOOL_GET_SKILL = {
    "name": "skills_get",
    "description": (
        "Get detailed information about a specific skill, including its "
        "tool definitions and configuration."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Skill name to look up",
            },
        },
        "required": ["name"],
    },
}

TOOL_ACTIVATE_SKILL = {
    "name": "skills_activate",
    "description": (
        "Activate a skill, making its tools available for use."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Skill name to activate",
            },
            "config": {
                "type": "object",
                "description": "Optional skill configuration overrides",
            },
        },
        "required": ["name"],
    },
}

TOOL_DEACTIVATE_SKILL = {
    "name": "skills_deactivate",
    "description": (
        "Deactivate a skill, removing its tools from the available set."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Skill name to deactivate",
            },
        },
        "required": ["name"],
    },
}

ALL_TOOLS = [
    TOOL_LIST_SKILLS,
    TOOL_GET_SKILL,
    TOOL_ACTIVATE_SKILL,
    TOOL_DEACTIVATE_SKILL,
]


async def _handle_list_skills(
    enabled_only: bool = False,
    category: str | None = None,
) -> str:
    """List available skills."""
    filter_parts = []
    if enabled_only:
        filter_parts.append("enabled only")
    if category:
        filter_parts.append(f"category={category}")
    filter_str = f" ({', '.join(filter_parts)})" if filter_parts else ""
    return f"Listed skills{filter_str}: [skill list would be returned]"


async def _handle_get_skill(name: str) -> str:
    """Get skill details."""
    return f"Skill '{name}': [tool definitions and config would be returned]"


async def _handle_activate_skill(
    name: str,
    config: dict | None = None,
) -> str:
    """Activate a skill."""
    config_part = f" (config: {config})" if config else ""
    return f"Activated skill '{name}'{config_part}"


async def _handle_deactivate_skill(name: str) -> str:
    """Deactivate a skill."""
    return f"Deactivated skill '{name}'"


HANDLERS = {
    "skills_list": _handle_list_skills,
    "skills_get": _handle_get_skill,
    "skills_activate": _handle_activate_skill,
    "skills_deactivate": _handle_deactivate_skill,
}
