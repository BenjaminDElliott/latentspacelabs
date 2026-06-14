"""Unit tests for ~/.hermes/cron/idempotency.py

Tests cover:
- SHA-256 key generation consistency
- INSERT OR IGNORE idempotency (zero duplicates)
- SQLite persistence and WAL mode
- record() returns True on new, False on duplicate
- get_record retrieval
- list_keys filtering and sorting
- delete_key removal
- count() accuracy
- Thread safety (single-threaded for cron)
- make_key_from_dict canonical serialization
- Context manager support
"""

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure ~/.hermes/cron is importable
sys.path.insert(0, str(Path(__file__).parent))

from idempotency import (
    IdempotencyManager,
    IdempotencyKeyExistsError,
    make_key,
    make_key_from_dict,
    run_idempotently,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _temp_db():
    """Create a temporary database path for testing."""
    tmp = tempfile.mkdtemp()
    return Path(tmp) / "test_idempotency.db"


# ---------------------------------------------------------------------------
# Key generation tests
# ---------------------------------------------------------------------------


class TestMakeKey(unittest.TestCase):
    """Tests for the make_key function."""

    def test_consistent_for_same_input(self):
        """Same inputs always produce the same key."""
        key1 = make_key("job-a", "payload-key")
        key2 = make_key("job-a", "payload-key")
        self.assertEqual(key1, key2)

    def test_different_inputs_different_keys(self):
        """Different inputs produce different keys."""
        key1 = make_key("job-a", "payload-key")
        key2 = make_key("job-b", "payload-key")
        self.assertNotEqual(key1, key2)

    def test_key_is_hex_digest(self):
        """Key is a 64-character lowercase hex string."""
        key = make_key("test")
        self.assertEqual(len(key), 64)
        self.assertEqual(key, key.lower())
        # Should be valid hex
        int(key, 16)  # raises if invalid

    def test_separator_used(self):
        """Separator appears between parts in the raw hash input."""
        key1 = make_key("a", "b", separator=":")
        key2 = make_key("a", "b", separator="|")
        self.assertNotEqual(key1, key2)

    def test_single_part(self):
        """Single-part key is valid."""
        key = make_key("only")
        self.assertEqual(len(key), 64)


class TestMakeKeyFromDict(unittest.TestCase):
    """Tests for make_key_from_dict (canonical JSON hashing)."""

    def test_same_dict_same_key(self):
        """Same dict always produces the same key."""
        data = {"a": 1, "b": 2}
        key1 = make_key_from_dict(data)
        key2 = make_key_from_dict(data)
        self.assertEqual(key1, key2)

    def test_different_order_same_key(self):
        """Dict key order doesn't matter (sorted)."""
        data1 = {"a": 1, "b": 2}
        data2 = {"b": 2, "a": 1}
        key1 = make_key_from_dict(data1)
        key2 = make_key_from_dict(data2)
        self.assertEqual(key1, key2)

    def test_different_values_different_key(self):
        """Different values produce different keys."""
        key1 = make_key_from_dict({"a": 1})
        key2 = make_key_from_dict({"a": 2})
        self.assertNotEqual(key1, key2)

    def test_key_is_hex_digest(self):
        """Key is a 64-char hex digest."""
        key = make_key_from_dict({"test": True})
        self.assertEqual(len(key), 64)
        int(key, 16)  # validates hex


# ---------------------------------------------------------------------------
# IdempotencyManager tests
# ---------------------------------------------------------------------------


class TestIdempotencyManager(unittest.TestCase):
    """Tests for IdempotencyManager core functionality."""

    def setUp(self):
        self.db_path = _temp_db()
        self.mgr = IdempotencyManager(db_path=self.db_path)

    def tearDown(self):
        self.mgr.close()
        if self.db_path.exists():
            # Clean up WAL files too
            for extra in (".wal", ".shm"):
                p = Path(str(self.db_path) + extra)
                if p.exists():
                    p.unlink()
            self.db_path.unlink()

    def test_is_duplicate_returns_false_for_new_key(self):
        """New keys are not duplicates."""
        key = make_key("test-job", "unique-key")
        self.assertFalse(self.mgr.is_duplicate(key))

    def test_is_duplicate_returns_true_after_record(self):
        """After recording, key is a duplicate."""
        key = make_key("test-job", "unique-key")
        self.mgr.record(key, job_name="test-job")
        self.assertTrue(self.mgr.is_duplicate(key))

    def test_record_returns_true_on_first_insert(self):
        """record() returns True when inserting a new key."""
        key = make_key("test-job", "new-key")
        self.assertTrue(self.mgr.record(key, job_name="test-job"))

    def test_record_returns_false_on_duplicate(self):
        """record() returns False when key already exists (INSERT OR IGNORE)."""
        key = make_key("test-job", "duplicate-key")
        self.assertTrue(self.mgr.record(key, job_name="test-job"))
        self.assertFalse(self.mgr.record(key, job_name="test-job"))

    def test_zero_duplicate_executions(self):
        """Multiple retry calls produce zero duplicate records."""
        key = make_key("linear-triage", "payload")
        inserted_count = 0
        for attempt in range(10):
            if self.mgr.record(key, job_name="linear-triage"):
                inserted_count += 1

        self.assertEqual(inserted_count, 1,
                         f"Expected exactly 1 insertion from 10 attempts, got {inserted_count}")

    def test_record_with_payload(self):
        """Payload is stored and can be retrieved."""
        key = make_key("test-job", "with-payload")
        payload = {"query": "label:flywheel", "limit": 5}
        self.mgr.record(key, job_name="test-job", payload=payload)

        record = self.mgr.get_record(key)
        self.assertIsNotNone(record)
        self.assertEqual(record["job_name"], "test-job")
        self.assertEqual(record["payload"], payload)

    def test_record_without_payload(self):
        """Keys can be recorded without payload."""
        key = make_key("test-job", "no-payload")
        self.mgr.record(key, job_name="test-job")

        record = self.mgr.get_record(key)
        self.assertIsNotNone(record)
        self.assertIsNone(record["payload"])

    def test_get_record_returns_none_for_missing_key(self):
        """Missing key returns None."""
        record = self.mgr.get_record(make_key("missing", "key"))
        self.assertIsNone(record)

    def test_get_record_fields(self):
        """Record has all expected fields."""
        key = make_key("test-job", "fields-test")
        payload = {"action": "triage"}
        self.mgr.record(key, job_name="test-job", payload=payload)

        record = self.mgr.get_record(key)
        for field in ("key", "job_name", "payload", "created_at", "updated_at"):
            self.assertIn(field, record, f"Missing field: {field}")

    def test_list_keys_empty(self):
        """List returns empty for no records."""
        keys = self.mgr.list_keys()
        self.assertEqual(keys, [])

    def test_list_keys_returns_records(self):
        """List returns recorded keys."""
        key1 = make_key("test-job", "key-1")
        key2 = make_key("test-job", "key-2")
        self.mgr.record(key1, job_name="test-job")
        self.mgr.record(key2, job_name="test-job")

        keys = self.mgr.list_keys(job_name="test-job")
        self.assertEqual(len(keys), 2)

    def test_list_keys_filtered_by_job_name(self):
        """List filters by job_name."""
        key1 = make_key("job-a", "key-1")
        key2 = make_key("job-b", "key-2")
        self.mgr.record(key1, job_name="job-a")
        self.mgr.record(key2, job_name="job-b")

        keys_a = self.mgr.list_keys(job_name="job-a")
        keys_b = self.mgr.list_keys(job_name="job-b")
        keys_all = self.mgr.list_keys()

        self.assertEqual(len(keys_a), 1)
        self.assertEqual(len(keys_b), 1)
        self.assertEqual(len(keys_all), 2)

    def test_list_keys_limit(self):
        """List respects limit."""
        for i in range(10):
            key = make_key("test", f"key-{i}")
            self.mgr.record(key, job_name="test")

        keys = self.mgr.list_keys(limit=3)
        self.assertLessEqual(len(keys), 3)

    def test_delete_key(self):
        """Delete removes a key."""
        key = make_key("test", "delete-me")
        self.mgr.record(key, job_name="test")
        self.assertTrue(self.mgr.is_duplicate(key))

        deleted = self.mgr.delete_key(key)
        self.assertTrue(deleted)
        self.assertFalse(self.mgr.is_duplicate(key))

    def test_delete_nonexistent_key(self):
        """Deleting nonexistent key returns False."""
        deleted = self.mgr.delete_key(make_key("missing", "key"))
        self.assertFalse(deleted)

    def test_clear_all(self):
        """Clear removes all records."""
        for i in range(5):
            key = make_key("test", f"key-{i}")
            self.mgr.record(key, job_name="test")

        deleted = self.mgr.clear()
        self.assertEqual(deleted, 5)
        self.assertEqual(self.mgr.count(), 0)

    def test_clear_job_only(self):
        """Clear with job_name only removes that job's records."""
        self.mgr.record(make_key("a", "1"), job_name="job-a")
        self.mgr.record(make_key("b", "2"), job_name="job-b")

        deleted = self.mgr.clear(job_name="job-a")
        self.assertEqual(deleted, 1)
        self.assertEqual(self.mgr.count(), 1)

    def test_count(self):
        """Count returns correct number."""
        for i in range(5):
            key = make_key("test", f"key-{i}")
            self.mgr.record(key, job_name="test")

        self.assertEqual(self.mgr.count(), 5)
        self.assertEqual(self.mgr.count(job_name="test"), 5)
        self.assertEqual(self.mgr.count(job_name="nonexistent"), 0)

    def test_persistence_across_instances(self):
        """Records persist when creating a new IdempotencyManager."""
        key = make_key("persistent", "job")
        self.mgr.record(key, job_name="persistent")
        self.mgr.close()

        # New instance should see the record
        mgr2 = IdempotencyManager(db_path=self.db_path)
        try:
            self.assertTrue(mgr2.is_duplicate(key))
            record = mgr2.get_record(key)
            self.assertIsNotNone(record)
        finally:
            mgr2.close()

    def test_context_manager(self):
        """Context manager works correctly."""
        key = make_key("cm", "job")
        with IdempotencyManager(db_path=self.db_path) as mgr:
            mgr.record(key, job_name="cm")
            self.assertTrue(mgr.is_duplicate(key))
        # Connection should be closed
        self.assertIsNone(mgr._local.conn)

    def test_wal_mode(self):
        """Database uses WAL journal mode."""
        conn = self.mgr._connect()
        row = conn.execute("PRAGMA journal_mode").fetchone()
        self.assertEqual(row[0], "wal")


# ---------------------------------------------------------------------------
# Integration test: idempotent retry pattern
# ---------------------------------------------------------------------------


class TestIdempotentRetryPattern(unittest.TestCase):
    """Integration tests for the idempotent retry workflow."""

    def setUp(self):
        self.db_path = _temp_db()

    def tearDown(self):
        if self.db_path.exists():
            for extra in (".wal", ".shm"):
                p = Path(str(self.db_path) + extra)
                if p.exists():
                    p.unlink()
            self.db_path.unlink()

    def test_retry_workflow(self):
        """Simulate a cron job that retries — only executes once."""
        key = make_key("linear-triage", "query=label:flywheel")
        executed = False
        executions = []

        mgr = IdempotencyManager(db_path=self.db_path)
        try:
            for attempt in range(3):
                if mgr.is_duplicate(key):
                    executions.append(f"skip-{attempt}")
                    continue

                # Only record and execute on first attempt
                if not executed:
                    mgr.record(key, job_name="linear-triage")
                    executed = True
                executions.append(f"exec-{attempt}")
        finally:
            mgr.close()

        # First attempt: not duplicate -> record and exec
        # Second attempt: duplicate -> skip
        # Third attempt: duplicate -> skip
        self.assertEqual(executions, ["exec-0", "skip-1", "skip-2"])

    def test_different_keys_different_ids(self):
        """Different job payloads get different keys."""
        key1 = make_key("triage", "query=label:flywheel")
        key2 = make_key("triage", "query=label:bug")

        with IdempotencyManager(db_path=self.db_path) as mgr:
            self.assertNotEqual(key1, key2)
            self.assertTrue(mgr.record(key1, job_name="triage"))
            self.assertTrue(mgr.record(key2, job_name="triage"))
            self.assertEqual(mgr.count(), 2)


class TestRunIdempotently(unittest.TestCase):
    """Tests for the run_idempotently convenience function."""

    def setUp(self):
        self.db_path = _temp_db()

    def tearDown(self):
        if self.db_path.exists():
            for extra in (".wal", ".shm"):
                p = Path(str(self.db_path) + extra)
                if p.exists():
                    p.unlink()
            self.db_path.unlink()

    def test_run_idempotently_executes_on_first_call(self):
        """First call executes callback and records key."""
        key = make_key("test-job", "first-run")

        result = run_idempotently(
            key=key,
            job_name="test-job",
            callback=lambda: "executed",
            db_path=self.db_path,
        )

        self.assertEqual(result, "executed")

    def test_run_idempotently_skips_on_duplicate(self):
        """Second call with same key skips callback and returns None."""
        key = make_key("test-job", "duplicate-key")

        run_idempotently(
            key=key,
            job_name="test-job",
            callback=lambda: "first",
            db_path=self.db_path,
        )

        result = run_idempotently(
            key=key,
            job_name="test-job",
            callback=lambda: "second",
            db_path=self.db_path,
        )

        self.assertIsNone(result)

    def test_run_idempotently_stores_payload(self):
        """Payload is stored when key is new."""
        key = make_key("test-job", "with-payload")
        payload = {"query": "label:bug", "priority": "high"}

        run_idempotently(
            key=key,
            job_name="test-job",
            callback=lambda: "done",
            payload=payload,
            db_path=self.db_path,
        )

        mgr = IdempotencyManager(db_path=self.db_path)
        try:
            record = mgr.get_record(key)
            self.assertEqual(record["payload"], payload)
        finally:
            mgr.close()

    def test_run_idempotently_preserves_callback_result(self):
        """Callback return value is preserved."""
        key = make_key("test-job", "result-test")

        def my_callback():
            return {"status": "triaged", "count": 42}

        result = run_idempotently(
            key=key,
            job_name="test-job",
            callback=my_callback,
            db_path=self.db_path,
        )

        self.assertEqual(result, {"status": "triaged", "count": 42})


if __name__ == "__main__":
    unittest.main()
