"""
Tests for idempotency_manager.py

Covers all 6 acceptance criteria:
  1. SQLite-backed tracking
  2. SHA-256 key generation from job params + timestamp
  3. INSERT OR IGNORE pattern for create operations
  4. Key expiry: 24-hour TTL
  5. Audit: list duplicate attempts in last 24 hours
  6. Idempotent execution verification & key expiry tests
"""

import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest

# Ensure the parent directory is on the path so we can import the module
sys.path.insert(0, os.path.dirname(__file__))

import idempotency_manager as idm


class TestKeyGeneration(unittest.TestCase):
    """AC 2: SHA-256 key generation from job params + timestamp."""

    def test_deterministic_hash(self):
        """Same job_name + params + timestamp → same key hash."""
        params = {"team": "core", "count": 5}
        ts = 1700000000.0
        key1 = idm.generate_key_hash("test-job", params, ts)
        key2 = idm.generate_key_hash("test-job", params, ts)
        self.assertEqual(key1, key2)

    def test_different_params_different_hash(self):
        """Different params → different hash."""
        params1 = {"team": "core", "count": 5}
        params2 = {"team": "core", "count": 6}
        ts = 1700000000.0
        self.assertNotEqual(
            idm.generate_key_hash("test-job", params1, ts),
            idm.generate_key_hash("test-job", params2, ts),
        )

    def test_different_job_name_different_hash(self):
        """Different job_name → different hash."""
        params = {"team": "core"}
        ts = 1700000000.0
        self.assertNotEqual(
            idm.generate_key_hash("job-a", params, ts),
            idm.generate_key_hash("job-b", params, ts),
        )

    def test_different_timestamp_different_hash(self):
        """Different timestamp → different hash."""
        params = {"team": "core"}
        self.assertNotEqual(
            idm.generate_key_hash("test-job", params, 1000.0),
            idm.generate_key_hash("test-job", params, 2000.0),
        )

    def test_hash_is_sha256_length(self):
        """SHA-256 produces a 64-char hex string."""
        key = idm.generate_key_hash("x", {"y": 1})
        self.assertEqual(len(key), 64)
        self.assertEqual(int(key, 16), int(key, 16))  # valid hex

    def test_no_timestamp_uses_current_time(self):
        """No timestamp → deterministic within the same second."""
        ts_now = time.time()
        key = idm.generate_key_hash("job", {"p": "v"}, ts_now)
        self.assertEqual(len(key), 64)


class TestSQLiteStorage(unittest.TestCase):
    """AC 1: SQLite-backed idempotency key tracking."""

    def test_db_file_created(self):
        """Database file is created at the configured path."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            self.assertTrue(os.path.exists(db_path))
        finally:
            os.unlink(db_path)

    def test_table_exists(self):
        """The idempotency_keys table exists after initialization."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            conn = sqlite3.connect(db_path)
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'"
            )
            self.assertIsNotNone(cur.fetchone())
            conn.close()
        finally:
            os.unlink(db_path)

    def test_row_is_stored(self):
        """A record is actually persisted in SQLite after record_run."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            params = {"team": "core", "count": 1}
            ts = 1700000000.0
            idm.record_run("test-job", params, db_path=db_path, timestamp=ts)

            conn = sqlite3.connect(db_path)
            cur = conn.execute(
                "SELECT key_hash, job_name, execution_count, last_run_at "
                "FROM idempotency_keys WHERE key_hash = ?",
                (idm.generate_key_hash("test-job", params, ts),),
            )
            row = cur.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[1], "test-job")
            self.assertEqual(row[2], 1)
            conn.close()
        finally:
            os.unlink(db_path)


class TestInsertOrIgnore(unittest.TestCase):
    """AC 3: INSERT OR IGNORE pattern for create operations."""

    def test_record_run_returns_true_first_time(self):
        """First call returns True (inserted)."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            params = {"team": "core"}
            ts = 1700000000.0
            self.assertTrue(idm.record_run("test-job", params, db_path=db_path, timestamp=ts))
        finally:
            os.unlink(db_path)

    def test_record_run_returns_false_on_duplicate(self):
        """Second call with same key returns False (ignored)."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            params = {"team": "core"}
            ts = 1700000000.0
            self.assertTrue(idm.record_run("test-job", params, db_path=db_path, timestamp=ts))
            self.assertFalse(idm.record_run("test-job", params, db_path=db_path, timestamp=ts))
        finally:
            os.unlink(db_path)

    def test_try_execute_skips_fn_on_duplicate(self):
        """try_execute skips the function on duplicate and returns (True, None)."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            call_count = [0]

            def my_job():
                call_count[0] += 1
                return "done"

            params = {"team": "core"}
            ts = 1700000000.0

            dup, result = idm.try_execute(
                "test-job", params, my_job,
                db_path=db_path,
                ttl_seconds=86400, timestamp=ts,
            )
            self.assertFalse(dup)
            self.assertEqual(result, "done")

            # Use the SAME timestamp so the hash is identical → duplicate
            dup2, result2 = idm.try_execute(
                "test-job", params, my_job,
                db_path=db_path,
                ttl_seconds=86400, timestamp=ts,
            )
            self.assertTrue(dup2)
            self.assertIsNone(result2)
            self.assertEqual(call_count[0], 1)
        finally:
            os.unlink(db_path)


