"""
Timing handler for hook events.

Tracks and reports execution times for events.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from hermes_hooks.events import Event, EventType

logger = logging.getLogger(__name__)


class TimingHandler:
    """Tracks timing for hook events.

    Usage:
        handler = TimingHandler()
        handler("event")  # callable interface
    """

    def __init__(
        self,
        logger_name: Optional[str] = None,
    ) -> None:
        self.logger = logging.getLogger(logger_name or "hermes_hooks")

    def __call__(self, event: Event) -> None:
        """Log event timing info.

        Args:
            event: The event to track timing for.
        """
        self.logger.info(
            "Event %s took %.2fms",
            event.event_type.name,
            event.timestamp * 1000,
        )


def create_timing_handler(
    logger_name: Optional[str] = None,
) -> Any:
    """Factory function to create a TimingHandler instance.

    Args:
        logger_name: Logger name (defaults to 'hermes_hooks').

    Returns:
        A TimingHandler wrapped as a callable.
    """
    handler = TimingHandler(logger_name=logger_name)

    def wrapped(event: Event) -> None:
        handler(event)

    wrapped.__name__ = f"timing_handler({logger_name or 'hermes_hooks'})"
    return wrapped
