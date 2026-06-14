"""
Built-in hook handlers for common use cases.

These handlers can be referenced in YAML config files by their
module path (e.g., hermes_hooks.handlers.logging_handler).
"""

from hermes_hooks.handlers.logging_handler import (
    LoggingHandler,
    create_logging_handler,
)
from hermes_hooks.handlers.timing_handler import (
    TimingHandler,
    create_timing_handler,
)

__all__ = [
    "LoggingHandler",
    "create_logging_handler",
    "TimingHandler",
    "create_timing_handler",
]
