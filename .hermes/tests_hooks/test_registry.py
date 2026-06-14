"""Tests for the Hook Registry."""

import tempfile
import os
from unittest.mock import Mock

import pytest
import yaml

from hermes_hooks.events import EventType
from hermes_hooks.registry import HookRegistry


class TestHookRegistryBasics:
    def test_empty_registry(self):
        """New registry has no handlers."""
        registry = HookRegistry()
        assert registry.get_event_types() == []

    def test_register_and_list_handlers(self):
        """Registering a handler makes it visible via list_handlers."""
        registry = HookRegistry()
        handler = Mock()
        registry.register(EventType.PRE_TOOL_USE, handler)
        handlers = registry.list_handlers(EventType.PRE_TOOL_USE)
        assert len(handlers) == 1
        assert handlers[0] is handler

    def test_register_multiple_handlers(self):
        """Multiple handlers can be registered for the same event type."""
        registry = HookRegistry()
        h1 = Mock()
        h2 = Mock()
        registry.register(EventType.PRE_TOOL_USE, h1)
        registry.register(EventType.PRE_TOOL_USE, h2)
        handlers = registry.list_handlers(EventType.PRE_TOOL_USE)
        assert len(handlers) == 2
        assert h1 in handlers
        assert h2 in handlers

    def test_register_wrong_event_type_raises(self):
        """Registering for an unknown event type raises ValueError."""
        registry = HookRegistry()
        from enum import Enum, auto
        class FakeType(Enum):
            FAKE = auto()
        with pytest.raises(ValueError):
            registry.register(FakeType.FAKE, Mock())
        # Also test via a subclass trick
        handler = Mock()
        registry.register(EventType.SESSION_END, handler)
        assert len(registry.list_handlers(EventType.SESSION_END)) == 1

    def test_register_non_callable_raises(self):
        """Registering a non-callable raises TypeError."""
        registry = HookRegistry()
        with pytest.raises(TypeError):
            registry.register(EventType.PRE_TOOL_USE, "not_a_function")

    def test_unregister(self):
        """Unregistering removes a handler."""
        registry = HookRegistry()
        handler = Mock()
        registry.register(EventType.PRE_TOOL_USE, handler)
        assert registry.unregister(EventType.PRE_TOOL_USE, handler) is True
        assert registry.list_handlers(EventType.PRE_TOOL_USE) == []

    def test_unregister_missing_handler(self):
        """Unregistering an unknown handler returns False."""
        registry = HookRegistry()
        handler = Mock()
        assert registry.unregister(EventType.PRE_TOOL_USE, handler) is False

    def test_clear_all(self):
        """Clear without args removes all handlers."""
        registry = HookRegistry()
        h1, h2 = Mock(), Mock()
        registry.register(EventType.PRE_TOOL_USE, h1)
        registry.register(EventType.SESSION_START, h2)
        registry.clear()
        assert registry.get_event_types() == []

    def test_clear_specific_event_type(self):
        """Clear with event type removes only that type."""
        registry = HookRegistry()
        h1, h2 = Mock(), Mock()
        registry.register(EventType.PRE_TOOL_USE, h1)
        registry.register(EventType.SESSION_START, h2)
        registry.clear(EventType.PRE_TOOL_USE)
        assert registry.list_handlers(EventType.PRE_TOOL_USE) == []
        assert len(registry.list_handlers(EventType.SESSION_START)) == 1

    def test_get_event_types_returns_only_types_with_handlers(self):
        """get_event_types() only returns types that have handlers."""
        registry = HookRegistry()
        registry.register(EventType.PRE_TOOL_USE, Mock())
        event_types = registry.get_event_types()
        assert EventType.PRE_TOOL_USE in event_types
        assert EventType.SESSION_END not in event_types

    def test_repr_shows_handler_counts(self):
        """__repr__ shows handler counts."""
        registry = HookRegistry()
        registry.register(EventType.PRE_TOOL_USE, Mock())
        r = repr(registry)
        assert "PRE_TOOL_USE" in r


class TestYAMLConfigLoading:
    def test_load_from_file(self):
        """Registry can be loaded from a YAML file."""
        yaml_content = {
            "hooks": {
                "PreToolUse": [
                    {"handler": "tests.test_registry.mock_pre_handler"},
                ],
            }
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            yaml.dump(yaml_content, f)
            f.flush()
            registry = HookRegistry.from_yaml(f.name)
        handlers = registry.list_handlers(EventType.PRE_TOOL_USE)
        assert len(handlers) == 1
        os.unlink(f.name)

    def test_load_from_dict(self):
        """Registry can be loaded from a Python dict."""
        config = {
            "hooks": {
                "SessionEnd": [
                    "tests.test_registry.mock_post_handler",
                ]
            }
        }
        registry = HookRegistry()
        registry.load_from_dict(config)
        handlers = registry.list_handlers(EventType.SESSION_END)
        assert len(handlers) == 1

    def test_load_from_file_invalid_raises(self):
        """Loading from a non-existent file raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            HookRegistry.from_yaml("/nonexistent/path/hooks.yaml")

    def test_load_from_file_invalid_yaml_raises(self):
        """Loading a non-mapping YAML raises ValueError."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            f.write("- list\n  - yaml\n")
            f.flush()
            with pytest.raises(ValueError):
                HookRegistry.from_yaml(f.name)
        os.unlink(f.name)

    def test_load_from_string_handler(self):
        """Config with string handler paths works."""
        config = {
            "hooks": {
                "PostToolUse": "tests.test_registry.mock_post_handler",
            }
        }
        registry = HookRegistry()
        registry.load_from_dict(config)
        handlers = registry.list_handlers(EventType.POST_TOOL_USE)
        assert len(handlers) == 1

    def test_load_from_dict_invalid_hooks_raises(self):
        """Config with non-mapping 'hooks' raises ValueError."""
        with pytest.raises(ValueError):
            HookRegistry().load_from_dict({"hooks": "not_a_dict"})


# --- Mock handlers for YAML loading tests ---

def mock_pre_handler(event):
    """Mock handler for PreToolUse events."""
    event.metadata["pre_handled"] = True


def mock_post_handler(event):
    """Mock handler for PostToolUse events."""
    event.metadata["post_handled"] = True
