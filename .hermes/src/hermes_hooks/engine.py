"""
Hook Execution Engine.

Dispatches events to registered handlers and tracks execution timing
to ensure each event's hook execution stays under 100ms.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from hermes_hooks.events import Event, EventType
from hermes_hooks.registry import HookRegistry

logger = logging.getLogger(__name__)


class HookError(Exception):
    """Error raised when a hook handler fails."""

    def __init__(self, handler: Any, event: Event, original_error: Exception) -> None:
        self.handler = handler
        self.event = event
        self.original_error = original_error
        super().__init__(
            f"Hook handler '{handler}' failed for {event.event_type.name}: {original_error}"
        )


class HookEngine:
    """Executes hooks for events against a registry.

    The engine fires events through all registered handlers for
    that event type, collecting timing and error information.

    Attributes:
        registry: The HookRegistry to use for handler lookup.
        max_duration_ms: Maximum allowed execution time per event in ms.
        error_mode: How to handle handler errors ('raise', 'log', 'skip').
    """

    def __init__(
        self,
        registry: Optional[HookRegistry] = None,
        max_duration_ms: float = 100.0,
        error_mode: str = "log",
    ) -> None:
        """Initialize the hook engine.

        Args:
            registry: HookRegistry instance. Creates a new one if None.
            max_duration_ms: Maximum execution time per event in milliseconds.
            error_mode: Error handling strategy - 'raise', 'log', or 'skip'.
        """
        self.registry = registry or HookRegistry()
        self.max_duration_ms = max_duration_ms
        self.error_mode = error_mode

        # Execution history for each event
        self._execution_history: List[Dict[str, Any]] = []

    def fire(self, event: Event) -> Dict[str, Any]:
        """Fire an event through all registered handlers.

        Executes all handlers registered for the event's type,
        timing the execution and collecting any errors.

        Args:
            event: The Event to dispatch.

        Returns:
            Dictionary with:
              - success: bool indicating if all handlers succeeded.
              - duration_ms: total execution time in milliseconds.
              - handlers_executed: count of handlers that ran.
              - errors: list of HookError for any failures.
              - handler_results: dict mapping handler names to results/errors.

        Raises:
            HookError: If error_mode is 'raise' and any handler fails.
        """
        handlers = self.registry.list_handlers(event.event_type)

        start = time.perf_counter()
        errors: List[HookError] = []
        handler_results: Dict[str, Any] = {}

        for handler in handlers:
            handler_start = time.perf_counter()
            handler_name = getattr(handler, "__name__", str(handler))

            try:
                result = handler(event)
                handler_duration = (time.perf_counter() - handler_start) * 1000
                handler_results[handler_name] = {
                    "duration_ms": handler_duration,
                    "error": None,
                    "result": result,
                }

                if handler_duration > self.max_duration_ms:
                    logger.warning(
                        "Handler '%s' exceeded max duration: %.1fms > %.0fms",
                        handler_name,
                        handler_duration,
                        self.max_duration_ms,
                    )

            except Exception as e:
                handler_duration = (time.perf_counter() - handler_start) * 1000
                hook_err = HookError(handler, event, e)
                errors.append(hook_err)
                handler_results[handler_name] = {
                    "duration_ms": handler_duration,
                    "error": str(e),
                    "result": None,
                }

                if self.error_mode == "raise":
                    raise hook_err
                elif self.error_mode == "log":
                    logger.error("Hook error in '%s': %s", handler_name, e)

        total_duration = (time.perf_counter() - start) * 1000

        result = {
            "success": len(errors) == 0,
            "duration_ms": total_duration,
            "handlers_executed": len(handlers),
            "errors": errors,
            "handler_results": handler_results,
        }

        self._execution_history.append({
            "event_type": event.event_type.name,
            "timestamp": event.timestamp,
            "result": result,
        })

        return result

    def get_execution_history(self) -> List[Dict[str, Any]]:
        """Get the full execution history.

        Returns:
            List of execution records.
        """
        return list(self._execution_history)

    def clear_history(self) -> None:
        """Clear execution history."""
        self._execution_history.clear()

    def __repr__(self) -> str:
        return (
            f"HookEngine("
            f"max_duration_ms={self.max_duration_ms}, "
            f"error_mode='{self.error_mode}', "
            f"registry={self.registry})"
        )
