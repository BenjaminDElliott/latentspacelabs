"""
Event types for the Hermes Hook Event System.

Defines the four core event types:
- PreToolUse: fired before a tool is executed
- PostToolUse: fired after a tool completes
- SessionStart: fired when a new agent session begins
- SessionEnd: fired when a session completes

All events carry metadata and a timestamp.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Dict


class EventType(Enum):
    """Enum of all supported hook event types."""

    PRE_TOOL_USE = auto()
    POST_TOOL_USE = auto()
    SESSION_START = auto()
    SESSION_END = auto()


@dataclass(frozen=True)
class Event:
    """Base event carried by the hook system.

    Attributes:
        event_type: The EventType identifying what occurred.
        timestamp: Unix epoch time when the event was created.
        metadata: Arbitrary key-value context attached to the event.
    """

    event_type: EventType = EventType.SESSION_START
    timestamp: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        """Get a metadata value by key, returning default if absent."""
        return self.metadata.get(key, default)


# --- Concrete event types with domain-specific metadata ---


@dataclass(frozen=True)
class PreToolUse(Event):
    """Event fired before a tool invocation.

    Attributes:
        tool_name: Name of the tool about to be called.
        params: Parameters passed to the tool.
        tool_context: Additional context about the calling session.
    """

    tool_name: str = ""
    params: Dict[str, Any] = field(default_factory=dict)
    tool_context: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_type", EventType.PRE_TOOL_USE)


@dataclass(frozen=True)
class PostToolUse(Event):
    """Event fired after a tool invocation completes.

    Attributes:
        tool_name: Name of the tool that was called.
        params: Parameters passed to the tool.
        result: The result returned by the tool (may be None on error).
        error: Error message if the tool raised an exception, else None.
        duration_ms: Execution time in milliseconds.
    """

    tool_name: str = ""
    params: Dict[str, Any] = field(default_factory=dict)
    result: Any = None
    error: str | None = None
    duration_ms: float = 0.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_type", EventType.POST_TOOL_USE)


@dataclass(frozen=True)
class SessionStart(Event):
    """Event fired when a new agent session begins.

    Attributes:
        session_id: Unique identifier for this session.
        user: User identifier or name.
        context: Additional session setup context.
    """

    session_id: str = ""
    user: str = ""
    context: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_type", EventType.SESSION_START)


@dataclass(frozen=True)
class SessionEnd(Event):
    """Event fired when an agent session completes.

    Attributes:
        session_id: Unique identifier for the completed session.
        user: User identifier or name.
        duration_ms: Total session duration in milliseconds.
        tool_invocations: Count of tools invoked during the session.
        context: Additional session teardown context.
    """

    session_id: str = ""
    user: str = ""
    duration_ms: float = 0.0
    tool_invocations: int = 0
    context: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_type", EventType.SESSION_END)
