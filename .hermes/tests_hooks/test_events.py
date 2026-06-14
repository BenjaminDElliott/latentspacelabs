"""Tests for event types and creation."""

import pytest

from hermes_hooks.events import (
    Event,
    PreToolUse,
    PostToolUse,
    SessionStart,
    SessionEnd,
    EventType,
)


class TestEventType:
    def test_all_event_types_exist(self):
        """All four event types must be defined."""
        assert hasattr(EventType, "PRE_TOOL_USE")
        assert hasattr(EventType, "POST_TOOL_USE")
        assert hasattr(EventType, "SESSION_START")
        assert hasattr(EventType, "SESSION_END")

    def test_event_types_are_unique(self):
        """Each event type must have a unique value."""
        types = [
            EventType.PRE_TOOL_USE,
            EventType.POST_TOOL_USE,
            EventType.SESSION_START,
            EventType.SESSION_END,
        ]
        assert len(set(types)) == 4


class TestBaseEvent:
    def test_event_has_timestamp(self):
        """Events must carry a timestamp."""
        event = Event(event_type=EventType.SESSION_START)
        import time
        assert abs(event.timestamp - time.time()) < 1.0

    def test_event_defaults_metadata_to_empty_dict(self):
        """Events start with empty metadata."""
        event = Event(event_type=EventType.SESSION_START)
        assert event.metadata == {}

    def test_event_get_returns_metadata(self):
        """get() retrieves metadata values."""
        event = Event(event_type=EventType.SESSION_START, metadata={"key": "value"})
        assert event.get("key") == "value"

    def test_event_get_returns_default_for_missing_key(self):
        """get() returns default when key is absent."""
        event = Event(event_type=EventType.SESSION_START)
        assert event.get("missing", "default") == "default"

    def test_event_is_frozen(self):
        """Events must be immutable (frozen dataclass)."""
        event = Event(event_type=EventType.SESSION_START)
        try:
            event.metadata["key"] = "value"
            assert False, "Event should be frozen"
        except Exception:
            pass  # Expected


class TestPreToolUse:
    def test_pre_tool_use_has_correct_type(self):
        """PreToolUse must have EventType.PRE_TOOL_USE."""
        event = PreToolUse(tool_name="terminal")
        assert event.event_type == EventType.PRE_TOOL_USE

    def test_pre_tool_use_stores_tool_name(self):
        """PreToolUse must store the tool name."""
        event = PreToolUse(tool_name="mcp_linear_get_issue")
        assert event.tool_name == "mcp_linear_get_issue"

    def test_pre_tool_use_stores_params(self):
        """PreToolUse must store parameters."""
        event = PreToolUse(tool_name="terminal", params={"command": "ls"})
        assert event.params == {"command": "ls"}

    def test_pre_tool_use_defaults_params_empty(self):
        """PreToolUse params default to empty dict."""
        event = PreToolUse(tool_name="terminal")
        assert event.params == {}

    def test_pre_tool_use_stores_context(self):
        """PreToolUse can carry context."""
        ctx = {"session_id": "abc123"}
        event = PreToolUse(tool_name="terminal", tool_context=ctx)
        assert event.tool_context == ctx

    def test_pre_tool_use_is_immutable(self):
        """PreToolUse must be immutable."""
        event = PreToolUse(tool_name="terminal")
        with pytest.raises(Exception):
            event.tool_name = "other"


class TestPostToolUse:
    def test_post_tool_use_has_correct_type(self):
        """PostToolUse must have EventType.POST_TOOL_USE."""
        event = PostToolUse(tool_name="terminal")
        assert event.event_type == EventType.POST_TOOL_USE

    def test_post_tool_use_stores_result(self):
        """PostToolUse must store the result."""
        event = PostToolUse(tool_name="terminal", result="success")
        assert event.result == "success"

    def test_post_tool_use_stores_error(self):
        """PostToolUse must store error message if present."""
        event = PostToolUse(tool_name="terminal", error="Command failed")
        assert event.error == "Command failed"

    def test_post_tool_use_stores_duration(self):
        """PostToolUse must track execution duration."""
        event = PostToolUse(tool_name="terminal", duration_ms=15.5)
        assert event.duration_ms == 15.5

    def test_post_tool_use_defaults_duration(self):
        """PostToolUse duration defaults to 0."""
        event = PostToolUse(tool_name="terminal")
        assert event.duration_ms == 0.0

    def test_post_tool_use_none_result_ok(self):
        """PostToolUse allows None result."""
        event = PostToolUse(tool_name="terminal", result=None)
        assert event.result is None


class TestSessionStart:
    def test_session_start_has_correct_type(self):
        """SessionStart must have EventType.SESSION_START."""
        event = SessionStart()
        assert event.event_type == EventType.SESSION_START

    def test_session_start_stores_id(self):
        """SessionStart must store session_id."""
        event = SessionStart(session_id="sess-001")
        assert event.session_id == "sess-001"

    def test_session_start_stores_user(self):
        """SessionStart must store user."""
        event = SessionStart(user="alice")
        assert event.user == "alice"

    def test_session_start_defaults(self):
        """SessionStart fields default to empty."""
        event = SessionStart()
        assert event.session_id == ""
        assert event.user == ""


class TestSessionEnd:
    def test_session_end_has_correct_type(self):
        """SessionEnd must have EventType.SESSION_END."""
        event = SessionEnd()
        assert event.event_type == EventType.SESSION_END

    def test_session_end_stores_id(self):
        """SessionEnd must store session_id."""
        event = SessionEnd(session_id="sess-001")
        assert event.session_id == "sess-001"

    def test_session_end_stores_duration(self):
        """SessionEnd must track total duration."""
        event = SessionEnd(duration_ms=30000.0)
        assert event.duration_ms == 30000.0

    def test_session_end_stores_tool_count(self):
        """SessionEnd must track tool invocation count."""
        event = SessionEnd(tool_invocations=42)
        assert event.tool_invocations == 42

    def test_session_end_defaults(self):
        """SessionEnd fields default to zero/empty."""
        event = SessionEnd()
        assert event.session_id == ""
        assert event.duration_ms == 0.0
        assert event.tool_invocations == 0
