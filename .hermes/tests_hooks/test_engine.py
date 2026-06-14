"""Tests for the Hook Engine - event firing, handler execution, error handling."""

import time
from unittest.mock import Mock

import pytest

from hermes_hooks.events import (
    Event,
    EventType,
    PreToolUse,
    PostToolUse,
    SessionStart,
    SessionEnd,
)
from hermes_hooks.registry import HookRegistry
from hermes_hooks.engine import HookEngine, HookError


class TestEventFiring:
    def test_fire_no_handlers(self):
        """Firing an event with no handlers returns success."""
        engine = HookEngine()
        event = SessionStart(session_id="test-1")
        result = engine.fire(event)
        assert result["success"] is True
        assert result["handlers_executed"] == 0
        assert result["errors"] == []

    def test_fire_single_handler(self):
        """Firing an event calls exactly one handler."""
        registry = HookRegistry()
        handler = Mock(return_value=None)
        registry.register(EventType.SESSION_START, handler)
        engine = HookEngine(registry)
        event = SessionStart(session_id="test-1")
        result = engine.fire(event)
        assert result["success"] is True
        handler.assert_called_once_with(event)
        assert result["handlers_executed"] == 1

    def test_fire_multiple_handlers(self):
        """Firing an event calls all registered handlers."""
        registry = HookRegistry()
        h1, h2 = Mock(), Mock()
        registry.register(EventType.SESSION_START, h1)
        registry.register(EventType.SESSION_START, h2)
        engine = HookEngine(registry)
        event = SessionStart(session_id="test-1")
        result = engine.fire(event)
        assert result["success"] is True
        assert h1.call_count == 1
        assert h2.call_count == 1
        assert result["handlers_executed"] == 2

    def test_fire_all_event_types(self):
        """All four event types can be fired."""
        registry = HookRegistry()
        handler = Mock()
        for et in [EventType.PRE_TOOL_USE, EventType.POST_TOOL_USE,
                   EventType.SESSION_START, EventType.SESSION_END]:
            registry.register(et, handler)

        engine = HookEngine(registry)
        event = PreToolUse(tool_name="terminal")
        result = engine.fire(event)
        assert result["success"] is True

        event = PostToolUse(tool_name="terminal", result="ok")
        result = engine.fire(event)
        assert result["success"] is True

        event = SessionStart(session_id="s1")
        result = engine.fire(event)
        assert result["success"] is True

        event = SessionEnd(session_id="s1")
        result = engine.fire(event)
        assert result["success"] is True

    def test_fire_passes_correct_event(self):
        """Handlers receive the exact event instance they were fired with."""
        registry = HookRegistry()
        captured = []
        def capture(event):
            captured.append(event)
        registry.register(EventType.SESSION_START, capture)
        engine = HookEngine(registry)
        event = SessionStart(session_id="unique-id-123")
        engine.fire(event)
        assert len(captured) == 1
        assert captured[0].session_id == "unique-id-123"


class TestHandlerExecution:
    def test_handler_receives_event(self):
        """A handler gets the event and can modify its metadata."""
        registry = HookRegistry()
        def handler(event):
            event.metadata["processed"] = True
        registry.register(EventType.PRE_TOOL_USE, handler)
        engine = HookEngine(registry)
        event = PreToolUse(tool_name="terminal")
        engine.fire(event)
        assert event.metadata.get("processed") is True

    def test_handler_result_returned(self):
        """Handler return values are captured in results."""
        registry = HookRegistry()
        def handler(event):
            return "handled"
        registry.register(EventType.PRE_TOOL_USE, handler)
        engine = HookEngine(registry)
        event = PreToolUse(tool_name="terminal")
        result = engine.fire(event)
        handler_name = handler.__name__
        assert result["handler_results"][handler_name]["result"] == "handled"

    def test_handler_duration_tracked(self):
        """Handler execution time is recorded."""
        registry = HookRegistry()
        def slow_handler(event):
            time.sleep(0.001)
        registry.register(EventType.SESSION_START, slow_handler)
        engine = HookEngine(registry)
        event = SessionStart()
        result = engine.fire(event)
        assert result["duration_ms"] >= 0  # Should be measurable

    def test_handler_can_be_async_style_callable(self):
        """Any callable works as a handler."""
        registry = HookRegistry()

        class CallableHandler:
            def __init__(self):
                self.called = False
            def __call__(self, event):
                self.called = True

        h = CallableHandler()
        registry.register(EventType.SESSION_END, h)
        engine = HookEngine(registry)
        engine.fire(SessionEnd())
        assert h.called is True


