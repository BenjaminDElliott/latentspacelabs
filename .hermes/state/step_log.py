"""
Step logging module for the Hermes flywheel.

Tracks each step in task execution with result, timestamp, duration, and errors.
Logs are truncated to the last 50 entries to prevent file bloat.

Usage::

    from step_log import StepLog

    log = StepLog()
    log.add("build_prompt", "ok")
    log.add("execute_code", "ok", duration_ms=1234)
    log.add("run_tests", "fail", error="test_1 failed")
    log.save_to_file("/path/to/state.json")

Or use the StateManager convenience methods:

    from state_manager import StateManager
    StateManager.log_step("LAT-214", "build_prompt", "ok")
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Maximum number of step log entries to retain. Older entries are discarded.
MAX_ENTRIES = 50


class StepLog:
    """In-memory step log with truncation and atomic file persistence.

    Attributes:
        entries: Ordered list of step log dicts. Each entry has at minimum
                 ``step``, ``result``, and ``timestamp``.  Optional keys
                 include ``duration_ms`` and ``error``.
    """

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Adding entries
    # ------------------------------------------------------------------

    def add(
        self,
        step: str,
        result: str,
        *,
        duration_ms: Optional[int] = None,
        error: Optional[str] = None,
        timestamp: Optional[str] = None,
        **extra: Any,
    ) -> None:
        """Record a single step execution.

        Parameters:
            step: Human-readable name of the step (e.g. ``"build_prompt"``).
            result: One of ``"ok"``, ``"fail"``, or ``"error"``.
            duration_ms: Optional duration in milliseconds (set on success).
            error: Optional error message (set on failure).
            timestamp: Optional ISO-8601 timestamp. Defaults to now (UTC).
            **extra: Additional free-form fields to attach to the entry.

        The entry is appended to the log.  Truncation to ``MAX_ENTRIES``
        entries happens automatically after each add.
        """
        if timestamp is None:
            timestamp = datetime.now(timezone.utc).isoformat()

        entry: dict[str, Any] = {
            "step": step,
            "result": result,
            "timestamp": timestamp,
        }
        if duration_ms is not None:
            entry["duration_ms"] = duration_ms
        if error is not None:
            entry["error"] = error
        entry.update(extra)

        self.entries.append(entry)

        # Truncate to the last MAX_ENTRIES entries.
        if len(self.entries) > MAX_ENTRIES:
            self.entries = self.entries[-MAX_ENTRIES:]

    # ------------------------------------------------------------------
    # Serialization & persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Return a serialisable dict with the ``step_log`` key."""
        return {"step_log": self.entries}

    def to_json(self, *, indent: int = 2) -> str:
        """Return a JSON string containing the step log."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        """Write *content* to *path* atomically via a temp file + rename."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=path.parent, prefix=".step_log_tmp_"
        )
        try:
            with os.fdopen(fd, "w") as fh:
                fh.write(content)
            os.replace(tmp_path, path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def save_to_file(self, filepath: str | Path) -> None:
        """Atomically write the step log to *filepath* as JSON.

        The entire log (``{"step_log": [...]}``) is written in one
        atomic operation.
        """
        path = Path(filepath)
        content = self.to_json()
        self._atomic_write(path, content)
        logger.debug("Step log written to %s (%d entries)", path, len(self.entries))

    @classmethod
    def load_from_file(cls, filepath: str | Path) -> "StepLog":
        """Load a step log from *filepath*.

        Returns a fresh ``StepLog`` instance.  If the file does not exist
        or is empty, an empty log is returned.
        """
        path = Path(filepath)
        log = cls()
        if not path.exists():
            return log
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return log
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Could not parse step log file: %s", filepath)
            return log

        entries = data.get("step_log", [])
        if isinstance(entries, list):
            for entry in entries:
                if isinstance(entry, dict):
                    log.entries.append(entry)
        return log

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    @property
    def count(self) -> int:
        """Total number of entries currently in the log."""
        return len(self.entries)

    def get_entries(self) -> list[dict[str, Any]]:
        """Return a copy of all entries."""
        return list(self.entries)
