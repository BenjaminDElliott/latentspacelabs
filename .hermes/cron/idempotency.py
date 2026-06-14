"""Idempotency Manager for Hermes Agent Cron Jobs.

SQLite-backed key tracking that prevents duplicate executions when
cron jobs retry. Uses SHA-256 idempotency keys and the INSERT OR IGNORE
pattern for all create operations.

No external dependencies — uses only Python stdlib.

Usage
-----
    from idempotency import IdempotencyManager, make_key

    mgr = IdempotencyManager()

    # Create a key from job parameters (SHA-256)
    key = make_key(job_name="linear-triage", payload={"query": "label:flywheel"})

    # Check if already executed — returns True if a matching record exists
    if mgr.is_duplicate(key):
        print("Already executed — skipping")
    else:
        # Record execution
        mgr.record(key, job_name="linear-triage", payload={"query": "label:flywheel"})
        # ... do the work ...

    # List all tracked keys
    keys = mgr.list_keys(job_name="linear-triage")
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger("idempotency")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_STATE_DIR = Path.home() / ".hermes" / "state"
DEFAULT_DB_PATH = _DEFAULT_STATE_DIR / "cron_idempotency.db"

# SQLite WAL mode for better concurrent access
# PRAGMAs applied on every connection
INIT_SQL = """
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA synchronous=NORMAL;
"""

# ---------------------------------------------------------------------------
# Key generation
# ---------------------------------------------------------------------------


def make_key(*parts: str, separator: str = ":") -> str:
    """Generate a SHA-256 idempotency key from arbitrary string parts.

    Args:
        *parts: Variable number of string components to hash.
        separator: String used between parts before hashing.

    Returns:
        A lowercase hex SHA-256 digest string.

    Example:
        >>> make_key("job-a", "payload-key")
        'a1b2c3...'  # 64-char hex digest
    """
    raw = separator.join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def make_key_from_dict(key_data: dict[str, Any], separator: str = ":") -> str:
    """Generate a SHA-256 idempotency key from a structured dict.

    The dict is serialized to a canonical JSON string (sorted keys,
    no whitespace) before hashing, ensuring the same input always
    produces the same key.

    Args:
        key_data: Dictionary of parameters to hash.
        separator: Not used but kept for API consistency.

    Returns:
        A lowercase hex SHA-256 digest string.
    """
    raw = json.dumps(key_data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# IdempotencyManager
# ---------------------------------------------------------------------------


class IdempotencyError(Exception):
    """Base exception for idempotency operations."""


class IdempotencyKeyExistsError(IdempotencyError):
    """Raised when a key already exists in the store."""


class IdempotencyManager:
    """SQLite-backed idempotency key tracking.

    Stores execution records with unique SHA-256 keys. All create
    operations use the INSERT OR IGNORE pattern, so duplicate calls
    are silently skipped (zero duplicate executions from retries).

    The database uses WAL mode for safe concurrent access.

    Args:
        db_path: Path to the SQLite database file.
                 Defaults to ``~/.hermes/state/cron_idempotency.db``.

    Example:
        >>> mgr = IdempotencyManager()
        >>> key = make_key("linear-triage", "query=label:flywheel")
        >>> if not mgr.is_duplicate(key):
        ...     mgr.record(key, job_name="linear-triage",
        ...                payload={"query": "label:flywheel"})
        ...     # ... execute job ...
    """

    # Columns in the idempotency table
    _SCHEMA_SQL = """
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            key             TEXT PRIMARY KEY,
            job_name        TEXT NOT NULL,
            payload         TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_job_name ON idempotency_keys(job_name);
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self._db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._local = threading.local()
        self._ensure_dir()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_duplicate(self, key: str) -> bool:
        """Check if an idempotency key has already been recorded.

        Args:
            key: SHA-256 hex digest to look up.

        Returns:
            True if a record with this key already exists.
        """
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM idempotency_keys WHERE key = ?", (key,)
            ).fetchone()
            return row is not None

    def record(
        self,
        key: str,
        job_name: str,
        payload: Optional[dict[str, Any]] = None,
    ) -> bool:
        """Record an idempotency key (INSERT OR IGNORE).

        Uses the INSERT OR IGNORE pattern so that duplicate calls
        for the same key are silently skipped — zero duplicate
        executions from retries.

        Args:
            key: SHA-256 hex digest for this execution.
            job_name: Name of the cron job that ran.
            payload: Optional structured data about this execution.

        Returns:
            True if a new record was inserted, False if key already existed.
        """
        now = datetime.now(timezone.utc).isoformat()
        payload_json = json.dumps(payload, sort_keys=True) if payload else None

        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO idempotency_keys
                    (key, job_name, payload, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (key, job_name, payload_json, now, now),
            )
            inserted = cursor.rowcount > 0
            conn.commit()
            return inserted

    def get_record(self, key: str) -> Optional[dict[str, Any]]:
        """Retrieve a recorded idempotency entry.

        Args:
            key: SHA-256 hex digest to look up.

        Returns:
            Dictionary with record fields, or None if not found.
        """
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM idempotency_keys WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                return None
            return {
                "key": row[0],
                "job_name": row[1],
                "payload": json.loads(row[2]) if row[2] else None,
                "created_at": row[3],
                "updated_at": row[4],
            }

    def list_keys(
        self,
        job_name: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List tracked idempotency keys.

        Args:
            job_name: Optional filter by job name.
            limit: Maximum number of records to return.

        Returns:
            List of record dictionaries.
        """
        with self._connect() as conn:
            if job_name:
                rows = conn.execute(
                    "SELECT * FROM idempotency_keys WHERE job_name = ? ORDER BY created_at DESC LIMIT ?",
                    (job_name, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM idempotency_keys ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()

        return [
            {
                "key": r[0],
                "job_name": r[1],
                "payload": json.loads(r[2]) if r[2] else None,
                "created_at": r[3],
                "updated_at": r[4],
            }
            for r in rows
        ]

    def delete_key(self, key: str) -> bool:
        """Delete an idempotency key record.

        Args:
            key: SHA-256 hex digest to delete.

        Returns:
            True if a record was deleted, False if key was not found.
        """
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM idempotency_keys WHERE key = ?", (key,)
            )
            conn.commit()
            return cursor.rowcount > 0

    def clear(self, job_name: Optional[str] = None) -> int:
        """Delete idempotency records.

        Args:
            job_name: If provided, only delete records for this job.
                      If None, delete ALL records.

        Returns:
            Number of records deleted.
        """
        if job_name:
            with self._connect() as conn:
                cursor = conn.execute(
                    "DELETE FROM idempotency_keys WHERE job_name = ?",
                    (job_name,),
                )
                deleted = cursor.rowcount
                conn.commit()
                return deleted
        else:
            with self._connect() as conn:
                cursor = conn.execute("DELETE FROM idempotency_keys")
                deleted = cursor.rowcount
                conn.commit()
                return deleted

    def count(self, job_name: Optional[str] = None) -> int:
        """Count idempotency records.

        Args:
            job_name: If provided, only count records for this job.

        Returns:
            Number of matching records.
        """
        if job_name:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT COUNT(*) FROM idempotency_keys WHERE job_name = ?",
                    (job_name,),
                ).fetchone()
                return row[0]
        else:
            with self._connect() as conn:
                row = conn.execute("SELECT COUNT(*) FROM idempotency_keys").fetchone()
                return row[0]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_dir(self) -> None:
        """Create the state directory if it doesn't exist."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

    def _local_conn(self) -> sqlite3.Connection:
        """Get a thread-local database connection.

        Each thread gets its own connection to avoid SQLite locking
        issues. Connections are lazily created on first use.
        """
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                str(self._db_path),
                isolation_level=None,
                check_same_thread=False,
            )
            self._local.conn.row_factory = sqlite3.Row
            # Apply WAL and other PRAGMAs
            self._local.conn.executescript(INIT_SQL)
            # Create schema (idempotent — CREATE TABLE IF NOT EXISTS)
            self._local_conn_create_schema(self._local.conn)
        return self._local.conn

    @staticmethod
    def _local_conn_create_schema(conn: sqlite3.Connection) -> None:
        """Create the idempotency table and index if they don't exist."""
        conn.execute(
            "CREATE TABLE IF NOT EXISTS idempotency_keys ("
            "key TEXT PRIMARY KEY,"
            "job_name TEXT NOT NULL,"
            "payload TEXT,"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
            ")"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_job_name ON idempotency_keys(job_name)"
        )

    def _connect(self) -> sqlite3.Connection:
        """Get a database connection for the current context.

        Uses thread-local connections for safety.
        """
        return self._local_conn()

    def close(self) -> None:
        """Close the thread-local database connection."""
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None

    def __enter__(self) -> IdempotencyManager:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Convenience function: run idempotently
# ---------------------------------------------------------------------------


def run_idempotently(
    key: str,
    job_name: str,
    callback: Callable[..., Any],
    payload: Optional[dict[str, Any]] = None,
    db_path: Optional[Path] = None,
) -> Optional[Any]:
    """Execute a callable only if its idempotency key hasn't been recorded.

    Pattern:
        result = run_idempotently(
            key=make_key("linear-triage", payload=...),
            job_name="linear-triage",
            payload=...,
            db_path=...,
            callback=lambda: do_triage(query="label:flywheel"),
        )
        if result is None:
            # Already ran — key was recorded, callback skipped
            pass
        else:
            # Fresh execution — callback ran, result available
            ...

    Args:
        key: SHA-256 hex digest for this execution.
        job_name: Name of the cron job.
        callback: A zero-argument callable to execute if this key is new.
        payload: Optional execution payload.
        db_path: Optional path to SQLite DB.

    Returns:
        The result of the callback if this is a new execution,
        or None if the key was already recorded.
    """
    mgr = IdempotencyManager(db_path)
    try:
        if mgr.is_duplicate(key):
            return None
        mgr.record(key, job_name=job_name, payload=payload)
        return callback()
    finally:
        mgr.close()
