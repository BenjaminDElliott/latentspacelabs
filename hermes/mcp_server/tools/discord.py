"""Discord communication tools for Hermes MCP server.

Tools: list_channels, get_channel, send_message, list_messages,
       add_reaction, remove_reaction, list_roles
"""

TOOL_LIST_CHANNELS = {
    "name": "discord_list_channels",
    "description": (
        "List available Discord channels in a guild or specific channel category."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "guild_id": {
                "type": "string",
                "description": "Discord guild (server) ID",
            },
            "channel_type": {
                "type": "string",
                "description": "Filter by channel type (text, voice, category)",
            },
        },
        "required": ["guild_id"],
    },
}

TOOL_GET_CHANNEL = {
    "name": "discord_get_channel",
    "description": "Get details about a specific Discord channel.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "channel_id": {
                "type": "string",
                "description": "Discord channel ID",
            },
        },
        "required": ["channel_id"],
    },
}

TOOL_SEND_MESSAGE = {
    "name": "discord_send_message",
    "description": (
        "Send a message to a Discord channel. Supports embeds and file attachments."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "channel_id": {
                "type": "string",
                "description": "Discord channel ID to send to",
            },
            "content": {
                "type": "string",
                "description": "Message content (supports Markdown)",
            },
            "embed": {
                "type": "object",
                "description": "Optional embed data (title, description, fields, etc.)",
            },
            "tts": {
                "type": "boolean",
                "description": "Send as text-to-speech (default: false)",
                "default": False,
            },
        },
        "required": ["channel_id", "content"],
    },
}

TOOL_LIST_MESSAGES = {
    "name": "discord_list_messages",
    "description": (
        "List recent messages in a Discord channel."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "channel_id": {
                "type": "string",
                "description": "Discord channel ID",
            },
            "limit": {
                "type": "integer",
                "description": "Number of messages to fetch (default: 50)",
                "default": 50,
            },
            "before": {
                "type": "string",
                "description": "Fetch messages before this message ID",
            },
        },
        "required": ["channel_id"],
    },
}

TOOL_ADD_REACTION = {
    "name": "discord_add_reaction",
    "description": "Add a reaction to a Discord message.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "channel_id": {
                "type": "string",
                "description": "Discord channel ID",
            },
            "message_id": {
                "type": "string",
                "description": "Message ID to react to",
            },
            "emoji": {
                "type": "string",
                "description": "Emoji to add (Unicode or custom emoji ID)",
            },
        },
        "required": ["channel_id", "message_id", "emoji"],
    },
}

TOOL_REMOVE_REACTION = {
    "name": "discord_remove_reaction",
    "description": "Remove a reaction from a Discord message.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "channel_id": {
                "type": "string",
                "description": "Discord channel ID",
            },
            "message_id": {
                "type": "string",
                "description": "Message ID to remove reaction from",
            },
            "emoji": {
                "type": "string",
                "description": "Emoji to remove",
            },
        },
        "required": ["channel_id", "message_id", "emoji"],
    },
}

TOOL_LIST_ROLES = {
    "name": "discord_list_roles",
    "description": (
        "List available roles in a Discord guild."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "guild_id": {
                "type": "string",
                "description": "Discord guild (server) ID",
            },
        },
        "required": ["guild_id"],
    },
}

ALL_TOOLS = [
    TOOL_LIST_CHANNELS,
    TOOL_GET_CHANNEL,
    TOOL_SEND_MESSAGE,
    TOOL_LIST_MESSAGES,
    TOOL_ADD_REACTION,
    TOOL_REMOVE_REACTION,
    TOOL_LIST_ROLES,
]


async def _handle_list_channels(guild_id: str, channel_type: str | None = None) -> str:
    """List Discord channels."""
    filter_part = f" ({channel_type})" if channel_type else ""
    return f"Listed channels in guild {guild_id}{filter_part}: [channel list would be returned]"


async def _handle_get_channel(channel_id: str) -> str:
    """Get channel details."""
    return f"Got channel {channel_id}: [channel details would be returned]"


async def _handle_send_message(
    channel_id: str,
    content: str,
    embed: dict | None = None,
    tts: bool = False,
) -> str:
    """Send Discord message."""
    embed_part = " (with embed)" if embed else ""
    return f"Sent message to channel {channel_id}{embed_part}, tts={tts}"


async def _handle_list_messages(
    channel_id: str,
    limit: int = 50,
    before: str | None = None,
) -> str:
    """List Discord messages."""
    before_part = f" (before {before})" if before else ""
    return f"Listed {limit} messages in channel {channel_id}{before_part}: [messages would be returned]"


async def _handle_add_reaction(
    channel_id: str,
    message_id: str,
    emoji: str,
) -> str:
    """Add reaction."""
    return f"Added reaction '{emoji}' to message {message_id} in channel {channel_id}"


async def _handle_remove_reaction(
    channel_id: str,
    message_id: str,
    emoji: str,
) -> str:
    """Remove reaction."""
    return f"Removed reaction '{emoji}' from message {message_id} in channel {channel_id}"


async def _handle_list_roles(guild_id: str) -> str:
    """List roles."""
    return f"Listed roles in guild {guild_id}: [roles would be returned]"


HANDLERS = {
    "discord_list_channels": _handle_list_channels,
    "discord_get_channel": _handle_get_channel,
    "discord_send_message": _handle_send_message,
    "discord_list_messages": _handle_list_messages,
    "discord_add_reaction": _handle_add_reaction,
    "discord_remove_reaction": _handle_remove_reaction,
    "discord_list_roles": _handle_list_roles,
}
