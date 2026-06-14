"""Tests for TokenMonitor."""

import pytest
import time
from packages.context_engine.token_monitor import TokenMonitor, TokenUsageSnapshot, TokenMonitorEvent


class TestTokenEstimation:
    """Test the token estimation function."""

    def test_empty_string(self):
        assert TokenMonitor.estimate_tokens("") == 0
        assert TokenMonitor.estimate_tokens(None) == 0

    def test_short_text(self):
        # "Hello world" = 11 chars => ~2-3 tokens
        tokens = TokenMonitor.estimate_tokens("Hello world")
        assert tokens >= 1
        assert tokens <= 10

    def test_consistent_ratio(self):
        """Token count should scale linearly with text length."""
        text_100 = "a" * 100
        text_200 = "a" * 200
        est_100 = TokenMonitor.estimate_tokens(text_100)
        est_200 = TokenMonitor.estimate_tokens(text_200)
        assert est_200 == est_100 * 2

    def test_approximate_ratio(self):
        """Tokens should be approximately chars / 4."""
        text = "x" * 400
        tokens = TokenMonitor.estimate_tokens(text)
        expected = int(400 * 0.25)  # = 100
        assert tokens == expected


class TestTokenMonitorBasic:
    """Basic TokenMonitor functionality."""

    def test_init_default_budget(self):
        monitor = TokenMonitor()
        assert monitor.token_budget == 128_000
        assert monitor.warning_threshold == 0.70
        assert monitor.critical_threshold == 0.90

    def test_init_custom_thresholds(self):
        monitor = TokenMonitor(token_budget=50_000, warning_threshold=0.50)
        assert monitor.token_budget == 50_000
        assert monitor.warning_threshold == 0.50

    def test_initial_snapshot(self):
        monitor = TokenMonitor(token_budget=1000)
        snap = monitor.get_snapshot()
        assert snap.total_tokens == 0
        assert snap.session_tokens == 0
        assert snap.budget_tokens == 1000
        assert snap.usage_percent == 0.0
        assert snap.turn_count == 0
        assert snap.remaining_tokens == 1000
        assert snap.remaining_percent == 100.0
        assert not snap.threshold_exceeded

    def test_record_turn(self):
        monitor = TokenMonitor(token_budget=1000)
        event = monitor.record_turn(300)
        snap = monitor.get_snapshot()
        assert snap.session_tokens == 300
        assert snap.usage_percent == 30.0
        assert event is None  # below warning threshold

    def test_record_context(self):
        monitor = TokenMonitor(token_budget=1000)
        tokens = monitor.record_context("Hello world" * 100)
        assert tokens > 0
        snap = monitor.get_snapshot()
        assert snap.session_tokens == tokens


class TestThresholdTriggering:
    """Test threshold warning/critical/exceeded events."""

    def test_warning_at_70_percent(self):
        monitor = TokenMonitor(token_budget=1000)
        # Record 700 tokens => 70%
        event = monitor.record_turn(700)
        assert event is not None
        assert event.event_type == "threshold_warning"
        assert event.usage_percent >= 70.0

    def test_no_duplicate_warning_event(self):
        monitor = TokenMonitor(token_budget=1000)
        event1 = monitor.record_turn(700)
        assert event1 is not None
        assert event1.event_type == "threshold_warning"

        event2 = monitor.record_turn(100)
        assert event2 is None  # no duplicate warning

    def test_critical_at_90_percent(self):
        monitor = TokenMonitor(token_budget=1000)
        monitor.record_turn(700)  # trigger warning
        event = monitor.record_turn(200)
        assert event is not None
        assert event.event_type == "threshold_critical"
        assert event.usage_percent >= 90.0

    def test_no_duplicate_critical_event(self):
        monitor = TokenMonitor(token_budget=1000)
        monitor.record_turn(900)
        event = monitor.record_turn(100)
        assert event is not None
        assert event.event_type == "threshold_critical"

        event2 = monitor.record_turn(100)
        assert event2 is None  # no duplicate critical

    def test_budget_exceeded(self):
        monitor = TokenMonitor(token_budget=1000)
        monitor.record_turn(950)
        event = monitor.record_turn(100)
        assert event is not None
        assert event.event_type == "budget_exceeded"

    def test_events_in_order(self):
        """Events should fire in order: warning → critical → exceeded."""
        monitor = TokenMonitor(token_budget=1000)
        events = []
        monitor.on_warning = lambda e: events.append("warning")
        monitor.on_critical = lambda e: events.append("critical")
        monitor.on_exceeded = lambda e: events.append("exceeded")

        monitor.record_turn(400)
        assert events == []

        monitor.record_turn(300)  # 70% - warning
        assert events == ["warning"]

        monitor.record_turn(200)  # 90% - critical
        assert events == ["warning", "critical"]

        monitor.record_turn(100)  # 100% - exceeded
        assert events == ["warning", "critical", "exceeded"]


