"""
Logging handler for hook events.

Records event information to the Python logging framework.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from hermes_hooks.events import Event, EventType

logger = logging.getLogger(__name__)


class LoggingHandler:
    """Logs hook events at configurable levels.

    Usage:
        handler = LoggingHandler(level=logging.INFO)
        handler("event")  # callable interface
    """

    def __init__(
        self,
        level: int = logging.INFO,
        logger_name: Optional[str] = None,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.level = level
        self.logger = logging.getLogger(logger_name or "hermes_hooks")
        self.extra_fields = extra_fields or {}

    def __call__(self, event: Event) -> None:
        """Log the event.

        Args:
            event: The event to log.
        """
        msg = f"{event.event_type.name} - {json.dumps(event.metadata, default=str)}"
        self.logger.log(self.level, msg)


def create_logging_handler(
    level: int = logging.INFO,
    logger_name: Optional[str] = None,
) -> Any:
    """Factory function to create a LoggingHandler instance.

    Used in YAML config to instantiate handlers at load time.

    Args:
        level: Python logging level.
        logger_name: Logger name (defaults to 'hermes_hooks').

    Returns:
        A LoggingHandler instance (bound as callable for YAML loading).
    """
    handler = LoggingHandler(level=level, logger_name=logger_name)
    # Return a wrapper that captures the instance
    def wrapped(event: Event) -> None:
        handler(event)
    wrapped.__name__ = f"logging_handler({logger_name or 'hermes_hooks'})"
    return wrapped
