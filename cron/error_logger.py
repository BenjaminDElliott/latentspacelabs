"""Error Logger Module for Hermes Agent Cron Jobs.

Writes structured error records to a JSONL log file with automatic rotation.
Designed to work with the LAT-284 Cron Job Recovery & Resilience System.

Usage
-----
    from error_logger import ErrorLogger, ErrorType, classify_error

    logger = ErrorLogger()
    logger.log_error(
        job_name="health-check",
        error=ConnectionError("timeout"),
        retry_count=2,
    )

Configuration
-------------
    State directory: ~/.hermes/state/
    Log file: cron_errors.jsonl
    Max file size: 100 KB (ROTATION_MAX_BYTES)
    Weekly rotation: enabled (ROTATION_WEEKS)
"""

from __future__ import annotations

import json
import logging
import os
import time
import traceback
from datetime import datetime, timezone
from enum import Enum, auto
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ROTATION_MAX_BYTES: int = 100 * 1024  # 100 KB
ROTATION_WEEKS: int = 1  # Rotate weekly
MAX_STACK_TRACE_CHARS: int = 500

# Default state directory
_DEFAULT_STATE_DIR = Path.home() / ".hermes" / "state"

# ---------------------------------------------------------------------------
# Error type classification
# ---------------------------------------------------------------------------

class ErrorType(str, Enum):
    """Classification for cron job errors.

    - TRANSIENT: Temporary failures that may succeed on retry
      (network timeout, rate limit, connection refused).
    - PERMANENT: Errors that require external intervention
      (parse error, schema mismatch, invalid config).
    - IDEMPOTENT: Duplicate detection errors that can be safely skipped.
    """
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    IDEMPOTENT = "idempotent"


# Pattern-based classification rules
_TRANSIENT_PATTERNS = ("timeout", "rate limit", "timed out", "connection refused",
                       "ECONNREFUSED", "ENOTFOUND", "temporary failure")
_PERMANENT_PATTERNS = ("parse", "schema mismatch", "invalid", "not a", "malformed",
                       "decoding error", "json decode")
_IDEMPOTENT_PATTERNS = ("duplicate", "already exists", "conflict", "already present")


def classify_error(error: Exception) -> ErrorType:
    """Classify an exception into an ErrorType category.

    Classification order:
    1. Specific exception types (ConnectionError, TimeoutError → transient)
    2. Message pattern matching for transient/permanent/idempotent keywords
    3. Default to PERMANENT for unclassifiable errors

    Args:
        error: The exception to classify.

    Returns:
        ErrorType classification of the error.
    """
    # Check specific exception types first
    if isinstance(error, (ConnectionError, TimeoutError)):
        return ErrorType.TRANSIENT

    # Check message patterns (case-insensitive)
    msg = str(error).lower()

    for pattern in _IDEMPOTENT_PATTERNS:
        if pattern in msg:
            return ErrorType.IDEMPOTENT

    for pattern in _TRANSIENT_PATTERNS:
        if pattern in msg:
            return ErrorType.TRANSIENT

    for pattern in _PERMANENT_PATTERNS:
        if pattern in msg:
            return ErrorType.PERMANENT

    # Default: treat unknown errors as permanent
    return ErrorType.PERMANENT


# ---------------------------------------------------------------------------
# CronError record
# ---------------------------------------------------------------------------

class CronError:
    """Structured error record for cron job failures.

    Fields:
        timestamp: When the error occurred (ISO 8601 UTC).
        job_name: Name of the cron job that failed.
        error_type: Classification (transient/permanent/idempotent).
        message: Human-readable error message.
        retry_count: Number of retry attempts made.
        stack_trace: Full stack trace, truncated to 500 chars.
    """

    def __init__(
        self,
        job_name: str,
        error_type: ErrorType,
        message: str,
        retry_count: int = 0,
        stack_trace: str = "",
    ) -> None:
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self.job_name = job_name
        self.error_type = error_type
        self.message = message
        self.retry_count = retry_count
        # Truncate stack trace to MAX_STACK_TRACE_CHARS
        self.stack_trace = (
            stack_trace[:MAX_STACK_TRACE_CHARS] if stack_trace else ""
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a dictionary for JSON encoding."""
        return {
            "timestamp": self.timestamp,
            "job_name": self.job_name,
            "error_type": self.error_type.value,
            "message": self.message,
            "retry_count": self.retry_count,
            "stack_trace": self.stack_trace,
        }

    def to_json(self) -> str:
        """Serialize to a JSON line for the JSONL file."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_error(
        cls,
        job_name: str,
        error: Exception,
        retry_count: int = 0,
        stack_trace: Optional[str] = None,
    ) -> "CronError":
        """Create a CronError from an exception.

        Convenience factory that auto-classifies the error type
        and formats the message.

        Args:
            job_name: Name of the cron job that failed.
            error: The exception that occurred.
            retry_count: Number of retry attempts already made.
            stack_trace: Pre-formatted stack trace string.
                         If None, one will be generated.

        Returns:
            A new CronError instance.
        """
        if stack_trace is None:
            stack_trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        return cls(
            job_name=job_name,
            error_type=classify_error(error),
            message=str(error),
            retry_count=retry_count,
            stack_trace=stack_trace,
        )