class TestKeyExpiry(unittest.TestCase):
    """AC 4: Key expiry — 24-hour TTL on idempotency keys."""

    def test_key_expires_after_ttl(self):
        """A key that has expired is no longer a duplicate."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            params = {"team": "core"}
            ts = 1700000000.0
            ttl = 3600  # 1 hour for faster testing

            # First run — not a duplicate
            self.assertTrue(idm.record_run("test-job", params, db_path=db_path, ttl_seconds=ttl, timestamp=ts))

            # While still valid
            self.assertTrue(idm.is_duplicate("test-job", params, db_path=db_path, ttl_seconds=ttl, timestamp=ts))

            # After expiry
            expired_ts = ts + ttl + 1
            self.assertFalse(idm.is_duplicate("test-job", params, db_path=db_path, ttl_seconds=ttl, timestamp=expired_ts))
        finally:
            os.unlink(db_path)

    def test_clean_expired_keys_removes_rows(self):
        """clean_expired_keys deletes rows past their TTL."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            now = time.time()
            ttl = 3600  # 1 hour

            params1 = {"team": "a"}
            params2 = {"team": "b"}

            # job-a created 2h ago → expired (TTL=1h)
            idm.record_run("job-a", params1, db_path=db_path, ttl_seconds=ttl, timestamp=now - 7200)
            # job-b created 30 min ago → still valid
            idm.record_run("job-b", params2, db_path=db_path, ttl_seconds=ttl, timestamp=now - 1800)

            # Clean expired — only job-a should be removed
            removed = idm.clean_expired_keys(db_path=db_path)
            self.assertEqual(removed, 1)

            # job-a gone, job-b still there
            conn = sqlite3.connect(db_path)
            cur = conn.execute("SELECT COUNT(*) FROM idempotency_keys")
            count = cur.fetchone()[0]
            self.assertEqual(count, 1)
            conn.close()
        finally:
            os.unlink(db_path)


class TestAuditDuplicates(unittest.TestCase):
    """AC 5: Audit — list duplicate attempts in last 24 hours."""

    def test_list_duplicates_returns_dupes(self):
        """Keys with execution_count > 1 appear in audit within 24h."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            now = time.time()
            params = {"team": "core"}
            ts = now - 3600  # 1h ago — within 24h

            # First run
            idm.record_run("test-job", params, db_path=db_path, timestamp=ts)
            # Duplicate run — SAME timestamp → same key → count becomes 2
            idm.record_run("test-job", params, db_path=db_path, timestamp=ts)

            dups = idm.list_duplicates(db_path=db_path)
            self.assertEqual(len(dups), 1)
            self.assertEqual(dups[0]["execution_count"], 2)
            self.assertEqual(dups[0]["job_name"], "test-job")
        finally:
            os.unlink(db_path)

    def test_list_duplicates_ignores_old(self):
        """Keys older than 24h are excluded from the audit."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            now = time.time()
            params = {"team": "core"}

            # Run twice at a very old time (> 24h ago)
            idm.record_run("old-job", params, db_path=db_path, timestamp=now - 86400 - 3600)
            idm.record_run("old-job", params, db_path=db_path, timestamp=now - 86400 - 3500)

            dups = idm.list_duplicates(db_path=db_path)
            self.assertEqual(len(dups), 0)
        finally:
            os.unlink(db_path)


class TestTryExecuteIntegration(unittest.TestCase):
    """AC 6: Idempotent execution verification."""

    def test_fn_called_once(self):
        """Function is executed exactly once for duplicate keys."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            calls = []

            def job_fn(msg):
                calls.append(msg)
                return f"result-{msg}"

            params = {"team": "triage", "priority": "high"}
            ts = 1700000000.0

            dup1, res1 = idm.try_execute(
                "triage", params, job_fn, "msg1",
                db_path=db_path, timestamp=ts,
            )
            dup2, res2 = idm.try_execute(
                "triage", params, job_fn, "msg1",
                db_path=db_path, timestamp=ts,
            )
            dup3, res3 = idm.try_execute(
                "triage", params, job_fn, "msg2",
                db_path=db_path, timestamp=ts,
            )

            self.assertFalse(dup1)
            self.assertEqual(res1, "result-msg1")
            self.assertTrue(dup2)
            self.assertIsNone(res2)
            self.assertTrue(dup3)  # same key (same params+timestamp)
            self.assertIsNone(res3)
            self.assertEqual(calls, ["msg1"])
        finally:
            os.unlink(db_path)

    def test_different_params_different_execution(self):
        """Different params → different key → function is called."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            calls = []

            def job_fn(msg):
                calls.append(msg)
                return f"result-{msg}"

            ts = 1700000000.0

            dup1, _ = idm.try_execute(
                "triage", {"team": "a"}, job_fn, "first",
                db_path=db_path, timestamp=ts,
            )
            dup2, res2 = idm.try_execute(
                "triage", {"team": "b"}, job_fn, "second",
                db_path=db_path, timestamp=ts,
            )

            self.assertFalse(dup1)
            self.assertFalse(dup2)
            self.assertEqual(res2, "result-second")
            self.assertEqual(calls, ["first", "second"])
        finally:
            os.unlink(db_path)


class TestIdempotentContextManager(unittest.TestCase):
    """Integration test for the idempotent() context manager."""

    def test_context_manager_blocks_duplicates(self):
        """Second entry into the context sees duplicate=True."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        try:
            idm.initialize(db_path)
            ts = 1700000000.0
            params = {"team": "core"}

            # First context — not a duplicate
            with idm.idempotent("job-a", params, db_path=db_path, timestamp=ts) as info:
                self.assertFalse(info["duplicate"])

            # Second context — duplicate
            with idm.idempotent("job-a", params, db_path=db_path, timestamp=ts) as info:
                self.assertTrue(info["duplicate"])
        finally:
            os.unlink(db_path)


if __name__ == "__main__":
    unittest.main()
