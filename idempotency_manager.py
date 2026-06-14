"""
Idempotency Manager for Hermes Agent cron jobs.

SQLite-backed idempotency key tracking that prevents duplicate cron job
execution. Uses INSERT OR IGNORE pattern for all create operations,
24-hour TTL on keys, and an audit API to list duplicate attempts.

Acceptance Criteria:
  1. SQLite-backed idempotency key tracking in ~/.hermes/state/cron_idempotency.db
  2. SHA-256 key generation from job params + timestamp
  3. INSERT OR IGNORE pattern for all create operations
  4. Key expiry: 24-hour TTL on idempotency keys
  5. Audit: list duplicate attempts in last 24 hours
  6. Tests: idempotent execution verification, key expiry
"""

import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_DB_PATH = os.path.expanduser("~/.hermes/state/cron_idempotency.db")
KEY_TTL_SECONDS = 24 * 60 * 60  # 24 hours
SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _ensure_state_dir(db_path: str) -> None:
    """Create the parent directory for the SQLite database if it doesn't exist."""
    parent = Path(db_path).parent
    parent.mkdir(parents=True, exist_ok=True)


def _init_db(db_path: str) -> None:
    """Create the idempotency table if it does not already exist."""
    _ensure_state_dir(db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                key_hash       TEXT PRIMARY KEY,
                job_name       TEXT    NOT NULL,
                params_json    TEXT    NOT NULL,
                created_at     REAL    NOT NULL,  -- unix timestamp
                expires_at     REAL    NOT NULL,  -- unix timestamp (created_at + TTL)
                execution_count INTEGER NOT NULL DEFAULT 1,
                last_run_at    REAL    NOT NULL
            );
        """)
        conn.commit()
    finally:
        conn.close()


def _get_connection(db_path: str) -> sqlite3.Connection:
    """Return a new connection, initializing the DB schema if needed."""
    _init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


# ---------------------------------------------------------------------------
# Key generation
# ---------------------------------------------------------------------------

def generate_key_hash(job_name: str, params: Dict[str, Any], timestamp: Optional[float] = None) -> str:
    """
    Generate a SHA-256 idempotency key from job name, params, and timestamp.

    Args:
        job_name:  Name of the cron job.
        params:    Job parameters (will be JSON-serialised).
        timestamp: Optional unix timestamp; defaults to current time.

    Returns:
        Hex-encoded SHA-256 digest (64 chars).
    """
    ts = timestamp if timestamp is not None else time.time()
    # Canonical JSON ensures deterministic hashing
    payload = json.dumps({
        "job_name": job_name,
        "params": params,
        "timestamp": ts,
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Core idempotency API
# ---------------------------------------------------------------------------

def try_execute(
    job_name: str,
    params: Dict[str, Any],
    fn: Any,
    *args: Any,
    db_path: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    timestamp: Optional[float] = None,
    **kwargs: Any,
) -> Tuple[bool, Any]:
    """
    Execute *fn* only once per unique (job_name, params, timestamp) combo.

    Uses INSERT OR IGNORE so that concurrent cron runs for the same key
    result in the second run being treated as a duplicate.

    Args:
        job_name:    Cron job identifier.
        params:      Job parameters.
        fn:          Callable to execute.
        *args:       Positional args forwarded to *fn*.
        db_path:     Path to SQLite DB (default: ~/.hermes/state/cron_idempotency.db).
        ttl_seconds: Key TTL in seconds (default: 86400).
        timestamp:   Optional override timestamp for testing.
        **kwargs:    Keyword args forwarded to *fn*.

    Returns:
        (is_duplicate, result) — result is from *fn* or None if duplicate.
    """
    db_path = db_path or DEFAULT_DB_PATH
    ttl = ttl_seconds or KEY_TTL_SECONDS
    ts = timestamp if timestamp is not None else time.time()
    key = generate_key_hash(job_name, params, ts)

    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "SELECT created_at FROM idempotency_keys WHERE key_hash = ?",
            (key,),
        )
        row = cur.fetchone()
        if row is not None:
            # Key already exists — this is a duplicate
            conn.execute(
                "UPDATE idempotency_keys SET execution_count = execution_count + 1 WHERE key_hash = ?",
                (key,),
            )
            conn.commit()
            return True, None

        # INSERT OR IGNORE — first run for this key
        cur = conn.execute(
            "INSERT OR IGNORE INTO idempotency_keys "
            "(key_hash, job_name, params_json, created_at, expires_at, execution_count, last_run_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (key, job_name, json.dumps(params, sort_keys=True), ts, ts + ttl, ts),
        )
        conn.commit()
        result = fn(*args, **kwargs)
        # Update last_run_at after successful execution
        conn.execute(
            "UPDATE idempotency_keys SET last_run_at = ?, execution_count = execution_count + 1 WHERE key_hash = ?",
            (time.time(), key),
        )
        conn.commit()
        return False, result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Record a completed job run (for jobs that manage their own key)
# ---------------------------------------------------------------------------

def record_run(
    job_name: str,
    params: Dict[str, Any],
    db_path: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    timestamp: Optional[float] = None,
) -> bool:
    """
    Record a job run (or return False if already recorded in this window).

    Uses INSERT OR IGNORE pattern.

    Args:
        job_name:  Cron job identifier.
        params:    Job parameters.
        db_path:   Path to SQLite DB.
        ttl_seconds: Key TTL.
        timestamp: Override timestamp.

    Returns:
        True if this is the first run (inserted), False if duplicate (ignored).
    """
    db_path = db_path or DEFAULT_DB_PATH
    ttl = ttl_seconds or KEY_TTL_SECONDS
    ts = timestamp if timestamp is not None else time.time()
    key = generate_key_hash(job_name, params, ts)

    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "SELECT key_hash FROM idempotency_keys WHERE key_hash = ?",
            (key,),
        )
        if cur.fetchone() is not None:
            conn.execute(
                "UPDATE idempotency_keys SET execution_count = execution_count + 1 WHERE key_hash = ?",
                (key,),
            )
            conn.commit()
            return False  # duplicate

        conn.execute(
            "INSERT OR IGNORE INTO idempotency_keys "
            "(key_hash, job_name, params_json, created_at, expires_at, execution_count, last_run_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (key, job_name, json.dumps(params, sort_keys=True), ts, ts + ttl, ts),
        )
        conn.commit()
        return True  # first run
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Expired-key cleanup
# ---------------------------------------------------------------------------

def clean_expired_keys(db_path: Optional[str] = None) -> int:
    """
    Delete all idempotency keys whose TTL has expired.

    Returns:
        Number of rows deleted.
    """
    db_path = db_path or DEFAULT_DB_PATH
    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "DELETE FROM idempotency_keys WHERE expires_at < ?",
            (time.time(),),
        )
        count = cur.rowcount
        conn.commit()
        return count
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Audit API — list duplicate attempts in last 24 hours
# ---------------------------------------------------------------------------

def list_duplicates(db_path: Optional[str] = None, ttl_seconds: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Audit: return all idempotency keys with execution_count > 1 within
    the last 24 hours.

    Args:
        db_path:      Path to SQLite DB.
        ttl_seconds:  TTL used for keys.

    Returns:
        List of dicts with key details.
    """
    db_path = db_path or DEFAULT_DB_PATH
    ttl = ttl_seconds or KEY_TTL_SECONDS
    cutoff = time.time() - 24 * 60 * 60  # last 24 hours

    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "SELECT key_hash, job_name, params_json, created_at, "
            "expires_at, execution_count, last_run_at "
            "FROM idempotency_keys "
            "WHERE execution_count > 1 AND created_at >= ?",
            (cutoff,),
        )
        results: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            results.append({
                "key_hash": row[0],
                "job_name": row[1],
                "params": json.loads(row[2]),
                "created_at": row[3],
                "expires_at": row[4],
                "execution_count": row[5],
                "last_run_at": row[6],
            })
        return results
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Check if a key is currently valid (not expired)
# ---------------------------------------------------------------------------

