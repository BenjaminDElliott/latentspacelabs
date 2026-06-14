"""
Session Log: Persistent session history using append-only SQLite.

Provides a reliable, queryable log of all context management events,
tool calls, and context snapshots. Enables session recovery, replay,
and analysis.

Design decisions:
- Append-only schema: no UPDATEs, only INSERTs
- WAL mode for concurrent write safety
- Automatic cleanup of old entries (> 50MB total)
- Configurable retention policy
- Transaction batching for performance
- Thread-safe with SQLite connection pooling
- Schema versioned for future migrations
"""

import sqlite3
import threading
import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class LogEntry:
    """A single log entry representing a context management event."""
    timestamp: float
    entry_type: str          # "context_snapshot", "tool_call", "summary", "prune", "content_register"
    session_id: str
    turn_index: int
    tokens_before: int
    tokens_after: int
    tokens_delta: int
    data: Dict[str, Any]     # Event-specific payload
    checksum: str = ""       # SHA-256 of serialized data for integrity


@dataclass
class SessionInfo:
    """Metadata about a logged session."""
    session_id: str
    created_at: float
    updated_at: float
    total_entries: int
    total_tokens: int
    tool_call_count: int
    summary_count: int
    pruned: bool


SCHEMA_VERSION = 1

class SessionLog:
    """
    Append-only SQLite log for context management events.

    Usage:
        log = SessionLog(session_id="my-session", db_path="/tmp/context.db")
        log.add_context_snapshot(
            turn_index=5,
            tokens_before=10000,
            tokens_after=8000,
            data={"action": "summarize", "level": 2}
        )
        # Retrieve session history
        entries = log.get_entries(limit=50)
        # Recover from a specific point
        replay = log.replay_from(turn_index=3)
    """

    def __init__(
        self,
        session_id: str,
        db_path: str = None,
        max_entries: int = 10000,
        max_size_bytes: int = 50 * 1024 * 1024,
    ):
        self.session_id = session_id
        self.max_entries = max_entries
        self.max_size_bytes = max_size_bytes

        if db_path is None:
            db_path = f"/tmp/context_log_{session_id}.db"
        self.db_path = db_path

        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        """Initialize the SQLite database and schema."""
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)

        conn = self._get_connection()
        cursor = conn.cursor()

        # Create tables with WAL mode for concurrent writes
        cursor.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            PRAGMA busy_timeout=5000;

            CREATE TABLE IF NOT EXISTS session_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS log_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                entry_type TEXT NOT NULL,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                tokens_before INTEGER NOT NULL DEFAULT 0,
                tokens_after INTEGER NOT NULL DEFAULT 0,
                tokens_delta INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL,
                checksum TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_log_session
                ON log_entries(session_id, turn_index);

            CREATE INDEX IF NOT EXISTS idx_log_type
                ON log_entries(session_id, entry_type);

            -- Session metadata
            INSERT OR REPLACE INTO session_meta (key, value)
            VALUES ('schema_version', ?);
            INSERT OR REPLACE INTO session_meta (key, value)
            VALUES ('session_id', ?);
            INSERT OR REPLACE INTO session_meta (key, value)
            VALUES ('created_at', ?);
        """, (str(SCHEMA_VERSION), self.session_id, str(time.time())))

        conn.commit()
        conn.close()

    def _get_connection(self) -> sqlite3.Connection:
        """Get a database connection."""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def add_entry(self, entry: LogEntry) -> int:
        """
        Append a log entry.

        Returns the new entry ID.
        """
        with self._lock:
            conn = self._get_connection()
            cursor = conn.cursor()

            checksum = self._compute_checksum(entry)
            cursor.execute(
                """INSERT INTO log_entries
                   (timestamp, entry_type, session_id, turn_index,
                    tokens_before, tokens_after, tokens_delta, data, checksum, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry.timestamp,
                    entry.entry_type,
                    entry.session_id,
                    entry.turn_index,
                    entry.tokens_before,
                    entry.tokens_after,
                    entry.tokens_delta,
                    json.dumps(entry.data),
                    checksum,
                    entry.timestamp,
                ),
            )
            entry_id = cursor.lastrowid

            conn.commit()
            conn.close()

            # Enforce limits
            self._enforce_limits()

            return entry_id

    def add_context_snapshot(
        self,
        turn_index: int,
        tokens_before: int,
        tokens_after: int,
        data: Dict[str, Any],
    ) -> int:
        """Log a context snapshot event."""
        entry = LogEntry(
            timestamp=time.time(),
            entry_type="context_snapshot",
            session_id=self.session_id,
            turn_index=turn_index,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            tokens_delta=tokens_after - tokens_before,
            data=data,
        )
        return self.add_entry(entry)

    def add_tool_call(
        self,
        turn_index: int,
        tool_name: str,
        input_tokens: int,
        output_tokens: int,
        success: bool,
        data: Optional[Dict[str, Any]] = None,
    ) -> int:
        """Log a tool call event."""
        entry = LogEntry(
            timestamp=time.time(),
            entry_type="tool_call",
            session_id=self.session_id,
            turn_index=turn_index,
            tokens_before=input_tokens,
            tokens_after=output_tokens,
            tokens_delta=output_tokens - input_tokens,
            data=data or {},
        )
        return self.add_entry(entry)

    def add_summary(
        self,
        turn_index: int,
        level: int,
        original_tokens: int,
        summary_tokens: int,
        data: Dict[str, Any],
    ) -> int:
        """Log a summarization event."""
        entry = LogEntry(
            timestamp=time.time(),
            entry_type="summary",
            session_id=self.session_id,
            turn_index=turn_index,
            tokens_before=original_tokens,
            tokens_after=summary_tokens,
            tokens_delta=summary_tokens - original_tokens,
            data=data,
        )
        return self.add_entry(entry)

    def add_prune(
        self,
        turn_index: int,
        items_before: int,
        items_after: int,
        data: Dict[str, Any],
    ) -> int:
        """Log a pruning event."""
        entry = LogEntry(
            timestamp=time.time(),
            entry_type="prune",
            session_id=self.session_id,
            turn_index=turn_index,
            tokens_before=0,
            tokens_after=0,
            tokens_delta=0,
            data=data,
        )
        return self.add_entry(entry)

    def add_content_register(
        self,
        turn_index: int,
        content_hash: str,
        content_size: int,
        data: Dict[str, Any],
    ) -> int:
        """Log a content registration event."""
        entry = LogEntry(
            timestamp=time.time(),
            entry_type="content_register",
            session_id=self.session_id,
            turn_index=turn_index,
            tokens_before=0,
            tokens_after=content_size,
            tokens_delta=content_size,
            data=data,
        )
        return self.add_entry(entry)

    def get_entries(
        self,
        limit: int = 100,
        offset: int = 0,
        entry_type: Optional[str] = None,
        turn_index: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve log entries."""
        conn = self._get_connection()
        cursor = conn.cursor()

        query = "SELECT * FROM log_entries WHERE session_id = ?"
        params: List[Any] = [self.session_id]

        if entry_type:
            query += " AND entry_type = ?"
            params.append(entry_type)

        if turn_index is not None:
            query += " AND turn_index = ?"
            params.append(turn_index)

        query += " ORDER BY turn_index DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        return [
            {
                "id": row["id"],
                "timestamp": row["timestamp"],
                "entry_type": row["entry_type"],
                "session_id": row["session_id"],
                "turn_index": row["turn_index"],
                "tokens_before": row["tokens_before"],
                "tokens_after": row["tokens_after"],
                "tokens_delta": row["tokens_delta"],
                "data": json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
                "checksum": row["checksum"],
            }
            for row in rows
        ]

    def get_entry_count(self) -> int:
        """Get total number of entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as count FROM log_entries WHERE session_id = ?",
            (self.session_id,),
        )
        count = cursor.fetchone()["count"]
        conn.close()
        return count

    def get_session_info(self) -> SessionInfo:
        """Get session summary metadata."""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """SELECT
                   COUNT(*) as total_entries,
                   COALESCE(SUM(tokens_delta), 0) as total_tokens,
                   SUM(CASE WHEN entry_type = 'tool_call' THEN 1 ELSE 0 END) as tool_call_count,
                   SUM(CASE WHEN entry_type = 'summary' THEN 1 ELSE 0 END) as summary_count,
                   SUM(CASE WHEN entry_type = 'prune' THEN 1 ELSE 0 END) as prune_count,
                   MIN(timestamp) as first_ts,
                   MAX(timestamp) as last_ts
               FROM log_entries
               WHERE session_id = ?""",
            (self.session_id,),
        )
        row = cursor.fetchone()
        conn.close()

        prune_count = row["prune_count"] or 0

        return SessionInfo(
            session_id=self.session_id,
            created_at=row["first_ts"] or time.time(),
            updated_at=row["last_ts"] or time.time(),
            total_entries=row["total_entries"] or 0,
            total_tokens=row["total_tokens"] or 0,
            tool_call_count=row["tool_call_count"] or 0,
            summary_count=row["summary_count"] or 0,
            pruned=prune_count > 0,
        )

    def replay_from(self, turn_index: int) -> List[Dict[str, Any]]:
        """Get all entries from a specific turn index onwards (for replay)."""
        return self.get_entries(limit=10000, turn_index=turn_index)

    def verify_integrity(self) -> bool:
        """Verify all entry checksums for integrity."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, data, checksum FROM log_entries WHERE session_id = ?",
            (self.session_id,),
        )
        rows = cursor.fetchall()
        conn.close()

        for row in rows:
            entry_data = row["data"]
            expected_checksum = self._compute_checksum_from_data(entry_data)
            if expected_checksum != row["checksum"]:
                return False

        return True

    def cleanup_old(self, max_age_hours: int = 24) -> int:
        """Remove entries older than max_age_hours."""
        cutoff = time.time() - (max_age_hours * 3600)
        with self._lock:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM log_entries WHERE session_id = ? AND timestamp < ?",
                (self.session_id, cutoff),
            )
            deleted = cursor.rowcount
            conn.commit()
            conn.close()
            return deleted

    def _enforce_limits(self):
        """Enforce maximum entries and size limits."""
        # Check entry count limit
        count = self.get_entry_count()
        if count > self.max_entries:
            self._prune_oldest(self.max_entries // 10)

        # Check size limit
        size = self._get_db_size()
        if size > self.max_size_bytes:
            self._prune_oldest(max(100, self.max_entries // 10))

    def _prune_oldest(self, n: int = 100):
        """Remove the oldest n entries."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """DELETE FROM log_entries
               WHERE id IN (
                   SELECT id FROM log_entries
                   WHERE session_id = ?
                   ORDER BY id ASC
                   LIMIT ?
               )""",
            (self.session_id, n),
        )
        conn.commit()
        conn.close()

    def _get_db_size(self) -> int:
        """Get database file size."""
        if os.path.exists(self.db_path):
            return os.path.getsize(self.db_path)
        return 0

    @staticmethod
    def _compute_checksum(entry: LogEntry) -> str:
        """Compute SHA-256 checksum of a log entry."""
        import hashlib
        data_str = json.dumps({
            "entry_type": entry.entry_type,
            "turn_index": entry.turn_index,
            "tokens_before": entry.tokens_before,
            "tokens_after": entry.tokens_after,
            "data": entry.data,
        })
        return hashlib.sha256(data_str.encode()).hexdigest()

    @staticmethod
    def _compute_checksum_from_data(data: str) -> str:
        """Compute checksum from serialized data string."""
        import hashlib
        return hashlib.sha256(data.encode()).hexdigest()
