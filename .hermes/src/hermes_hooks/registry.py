"""
Hook Registry: YAML config → Python handlers.

Loads hook configuration from YAML files and maps event types
to handler callables. Supports both absolute import paths and
inline Python callables.
"""

from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

import yaml

from hermes_hooks.events import EventType

logger = logging.getLogger(__name__)

# Default config filename
DEFAULT_CONFIG_FILE = "hooks.yaml"


class HookRegistry:
    """Registry that maps EventType to lists of handler callables.

    Handlers can be configured via:
    - YAML config files with handler module path + function name
    - Direct registration via Python code

    Example YAML:
    ```yaml
    hooks:
      PreToolUse:
        - handler: my_module.my_handler
      PostToolUse:
        - handler: logging_module.log_post_tool
      SessionStart:
        - handler: my_module.track_session
      SessionEnd:
        - handler: my_module.summarize_session
    ```

    Attributes:
        handlers: Mapping from EventType to lists of handler callables.
    """

    def __init__(self) -> None:
        self._handlers: Dict[EventType, List[Callable]] = {
            EventType.PRE_TOOL_USE: [],
            EventType.POST_TOOL_USE: [],
            EventType.SESSION_START: [],
            EventType.SESSION_END: [],
        }
        self._loaded_configs: List[Path] = []

    # --- Public API ---

    def register(
        self,
        event_type: EventType,
        handler: Callable,
    ) -> None:
        """Register a handler callable for an event type.

        Args:
            event_type: Which event type this handler responds to.
            handler: Callable that receives an Event instance.
        """
        if event_type not in self._handlers:
            raise ValueError(f"Unknown event type: {event_type}")
        if not callable(handler):
            raise TypeError(f"Handler must be callable, got {type(handler)}")
        self._handlers[event_type].append(handler)
        logger.debug("Registered handler %s for %s", handler, event_type.name)

    def unregister(
        self,
        event_type: EventType,
        handler: Callable,
    ) -> bool:
        """Unregister a previously registered handler.

        Args:
            event_type: The event type the handler was registered for.
            handler: The handler to remove.

        Returns:
            True if the handler was found and removed, False otherwise.
        """
        if event_type not in self._handlers:
            return False
        try:
            self._handlers[event_type].remove(handler)
            logger.debug("Unregistered handler %s from %s", handler, event_type.name)
            return True
        except ValueError:
            return False

    def list_handlers(self, event_type: EventType) -> List[Callable]:
        """Get all handlers registered for an event type.

        Args:
            event_type: The event type to query.

        Returns:
            List of handler callables.
        """
        if event_type not in self._handlers:
            return []
        return list(self._handlers[event_type])

    def get_event_types(self) -> List[EventType]:
        """Get all event types that have registered handlers.

        Returns:
            List of EventType values with at least one handler.
        """
        return [
            et for et, handlers in self._handlers.items() if handlers
        ]

    def clear(self, event_type: Optional[EventType] = None) -> None:
        """Clear registered handlers.

        Args:
            event_type: If provided, clear only this event type.
                        If None, clear all event types.
        """
        if event_type is None:
            for et in self._handlers:
                self._handlers[et] = []
        elif event_type in self._handlers:
            self._handlers[event_type] = []

    # --- YAML Config Loading ---

    @classmethod
    def from_yaml(
        cls,
        config_path: str | Path,
    ) -> HookRegistry:
        """Create a HookRegistry from a YAML config file.

        Args:
            config_path: Path to the YAML configuration file.

        Returns:
            A configured HookRegistry instance.

        Raises:
            FileNotFoundError: If the config file does not exist.
            ValueError: If the YAML has invalid structure.
        """
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {path}")

        with open(path, "r") as f:
            config = yaml.safe_load(f)

        if not isinstance(config, dict):
            raise ValueError("Config must be a YAML mapping")

        registry = cls()
        registry._load_from_dict(config)
        registry._loaded_configs.append(path)
        return registry

    def load_from_dict(self, config: Dict[str, Any]) -> None:
        """Load handlers from a dictionary (same format as YAML).

        Args:
            config: Configuration dictionary with 'hooks' key.
        """
        self._load_from_dict(config)

    def _load_from_dict(self, config: Dict[str, Any]) -> None:
        """Internal: load handlers from config dictionary."""
        hooks = config.get("hooks", {})
        if not isinstance(hooks, dict):
            raise ValueError("'hooks' must be a mapping")

        event_type_map = {
            "PreToolUse": EventType.PRE_TOOL_USE,
            "PostToolUse": EventType.POST_TOOL_USE,
            "SessionStart": EventType.SESSION_START,
            "SessionEnd": EventType.SESSION_END,
        }

        for event_name, handlers in hooks.items():
            event_type = event_type_map.get(event_name)
            if event_type is None:
                logger.warning("Unknown event type in config: %s", event_name)
                continue

            if not isinstance(handlers, list):
                handlers = [handlers]

            for handler_spec in handlers:
                if isinstance(handler_spec, str):
                    handler = self._resolve_handler(handler_spec)
                elif isinstance(handler_spec, dict):
                    handler_path = handler_spec.get("handler", "")
                    handler = self._resolve_handler(handler_path)
                else:
                    logger.warning(
                        "Invalid handler spec: %s, skipping", handler_spec
                    )
                    continue

                if handler is not None:
                    self.register(event_type, handler)

    def _resolve_handler(self, handler_path: str) -> Callable | None:
        """Resolve a dotted path string to a callable.

        Args:
            handler_path: Dotted path like 'module.submodule.function'.

        Returns:
            The resolved callable, or None if resolution failed.
        """
        try:
            parts = handler_path.rsplit(".", 1)
            if len(parts) != 2:
                logger.error("Invalid handler path: %s", handler_path)
                return None

            module_name, func_name = parts
            module = importlib.import_module(module_name)
            handler = getattr(module, func_name, None)

            if handler is None:
                logger.error(
                    "Handler function not found: %s in %s",
                    func_name,
                    module_name,
                )
                return None

            if not callable(handler):
                logger.error(
                    "Handler is not callable: %s", handler_path
                )
                return None

            return handler

        except ImportError as e:
            logger.error("Failed to import handler %s: %s", handler_path, e)
            return None
        except Exception as e:
            logger.error(
                "Failed to resolve handler %s: %s", handler_path, e
            )
            return None

    def __repr__(self) -> str:
        counts = {et.name: len(h) for et, h in self._handlers.items()}
        return f"HookRegistry({counts})"
