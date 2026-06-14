"""Tests for the retry decorator with exponential backoff.

TDD approach — tests define the contract:
1. @retry(max_attempts=5, base_delay=1.0) decorator
2. Exponential backoff: 1s → 2s → 4s → 8s → 16s (doubling each attempt)
3. Error classification: network → transient, parse → permanent
4. Retries transient errors, logs permanent errors immediately (no retries)
5. Mock failure scenarios and backoff timing verification
"""

import sys
import time
import unittest
from unittest.mock import patch, MagicMock
import logging

# Ensure ~/.hermes/cron is on the path so we can import retry_decorator
sys.path.insert(0, "/root/.hermes/cron")

from retry_decorator import (
    retry,
    classify_error,
    TransientError,
    PermanentError,
    NetworkError,
    ParseError,
    RetryExhaustedError,
)

# Use a fixed base_delay for tests so timing is predictable
BASE_DELAY = 0.01  # 10ms instead of 1s to keep tests fast


class TestClassifyError(unittest.TestCase):
    """Tests for error classification logic."""

    def test_network_error_is_transient(self):
        """Network-related errors should be classified as transient."""
        exc = NetworkError("connection refused")
        self.assertEqual(classify_error(exc), "transient")

    def test_parse_error_is_permanent(self):
        """Parse errors should be classified as permanent."""
        exc = ParseError("invalid JSON")
        self.assertEqual(classify_error(exc), "permanent")

    def test_generic_network_error_is_transient(self):
        """Generic exceptions with network-related messages are transient."""
        exc = ConnectionError("timed out")
        self.assertEqual(classify_error(exc), "transient")

    def test_generic_network_error_is_transient_v2(self):
        exc = TimeoutError("connection timed out")
        self.assertEqual(classify_error(exc), "transient")

    def test_generic_network_error_is_transient_v3(self):
        exc = OSError("network unreachable")
        self.assertEqual(classify_error(exc), "transient")

    def test_unknown_error_is_transient_default(self):
        """Unknown error types default to transient (conservative)."""
        exc = ValueError("something else")
        self.assertEqual(classify_error(exc), "transient")

    def test_transient_error_class_is_transient(self):
        """Explicit TransientError instances are transient."""
        exc = TransientError("boom")
        self.assertEqual(classify_error(exc), "transient")

    def test_permanent_error_class_is_permanent(self):
        """Explicit PermanentError instances are permanent."""
        exc = PermanentError("boom")
        self.assertEqual(classify_error(exc), "permanent")