class TestTurnTracking:
    """Test start_turn / end_turn workflow."""

    def test_start_end_turn(self):
        monitor = TokenMonitor(token_budget=1000)
        monitor.start_turn()
        monitor.record_context("test data")
        count = monitor.end_turn()
        assert count > 0
        snap = monitor.get_snapshot()
        assert snap.session_tokens == count
        assert snap.turn_count == 1

    def test_multiple_turns(self):
        monitor = TokenMonitor(token_budget=1000)
        for i in range(5):
            monitor.start_turn()
            monitor.record_context(f"turn {i} data")
            monitor.end_turn()
        snap = monitor.get_snapshot()
        assert snap.turn_count == 5
        assert snap.session_tokens > 0


class TestHelperProperties:
    """Test convenience properties."""

    def test_is_threshold_exceeded(self):
        monitor = TokenMonitor(token_budget=1000)
        assert not monitor.is_threshold_exceeded
        monitor.record_turn(701)
        assert monitor.is_threshold_exceeded

    def test_usage_percent(self):
        monitor = TokenMonitor(token_budget=1000)
        assert monitor.usage_percent == 0.0
        monitor.record_turn(500)
        assert monitor.usage_percent == 50.0

    def test_tokens_remaining(self):
        monitor = TokenMonitor(token_budget=1000)
        assert monitor.tokens_remaining == 1000
        monitor.record_turn(500)
        assert monitor.tokens_remaining == 500

    def test_reset(self):
        monitor = TokenMonitor(token_budget=1000)
        monitor.record_turn(500)
        assert monitor.get_snapshot().session_tokens == 500
        monitor.reset()
        snap = monitor.get_snapshot()
        assert snap.session_tokens == 0
        assert snap.turn_count == 0
        # Thresholds should be reset too
        monitor.record_turn(400)
        assert not monitor.is_threshold_exceeded

    def test_repr(self):
        monitor = TokenMonitor(token_budget=1000)
        r = repr(monitor)
        assert "TokenMonitor" in r
        assert "budget=1000" in r


class TestThreadSafety:
    """Test concurrent access safety."""

    def test_concurrent_records(self):
        import threading
        monitor = TokenMonitor(token_budget=1_000_000)
        errors = []

        def record_tokens(n):
            try:
                for _ in range(n):
                    monitor.record_turn(1)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=record_tokens, args=(100,)) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert monitor.get_snapshot().session_tokens == 1000

    def test_concurrent_snapshot_and_record(self):
        import threading
        monitor = TokenMonitor(token_budget=1_000_000)
        errors = []

        def record():
            try:
                for _ in range(50):
                    monitor.record_turn(1)
            except Exception as e:
                errors.append(e)

        def snapshot():
            try:
                for _ in range(50):
                    monitor.get_snapshot()
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=record),
            threading.Thread(target=snapshot),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