class TestErrorHandling:
    def test_handler_error_logged_mode(self):
        """When error_mode='log', errors don't propagate."""
        registry = HookRegistry()
        def failing_handler(event):
            raise ValueError("test error")
        registry.register(EventType.SESSION_START, failing_handler)
        engine = HookEngine(registry, error_mode="log")
        event = SessionStart()
        result = engine.fire(event)
        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert isinstance(result["errors"][0], HookError)

    def test_handler_error_raise_mode(self):
        """When error_mode='raise', HookError is raised."""
        registry = HookRegistry()
        def failing_handler(event):
            raise RuntimeError("fail")
        registry.register(EventType.SESSION_START, failing_handler)
        engine = HookEngine(registry, error_mode="raise")
        event = SessionStart()
        with pytest.raises(HookError) as exc_info:
            engine.fire(event)
        assert isinstance(exc_info.value.original_error, RuntimeError)
        assert exc_info.value.original_error.args[0] == "fail"

    def test_handler_error_skip_mode(self):
        """When error_mode='skip', errors are silently ignored."""
        registry = HookRegistry()
        def failing_handler(event):
            raise ValueError("fail")
        registry.register(EventType.SESSION_START, failing_handler)
        engine = HookEngine(registry, error_mode="skip")
        event = SessionStart()
        # With skip mode, we need to check if errors are collected but not raised
        result = engine.fire(event)
        assert len(result["errors"]) == 1

    def test_partial_handler_failure(self):
        """If one handler fails, others still execute."""
        registry = HookRegistry()
        h1, h2 = Mock(), Mock()
        def failing(event):
            raise ValueError("fail")
        registry.register(EventType.PRE_TOOL_USE, h1)
        registry.register(EventType.PRE_TOOL_USE, h2)
        registry.register(EventType.PRE_TOOL_USE, failing)
        engine = HookEngine(registry, error_mode="log")
        event = PreToolUse(tool_name="terminal")
        result = engine.fire(event)
        assert h1.call_count == 1
        assert h2.call_count == 1
        assert len(result["errors"]) == 1
        assert result["handlers_executed"] == 3

    def test_hook_error_contains_handler_info(self):
        """HookError includes handler reference and event."""
        registry = HookRegistry()
        def handler(event):
            raise KeyError("missing")
        registry.register(EventType.POST_TOOL_USE, handler)
        engine = HookEngine(registry, error_mode="raise")
        event = PostToolUse(tool_name="terminal")
        with pytest.raises(HookError) as exc_info:
            engine.fire(event)
        err = exc_info.value
        assert err.handler is handler
        assert err.event is event
        assert isinstance(err.original_error, KeyError)


class TestPerformance:
    def test_event_firing_under_100ms(self):
        """Hook execution must complete under 100ms per event."""
        registry = HookRegistry()
        def fast_handler(event):
            pass  # No-op
        # Register 5 handlers to simulate realistic load
        for _ in range(5):
            registry.register(EventType.SESSION_START, fast_handler)
        engine = HookEngine(registry)
        event = SessionStart(session_id="perf-test")
        result = engine.fire(event)
        assert result["duration_ms"] < 100.0, (
            f"Hook execution took {result['duration_ms']:.1f}ms, "
            f"exceeds 100ms limit"
        )

    def test_empty_event_firing_fast(self):
        """Firing with no handlers must be very fast."""
        engine = HookEngine()
        event = PreToolUse(tool_name="terminal")
        result = engine.fire(event)
        assert result["duration_ms"] < 10.0

    def test_single_handler_firing_under_100ms(self):
        """Single handler execution under 100ms."""
        registry = HookRegistry()
        def handler(event):
            time.sleep(0.05)  # 50ms - well under limit
        registry.register(EventType.SESSION_START, handler)
        engine = HookEngine(registry)
        event = SessionStart(session_id="perf-1")
        result = engine.fire(event)
        assert result["duration_ms"] < 100.0


class TestExecutionHistory:
    def test_history_records_fired_events(self):
        """Each fired event is recorded in history."""
        engine = HookEngine()
        engine.fire(SessionStart(session_id="s1"))
        engine.fire(PreToolUse(tool_name="terminal"))
        history = engine.get_execution_history()
        assert len(history) == 2

    def test_history_records_event_type(self):
        """History entries include event type name."""
        engine = HookEngine()
        engine.fire(SessionEnd(session_id="s1"))
        history = engine.get_execution_history()
        assert history[0]["event_type"] == "SESSION_END"

    def test_clear_history(self):
        """clear_history() empties the history."""
        engine = HookEngine()
        engine.fire(SessionStart(session_id="s1"))
        engine.clear_history()
        assert len(engine.get_execution_history()) == 0