# ---------------------------------------------------------------------------
# ErrorLogger
# ---------------------------------------------------------------------------

class ErrorLogger:
    """Writes structured cron job errors to a JSONL file with rotation.

    The log file is stored at ``~/.hermes/state/cron_errors.jsonl``.
    When the file exceeds ROTATION_MAX_BYTES (100 KB), it is rotated
    to ``cron_errors.jsonl.1``, then ``cron_errors.jsonl.2``, etc.
    Up to ``max_kept`` rotated files are retained.

    Weekly rotation also occurs: if the current log file is older than
    ROTATION_WEEKS, it is rotated on the next write.
    """

    def __init__(
        self,
        state_dir: Optional[Path] = None,
        max_bytes: int = ROTATION_MAX_BYTES,
        max_kept: int = 5,
    ) -> None:
        self._state_dir = Path(state_dir) if state_dir else _DEFAULT_STATE_DIR
        self._max_bytes = max_bytes
        self._max_kept = max_kept
        self._log_path = self._state_dir / "cron_errors.jsonl"
        self._ensure_state_dir()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def log_error(
        self,
        job_name: str,
        error: Exception,
        retry_count: int = 0,
        stack_trace: Optional[str] = None,
    ) -> None:
        """Log a cron job error to the JSONL file.

        Args:
            job_name: Name of the cron job that failed.
            error: The exception that occurred.
            retry_count: Number of retry attempts already made.
            stack_trace: Optional pre-formatted stack trace.
                         If not provided, traceback will be generated.
        """
        record = CronError.from_error(
            job_name=job_name,
            error=error,
            retry_count=retry_count,
            stack_trace=stack_trace,
        )

        # Check rotation before writing
        self._maybe_rotate()

        # Append the record to the JSONL file
        with open(self._log_path, "a", encoding="utf-8") as f:
            f.write(record.to_json() + "\n")

    def read_errors(
        self,
        job_name: Optional[str] = None,
        error_type: Optional[ErrorType] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Read errors from the log file with optional filtering.

        Args:
            job_name: Filter by job name.
            error_type: Filter by error type classification.
            limit: Maximum number of errors to return.

        Returns:
            List of error record dictionaries.
        """
        if not self._log_path.exists():
            return []

        results = []
        with open(self._log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if job_name and record.get("job_name") != job_name:
                    continue
                if error_type and record.get("error_type") != error_type.value:
                    continue

                results.append(record)
                if len(results) >= limit:
                    break

        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_state_dir(self) -> None:
        """Create the state directory if it doesn't exist."""
        self._state_dir.mkdir(parents=True, exist_ok=True)

    def _maybe_rotate(self) -> None:
        """Rotate the log file if needed (size or age-based)."""
        if not self._log_path.exists():
            return

        file_size = self._log_path.stat().st_size
        file_age = time.time() - self._log_path.stat().st_mtime

        should_rotate = (
            file_size >= self._max_bytes
            or file_age >= (ROTATION_WEEKS * 7 * 86400)
        )

        if should_rotate:
            self._rotate_file()

    def _rotate_file(self) -> None:
        """Rotate log files: shift existing archives and rename current."""
        # Remove oldest if at capacity
        archived = sorted(
            self._state_dir.glob("cron_errors.jsonl.*"),
            key=lambda p: p.name,
        )
        while len(archived) >= self._max_kept:
            oldest = archived.pop(0)
            oldest.unlink()

        # Shift existing archives up by one
        for i in range(len(archived), 0, -1):
            old = self._state_dir / f"cron_errors.jsonl.{i}"
            new = self._state_dir / f"cron_errors.jsonl.{i + 1}"
            if old.exists():
                old.rename(new)

        # Move current log to .1
        if self._log_path.exists():
            self._log_path.rename(self._state_dir / "cron_errors.jsonl.1")

    # ------------------------------------------------------------------
    # Backwards compatibility alias
    # ------------------------------------------------------------------

    def write_error(self, *args: Any, **kwargs: Any) -> None:
        """Alias for log_error (used by retry_logic.py)."""
        self.log_error(*args, **kwargs)


# ---------------------------------------------------------------------------
# Standalone usage (for quick testing)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger = ErrorLogger()
    logger.log_error(
        job_name="example",
        error=ConnectionError("network timeout"),
        retry_count=0,
    )
    print(f"Error logged to {logger._log_path}")
    print(f"Classification: {classify_error(ConnectionError('timeout'))}")
    print(f"Classification: {classify_error(ValueError('parse error'))}")
    print(f"Classification: {classify_error(Exception('duplicate entry'))}")
