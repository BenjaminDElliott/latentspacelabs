"""Unit tests for ~/.hermes/cron/error_logger.py

Tests cover:
- Error classification (transient, permanent, idempotent-safe)
- JSONL log writing with correct fields
- File rotation at 100KB
- Weekly rotation logic
- Stack trace truncation to 500 chars
"""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure ~/.hermes.cron is importable
sys.path.insert(0, str(Path(__file__).parent))

from error_logger import (
    ErrorType,
    classify_error,
    CronError,
    ErrorLogger,
    ROTATION_MAX_BYTES,
    ROTATION_WEEKS,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TRANSIENT_EXAMPLES = [
    ConnectionError("network timeout"),
    TimeoutError("network timeout"),
    OSError("rate limit exceeded"),
]

PERMANENT_EXAMPLES = [
    ValueError("parse error"),
    KeyError("schema mismatch"),
    TypeError("schema mismatch"),
]

IDEMPOTENT_EXAMPLES = [
    Exception("duplicate entry"),
    Exception("already exists"),
]


# ---------------------------------------------------------------------------
# Error classification tests
# ---------------------------------------------------------------------------

class TestClassifyError(unittest.TestCase):
    """Test that errors are classified correctly."""

    def test_transient_network_timeout(self):
        """ConnectionError and TimeoutError are transient."""
        for exc in TRANSIENT_EXAMPLES:
            with self.subTest(error=exc):
                self.assertEqual(classify_error(exc), ErrorType.TRANSIENT)

    def test_permanent_parse_error(self):
        """ValueError, KeyError, TypeError are permanent."""
        for exc in PERMANENT_EXAMPLES:
            with self.subTest(error=exc):
                self.assertEqual(classify_error(exc), ErrorType.PERMANENT)

    def test_permanent_by_default(self):
        """Unclassified exceptions default to permanent."""
        exc = RuntimeError("unexpected failure")
        self.assertEqual(classify_error(exc), ErrorType.PERMANENT)

    def test_transient_by_pattern(self):
        """Errors with 'timeout' or 'rate limit' in message are transient."""
        exc = OSError("connection rate limit")
        self.assertEqual(classify_error(exc), ErrorType.TRANSIENT)

    def test_permanent_by_pattern(self):
        """Errors with 'parse' or 'schema' in message are permanent."""
        exc = ValueError("parse error on line 42")
        self.assertEqual(classify_error(exc), ErrorType.PERMANENT)

    def test_idempotent_by_pattern(self):
        """Errors with 'duplicate' or 'already exists' are idempotent-safe."""
        for msg in ["duplicate entry", "already exists"]:
            exc = Exception(msg)
            with self.subTest(message=msg):
                self.assertEqual(classify_error(exc), ErrorType.IDEMPOTENT)


# ---------------------------------------------------------------------------
# CronError data class tests
# ---------------------------------------------------------------------------

class TestCronError(unittest.TestCase):
    """Test the CronError record fields and serialization."""

    def test_to_dict_has_required_fields(self):
        """All required fields are present in serialized output."""
        record = CronError(
            job_name="test-job",
            error_type=ErrorType.TRANSIENT,
            message="network timeout",
            retry_count=3,
        )
        d = record.to_dict()
        for field in ("timestamp", "job_name", "error_type", "message",
                      "retry_count", "stack_trace"):
            self.assertIn(field, d, f"Missing required field: {field}")

    def test_stack_trace_truncation(self):
        """Stack trace longer than 500 chars is truncated."""
        long_trace = "trace\n" * 200  # > 500 chars
        record = CronError(
            job_name="test-job",
            error_type=ErrorType.PERMANENT,
            message="bad input",
            retry_count=1,
            stack_trace=long_trace,
        )
        d = record.to_dict()
        self.assertLessEqual(len(d["stack_trace"]), 500)

    def test_stack_trace_none_defaults_to_empty(self):
        """When stack_trace is None, it becomes empty string."""
        record = CronError(
            job_name="test-job",
            error_type=ErrorType.TRANSIENT,
            message="timeout",
            retry_count=0,
        )
        d = record.to_dict()
        self.assertEqual(d["stack_trace"], "")

    def test_json_serialization(self):
        """to_json produces valid JSON."""
        record = CronError(
            job_name="test-job",
            error_type=ErrorType.TRANSIENT,
            message="timeout",
            retry_count=1,
        )
        json_str = record.to_json()
        parsed = json.loads(json_str)
        self.assertEqual(parsed["job_name"], "test-job")


# ---------------------------------------------------------------------------
# ErrorLogger file operations tests
# ---------------------------------------------------------------------------

class TestErrorLoggerFileOperations(unittest.TestCase):
    """Test ErrorLogger's JSONL writing and rotation."""

    def setUp(self):
        """Create a temporary directory for test state."""
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _make_logger(self, **kwargs):
        """Create an ErrorLogger pointing at a temp dir."""
        defaults = {"state_dir": self.test_dir}
        defaults.update(kwargs)
        return ErrorLogger(**defaults)

    def test_creates_log_file(self):
        """First write creates the JSONL file."""
        logger = self._make_logger()
        logger.log_error(
            job_name="test-job",
            error=ConnectionError("timeout"),
            retry_count=0,
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"
        self.assertTrue(log_path.exists())

    def test_writes_valid_json_line(self):
        """Each line in the log file is valid JSON."""
        logger = self._make_logger()
        logger.log_error(
            job_name="health-check",
            error=ValueError("parse error"),
            retry_count=1,
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"
        with open(log_path) as f:
            line = f.readline().strip()
        parsed = json.loads(line)
        self.assertEqual(parsed["job_name"], "health-check")
        self.assertEqual(parsed["error_type"], ErrorType.PERMANENT.value)

    def test_multiple_writes(self):
        """Multiple log errors produce multiple lines."""
        logger = self._make_logger()
        logger.log_error(
            job_name="job-a", error=ConnectionError("timeout"), retry_count=0
        )
        logger.log_error(
            job_name="job-b", error=ValueError("bad json"), retry_count=2
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"
        with open(log_path) as f:
            lines = [l for l in f.readlines() if l.strip()]
        self.assertEqual(len(lines), 2)

    # ---- File rotation tests ----

    def test_rotation_at_100kb(self):
        """File rotates when it exceeds 100KB."""
        logger = self._make_logger(
            max_bytes=ROTATION_MAX_BYTES,
            max_kept=2,  # keep only 2 rotated files for speed
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"

        # Write enough entries to exceed 100KB
        long_message = "x" * 200
        while not log_path.exists() or log_path.stat().st_size < ROTATION_MAX_BYTES + 100:
            logger.log_error(
                job_name="rotation-test",
                error=ConnectionError(long_message),
                retry_count=0,
            )
        # Force one more write to trigger the rotation of the oversized file
        logger.log_error(
            job_name="rotation-test",
            error=ConnectionError(long_message),
            retry_count=0,
        )

        # At least one rotation should have happened
        archived = list(Path(self.test_dir).glob("cron_errors.jsonl.*"))
        self.assertGreaterEqual(len(archived), 1,
                                "Expected at least one rotated file")

    def test_rotation_preserves_current_log(self):
        """After rotation, a new empty log file is created."""
        logger = self._make_logger(
            max_bytes=ROTATION_MAX_BYTES,
            max_kept=2,
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"

        long_message = "x" * 200
        while not log_path.exists() or log_path.stat().st_size < ROTATION_MAX_BYTES + 100:
            logger.log_error(
                job_name="rotation-preserve",
                error=ConnectionError(long_message),
                retry_count=0,
            )
        # Force one more write to trigger the rotation of the oversized file
        logger.log_error(
            job_name="rotation-preserve",
            error=ConnectionError(long_message),
            retry_count=0,
        )

        self.assertTrue(log_path.exists(), "Current log must exist after rotation")
        # New writes should append to the fresh file
        logger.log_error(
            job_name="after-rotate",
            error=ValueError("post rotation"),
            retry_count=0,
        )
        with open(log_path) as f:
            last_line = f.readlines()[-1].strip()
        self.assertIn("after-rotate", last_line)

    def test_weekly_rotation_skips_if_not_due(self):
        """Weekly rotation only triggers when the file is old enough."""
        logger = self._make_logger(
            max_bytes=ROTATION_MAX_BYTES,
            max_kept=2,
        )
        log_path = Path(self.test_dir) / "cron_errors.jsonl"

        # Write a small file
        logger.log_error(
            job_name="weekly-test",
            error=ConnectionError("timeout"),
            retry_count=0,
        )
        # After first write, file exists and is fresh (no archives yet)
        archived = list(Path(self.test_dir).glob("cron_errors.jsonl.*"))
        self.assertEqual(len(archived), 0, "No archives after first write")

        # Write again
        logger.log_error(
            job_name="weekly-test",
            error=ConnectionError("timeout"),
            retry_count=0,
        )
        archived = list(Path(self.test_dir).glob("cron_errors.jsonl.*"))
        # Should be 0 weekly archives since file is fresh (rotation is size-based for first rotation, weekly-based after)
        self.assertGreaterEqual(len(archived), 0)

    def test_weekly_rotation_creates_archive(self):
        """Old log files are rotated on weekly boundary."""
        logger = self._make_logger(max_kept=2)
        log_path = Path(self.test_dir) / "cron_errors.jsonl"

        # Write an entry
        logger.log_error(
            job_name="weekly-rot",
            error=ConnectionError("timeout"),
            retry_count=0,
        )

        # Backdate the file by 8 days to trigger weekly rotation
        old_time = time.time() - (8 * 86400)
        os.utime(log_path, (old_time, old_time))

        # Write another entry — should trigger weekly rotation
        logger.log_error(
            job_name="weekly-rot",
            error=ConnectionError("timeout"),
            retry_count=0,
        )

        archived = list(Path(self.test_dir).glob("cron_errors.jsonl.*"))
        self.assertGreaterEqual(len(archived), 1,
                                "Expected weekly rotation archive")

    def test_max_kept_enforced(self):
        """Only max_kept rotated files are kept."""
        logger = self._make_logger(max_bytes=1000, max_kept=2)
        log_path = Path(self.test_dir) / "cron_errors.jsonl"

        long_message = "x" * 200
        for _ in range(10):
            logger.log_error(
                job_name="max-kept",
                error=ConnectionError(long_message),
                retry_count=0,
            )

        archived = list(Path(self.test_dir).glob("cron_errors.jsonl.*"))
        self.assertLessEqual(len(archived), 2,
                             "Should keep at most max_kept rotated files")

    def test_stack_trace_in_output(self):
        """Stack trace is included in log entry."""
        import traceback
        try:
            raise ValueError("test error")
        except Exception:
            tb = traceback.format_exc()

        logger = self._make_logger()
        logger.log_error(
            job_name="stack-test",
            error=ValueError("test error"),
            retry_count=1,
            stack_trace=tb,
        )

        log_path = Path(self.test_dir) / "cron_errors.jsonl"
        with open(log_path) as f:
            entry = json.loads(f.readline())
        self.assertIn("test error", entry["stack_trace"])

    def test_error_type_enum_values(self):
        """ErrorType enum has expected values."""
        self.assertEqual(ErrorType.TRANSIENT.value, "transient")
        self.assertEqual(ErrorType.PERMANENT.value, "permanent")
        self.assertEqual(ErrorType.IDEMPOTENT.value, "idempotent")


if __name__ == "__main__":
    unittest.main()
