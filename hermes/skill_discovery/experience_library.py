"""Experience Library — SQLite-based tracking of discovered skills and performance.

Maps past tasks to discovered skills, tracks quality scores, usage metrics, and
provides an audit trail for all auto-discovered skills. Designed for <100 MB growth
per year per the PRD constraints.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS discovered_skills (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    triggers        TEXT NOT NULL,          -- JSON array of trigger strings
    tool_sequences  TEXT NOT NULL,          -- JSON array of tool name sequences
    error_patterns  TEXT,                   -- JSON array of error pattern strings
    candidate_text  TEXT NOT NULL,          -- Full SKILL.md content
    quality_score   REAL DEFAULT 0,         -- 0.0-1.0 aggregate score
    correctness     REAL DEFAULT 0,         -- correctness sub-score
    completeness    REAL DEFAULT 0,         -- completeness sub-score
    novelty         REAL DEFAULT 0,         -- novelty sub-score
    status          TEXT DEFAULT 'candidate',
                                                -- candidate | review_needed | approved | rejected | deprecated
    reviewed_by     TEXT,                   -- reviewer identifier
    reviewed_at     TEXT,                   -- ISO timestamp
    approved_at     TEXT,                   -- ISO timestamp (when promoted)
    sandbox_passes  INTEGER DEFAULT 0,
    sandbox_fails   INTEGER DEFAULT 0,
    usage_count     INTEGER DEFAULT 0,
    usage_successes INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_patterns (
    id              TEXT PRIMARY KEY,
    pattern_hash    TEXT NOT NULL,          -- SHA-256 of normalized tool sequence
    source_log      TEXT NOT NULL,          -- which log file this came from
    log_session_id  TEXT,                   -- session ID from the log
    tool_sequence   TEXT NOT NULL,          -- JSON array of tool names
    context         TEXT,                   -- JSON: surrounding context
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    is_error_pattern  INTEGER DEFAULT 0,
    error_type      TEXT,                   -- e.g. 'approval_pending', 'timeout'
    FOREIGN KEY (id) REFERENCES discovered_skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skill_usage (
    id              TEXT PRIMARY KEY,
    skill_id        TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    outcome         TEXT NOT NULL,          -- success | failure | partial
    duration_ms     REAL,                   -- execution duration in ms
    feedback        TEXT,                   -- optional human feedback
    created_at      TEXT NOT NULL,
    FOREIGN KEY (skill_id) REFERENCES discovered_skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    skill_id        TEXT NOT NULL,
    action          TEXT NOT NULL,          -- created | scored | reviewed | approved | rejected | deprecated | sandboxed
    details         TEXT,                   -- JSON: additional context
    actor           TEXT NOT NULL,          -- 'auto', 'human-<name>', or system identifier
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovered_status ON discovered_skills(status);
CREATE INDEX IF NOT EXISTS idx_discovered_created ON discovered_skills(created_at);
CREATE INDEX IF NOT EXISTS idx_patterns_hash ON skill_patterns(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_usage_skill ON skill_usage(skill_id);
CREATE INDEX IF NOT EXISTS idx_audit_skill ON audit_log(skill_id);
"""


