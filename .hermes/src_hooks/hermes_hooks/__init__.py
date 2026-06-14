"""
Hermes Hook Event System - Pure Python hook framework for agent tool-use patterns.

Event types: PreToolUse, PostToolUse, SessionStart, SessionEnd
Hook registry: YAML config → Python handlers
No external dependencies beyond Python stdlib.
"""

from hermes_hooks.events import (
    Event,
    PreToolUse,
    PostToolUse,
    SessionStart,
    SessionEnd,
    EventType,
)
from hermes_hooks.registry import HookRegistry
from hermes_hooks.engine import HookEngine

__all__ = [
    "Event",
    "PreToolUse",
    "PostToolUse",
    "SessionStart",
    "SessionEnd",
    "EventType",
    "HookRegistry",
    "HookEngine",
]

__version__ = "0.1.0"