def is_duplicate(
    job_name: str,
    params: Dict[str, Any],
    db_path: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    timestamp: Optional[float] = None,
) -> bool:
    """
    Check whether an idempotency key already exists and has not expired.

    Returns:
        True if a non-expired key already exists (duplicate).
    """
    db_path = db_path or DEFAULT_DB_PATH
    ttl = ttl_seconds or KEY_TTL_SECONDS
    ts = timestamp if timestamp is not None else time.time()
    key = generate_key_hash(job_name, params, ts)

    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "SELECT expires_at FROM idempotency_keys WHERE key_hash = ?",
            (key,),
        )
        row = cur.fetchone()
        if row is None:
            return False
        expires_at = row[0]
        if expires_at < ts:
            # Expired — not a duplicate anymore
            return False
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Convenience: context manager for guarded execution
# ---------------------------------------------------------------------------

@contextmanager
def idempotent(
    job_name: str,
    params: Dict[str, Any],
    db_path: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    timestamp: Optional[float] = None,
):
    """
    Context manager that blocks duplicate execution.

    Usage:
        with idempotent("linear-triage", {"team": "core"}):
            run_triage()

    If a duplicate run starts before this block exits, the second
    invocation of `idempotent()` will set `duplicate=True`.
    """
    db_path = db_path or DEFAULT_DB_PATH
    ttl = ttl_seconds or KEY_TTL_SECONDS
    ts = timestamp if timestamp is not None else time.time()
    key = generate_key_hash(job_name, params, ts)

    conn = _get_connection(db_path)
    try:
        cur = conn.execute(
            "SELECT created_at FROM idempotency_keys WHERE key_hash = ?",
            (key,),
        )
        row = cur.fetchone()
        if row is not None:
            conn.close()
            yield {"duplicate": True, "key_hash": key}
            return

        conn.execute(
            "INSERT OR IGNORE INTO idempotency_keys "
            "(key_hash, job_name, params_json, created_at, expires_at, execution_count, last_run_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (key, job_name, json.dumps(params, sort_keys=True), ts, ts + ttl, ts),
        )
        conn.commit()
        conn.close()
        yield {"duplicate": False, "key_hash": key}
    except Exception:
        conn.close()
        raise


# ---------------------------------------------------------------------------
# Module-level init
# ---------------------------------------------------------------------------

def initialize(db_path: Optional[str] = None) -> None:
    """Ensure the database schema exists."""
    _init_db(db_path or DEFAULT_DB_PATH)