class ExperienceLibrary:
    """SQLite-backed experience library for skill discovery pipeline."""

    def __init__(self, db_path: Optional[str] = None):
        """
        Args:
            db_path: Path to the SQLite database file. Defaults to
                     ``~/.hermes/skill_discovery/experience.db``.
        """
        if db_path is None:
            home = Path.home() / ".hermes" / "skill_discovery"
            home.mkdir(parents=True, exist_ok=True)
            db_path = str(home / "experience.db")
        self.db_path = db_path
        self._init_db()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA_SQL)
        logger.info("Experience library initialized at %s", self.db_path)

    # ------------------------------------------------------------------
    # Discovered skills CRUD
    # ------------------------------------------------------------------

    def insert_skill(
        self,
        name: str,
        description: str,
        triggers: List[str],
        tool_sequences: List[str],
        error_patterns: Optional[List[str]] = None,
        candidate_text: str = "",
        **kwargs: Any,
    ) -> str:
        """Insert a new candidate skill. Returns the generated UUID."""
        skill_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO discovered_skills
                    (id, name, description, triggers, tool_sequences, error_patterns,
                     candidate_text, quality_score, correctness, completeness, novelty,
                     status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'candidate', ?, ?)
                """,
                (
                    skill_id,
                    name,
                    description,
                    json.dumps(triggers),
                    json.dumps(tool_sequences),
                    json.dumps(error_patterns or []),
                    candidate_text,
                    now,
                    now,
                ),
            )
            # Record pattern linkage
            for seq in tool_sequences:
                self._record_pattern(conn, skill_id, seq)
            self._audit(conn, skill_id, "created", actor="auto")
        logger.info("Inserted candidate skill %s (%s)", skill_id[:8], name)
        return skill_id

    def _record_pattern(
        self, conn: sqlite3.Connection, skill_id: str, tool_sequence: str
    ) -> None:
        """Record the source pattern for a skill."""
        pattern_hash = self._hash_sequence(tool_sequence)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO skill_patterns
                    (id, pattern_hash, source_log, tool_sequence,
                     first_seen, last_seen, occurrence_count, is_error_pattern)
                VALUES (?, ?, 'auto-mined', ?, ?, ?, 1, 0)
                """,
                (
                    skill_id,
                    pattern_hash,
                    tool_sequence,
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )

    @staticmethod
    def _hash_sequence(sequence: Any) -> str:
        """Hash a tool sequence (list of strings or JSON string)."""
        import hashlib

        if isinstance(sequence, str):
            normalized = json.dumps(sorted(sequence.split(",")), sort_keys=True)
        else:
            normalized = json.dumps(list(sequence), sort_keys=True)
        return hashlib.sha256(normalized.encode()).hexdigest()[:16]

    def get_skill(self, skill_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single skill by ID."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM discovered_skills WHERE id = ?", (skill_id,)
            ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def list_skills(
        self,
        status: Optional[str] = None,
        min_score: Optional[float] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List skills with optional filters."""
        conditions: List[str] = []
        params: List[Any] = []
        if status:
            conditions.append("status = ?")
            params.append(status)
        if min_score is not None:
            conditions.append("quality_score >= ?")
            params.append(min_score)
        where = " AND ".join(conditions) if conditions else "1=1"
        query = f"SELECT * FROM discovered_skills WHERE {where} ORDER BY quality_score DESC LIMIT ?"
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update_skill(
        self,
        skill_id: str,
        updates: Dict[str, Any],
    ) -> None:
        """Update skill fields. Sets updated_at."""
        if "updated_at" not in updates:
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        sets = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [skill_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE discovered_skills SET {sets} WHERE id = ?", values)

    def archive_skill(self, skill_id: str) -> None:
        """Archive a skill (soft delete)."""
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE discovered_skills SET status = 'deprecated', updated_at = ? WHERE id = ?",
                (now, skill_id),
            )
            self._audit(conn, skill_id, "deprecated", actor="auto")

    # ------------------------------------------------------------------
    # Quality scores
    # ------------------------------------------------------------------

    def score_skill(
        self,
        skill_id: str,
        correctness: float,
        completeness: float,
        novelty: float,
    ) -> None:
        """Set quality sub-scores and compute aggregate."""
        aggregate = (correctness * 0.4 + completeness * 0.3 + novelty * 0.3)
        self.update_skill(skill_id, {
            "correctness": correctness,
            "completeness": completeness,
            "novelty": novelty,
            "quality_score": aggregate,
        })

    # ------------------------------------------------------------------
    # Review
    # ------------------------------------------------------------------

    def review_skill(
        self,
        skill_id: str,
        status: str,
        reviewer: str = "human",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Record a human review outcome."""
        now = datetime.now(timezone.utc).isoformat()
        updates = {
            "status": status,
            "reviewed_by": reviewer,
            "reviewed_at": now,
        }
        if status == "approved":
            updates["approved_at"] = now
        self.update_skill(skill_id, updates)
        with self._connect() as conn:
            self._audit(
                conn, skill_id, "reviewed",
                actor=reviewer,
                details=details,
            )

    # ------------------------------------------------------------------
    # Usage tracking
    # ------------------------------------------------------------------

    def record_usage(
        self,
        skill_id: str,
        session_id: str,
        outcome: str,
        duration_ms: Optional[float] = None,
        feedback: Optional[str] = None,
    ) -> None:
        """Record a skill execution outcome."""
        usage_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO skill_usage
                    (id, skill_id, session_id, outcome, duration_ms, feedback, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (usage_id, skill_id, session_id, outcome, duration_ms, feedback, now),
            )
            # Update usage counters atomically
            if outcome == "success":
                conn.execute(
                    """
                    UPDATE discovered_skills
                    SET usage_count = usage_count + 1,
                        usage_successes = usage_successes + 1,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (now, skill_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE discovered_skills
                    SET usage_count = usage_count + 1,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (now, skill_id),
                )

    # ------------------------------------------------------------------
    # Sandbox tracking
    # ------------------------------------------------------------------

    def record_sandbox_result(self, skill_id: str, passed: bool) -> None:
        """Record a sandbox test result."""
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE discovered_skills
                SET sandbox_passes = sandbox_passes + ?,
                    sandbox_fails = sandbox_fails + ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (1 if passed else 0, 0 if passed else 1, datetime.now(timezone.utc).isoformat(), skill_id),
            )

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    def statistics(self) -> Dict[str, Any]:
        """Return summary statistics for the experience library."""
        with self._connect() as conn:
            counts = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM discovered_skills GROUP BY status"
            ).fetchall()
            total = sum(r["cnt"] for r in counts)
            stats = {"total": total, "by_status": {r["status"]: r["cnt"] for r in counts}}

            avg_score = conn.execute(
                "SELECT AVG(quality_score) FROM discovered_skills WHERE quality_score > 0"
            ).fetchone()
            stats["avg_quality_score"] = avg_score["AVG(quality_score)"] if avg_score["AVG(quality_score)"] else 0

            # Skills discovered this month
            month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0).isoformat()
            month_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM discovered_skills WHERE created_at >= ?",
                (month_start,),
            ).fetchone()
            stats["skills_this_month"] = month_count["cnt"] if month_count else 0

            return stats

    # ------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------

    def _audit(
        self,
        conn: sqlite3.Connection,
        skill_id: str,
        action: str,
        actor: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Append an audit log entry."""
        audit_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO audit_log (id, skill_id, action, details, actor, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                audit_id,
                skill_id,
                action,
                json.dumps(details) if details else None,
                actor,
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        # Parse JSON columns
        for col in ("triggers", "tool_sequences", "error_patterns"):
            if d.get(col):
                try:
                    d[col] = json.loads(d[col])
                except (json.JSONDecodeError, TypeError):
                    d[col] = []
        return d

    def export_candidate_skills(self, min_score: float = 0.5) -> List[str]:
        """Export candidate skill SKILL.md files that meet the score threshold."""
        skills = self.list_skills(status="candidate", min_score=min_score)
        return [s["candidate_text"] for s in skills if s["candidate_text"]]
