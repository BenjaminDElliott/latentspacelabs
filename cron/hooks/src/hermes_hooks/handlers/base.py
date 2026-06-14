"""
Base handler interface for custom hook handlers.

Subclass this to create custom handlers that respond to events.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from hermes_hooks.events import Event

logger = logging.getLogger(__name__)


class BaseHookHandler(ABC):
    """Abstract base class for custom hook handlers.

    Subclasses must implement the __call__ method to handle events.
    Optionally implement setup() and teardown() for lifecycle hooks.

    Attributes:
        logger: Logger instance for the handler.
    """

    def __init__(self, name: Optional[str] = None) -> None:
        self._name = name or self.__class__.__name__
        self.logger = logging.getLogger(f"hermes_hooks.handlers.{self._name}")

    @abstractmethod
    def __call__(self, event: Event) -> Any:
        """Handle an event.

        Args:
            event: The Event instance to handle.

        Returns:
            Any result from handling the event.

        Raises:
            Exception: Any exception will be caught by the HookEngine
                       and handled according to error_mode.
        """
        ...

    def setup(self) -> None:
        """Called before the handler starts processing events."""
        self.logger.info("Handler '%s' initialized", self._name)

    def teardown(self) -> None:
        """Called when the handler is being shut down."""
        self.logger.info("Handler '%s' shutting down", self._name)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name='{self._name}')"