class TestRetryDecorator(unittest.TestCase):
    """Tests for the @retry decorator."""

    def test_succeeds_on_first_attempt(self):
        """If the function succeeds, no retries happen."""
        call_count = 0

        @retry(max_attempts=5, base_delay=0.01)
        def good_func():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = good_func()
        self.assertEqual(result, "ok")
        self.assertEqual(call_count, 1)

    def test_retries_transient_errors(self):
        """Transient errors should be retried up to max_attempts."""
        call_count = 0

        @retry(max_attempts=3, base_delay=0.01)
        def flaky_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise NetworkError("connection refused")
            return "ok"

        result = flaky_func()
        self.assertEqual(result, "ok")
        self.assertEqual(call_count, 3)

    def test_retries_all_transient_attempts_then_fails(self):
        """If transient errors exhaust max_attempts, raise RetryExhaustedError."""
        call_count = 0

        @retry(max_attempts=3, base_delay=0.01)
        def always_fail():
            nonlocal call_count
            call_count += 1
            raise NetworkError("always down")

        with self.assertRaises(RetryExhaustedError) as ctx:
            always_fail()
        self.assertEqual(call_count, 3)
        self.assertIn("always down", str(ctx.exception))

    def test_permanent_error_no_retry(self):
        """Permanent errors should not be retried — raised immediately."""
        call_count = 0

        @retry(max_attempts=5, base_delay=0.01)
        def parse_func():
            nonlocal call_count
            call_count += 1
            raise ParseError("bad json")

        with self.assertRaises(ParseError):
            parse_func()
        self.assertEqual(call_count, 1)  # only one attempt

    def test_custom_max_attempts(self):
        """Respects the max_attempts parameter."""
        call_count = 0

        @retry(max_attempts=2, base_delay=0.01)
        def fail_twice():
            nonlocal call_count
            call_count += 1
            raise NetworkError("boom")

        with self.assertRaises(RetryExhaustedError):
            fail_twice()
        self.assertEqual(call_count, 2)

    def test_custom_base_delay(self):
        """Respects the base_delay parameter."""
        delays = []
        original_sleep = time.sleep

        def mock_sleep(duration):
            delays.append(duration)

        @retry(max_attempts=3, base_delay=0.5)
        def flaky():
            raise NetworkError("down")

        with patch("time.sleep", mock_sleep):
            with self.assertRaises(RetryExhaustedError):
                flaky()

        # Delays should be base_delay * 2^0, base_delay * 2^1 = 0.5, 1.0
        self.assertEqual(len(delays), 2)
        self.assertAlmostEqual(delays[0], 0.5)
        self.assertAlmostEqual(delays[1], 1.0)

    def test_backoff_timing_doubling(self):
        """Verify exponential doubling: delay = base_delay * 2^(attempt-1)."""
        delays = []

        def mock_sleep(duration):
            delays.append(duration)

        @retry(max_attempts=5, base_delay=1.0)
        def flaky():
            raise NetworkError("down")

        with patch("time.sleep", mock_sleep):
            with self.assertRaises(RetryExhaustedError):
                flaky()

        expected = [1.0, 2.0, 4.0, 8.0]
        self.assertEqual(len(delays), 4)
        for i, expected_delay in enumerate(expected):
            self.assertAlmostEqual(delays[i], expected_delay, places=5,
                                   msg=f"Attempt {i}: expected {expected_delay}s, got {delays[i]}s")

    def test_logging_on_each_attempt(self):
        """Each retry attempt should be logged."""
        import logging as logging_module

        # Capture log output
        logs = []

        class LogCapture(logging_module.Handler):
            def emit(self, record):
                logs.append(record.getMessage())

        handler = LogCapture()
        handler.setLevel(logging_module.DEBUG)
        logger = logging_module.getLogger("retry_decorator")
        logger.addHandler(handler)
        logger.setLevel(logging_module.DEBUG)

        try:
            @retry(max_attempts=3, base_delay=0.01)
            def flaky():
                raise NetworkError("down")

            with self.assertRaises(RetryExhaustedError):
                flaky()

            # Should have log entries for retries
            retry_logs = [l for l in logs if "Retry" in l]
            self.assertGreater(len(retry_logs), 0,
                               "Expected retry log entries but got none")
        finally:
            logger.removeHandler(handler)

    def test_logging_permanent_error(self):
        """Permanent errors should be logged immediately without retry."""
        logs = []

        class LogCapture(logging.Handler):
            def emit(self, record):
                logs.append(record.getMessage())

        handler = LogCapture()
        handler.setLevel(logging.DEBUG)
        logger = logging.getLogger("retry_decorator")
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)

        try:
            call_count = 0

            @retry(max_attempts=5, base_delay=0.01)
            def parse_func():
                nonlocal call_count
                call_count += 1
                raise ParseError("bad json")

            with self.assertRaises(ParseError):
                parse_func()

            # Should log the permanent error
            permanent_logs = [l for l in logs if "permanent" in l.lower()]
            self.assertGreater(len(permanent_logs), 0,
                               "Expected permanent error log entry")
            self.assertEqual(call_count, 1)
        finally:
            logger.removeHandler(handler)


class TestRetryExhaustedError(unittest.TestCase):
    """Tests for the RetryExhaustedError exception."""

    def test_inherits_from_exception(self):
        """RetryExhaustedError should be a proper Exception subclass."""
        self.assertTrue(issubclass(RetryExhaustedError, Exception))

    def test_contains_inner_exception_message(self):
        """Should carry the message of the last failed attempt."""
        exc = RetryExhaustedError(NetworkError("connection refused"), max_attempts=3)
        self.assertIn("connection refused", str(exc))

    def test_contains_max_attempts_info(self):
        """Should include the max_attempts value in its message."""
        exc = RetryExhaustedError(NetworkError("down"), max_attempts=5)
        self.assertIn("5", str(exc))


if __name__ == "__main__":
    unittest.main()
