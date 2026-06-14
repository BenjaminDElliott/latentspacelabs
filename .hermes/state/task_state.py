"""
TaskState TypedDict schema for the Hermes flywheel.

Status flow:
    triaged → planned → in-progress → reviewing → [retrying]* → done|failed

    * Can loop through retrying multiple times before moving to done or failed.

This module defines the canonical TaskState schema used by all cron jobs and
the dispatch system.  It replaces the prior ad-hoc JSON format with a typed,
validated schema while remaining backward-compatible with older state dicts
through the migrate_old_state() helper.
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from typing_extensions import TypedDict
else:
    try:
        from typing import NotRequired, TypedDict
    except ImportError:
        from typing_extensions import NotRequired, TypedDict

from typing import TypedDict, NotRequired

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_STATUSES: tuple[str, ...] = (
    "triaged",
    "planned",
    "in-progress",
    "reviewing",
    "retrying",
    "done",
    "failed",
)

VALID_MODEL_USED: tuple[str, ...] = ("local", "claude")

VALID_STEP_RESULTS: tuple[str, ...] = ("ok", "fail", "error")

VALID_ERROR_TYPES: tuple[str, ...] = (
    "max_steps_exceeded",
    "mqa_failed",
    "tool_error",
    "timeout",
)

STATE_VERSION = "1.0"

# Required (always-present) field names — everything else is NotRequired.
REQUIRED_FIELDS: tuple[str, ...] = (
    "task_id",
    "status",
    "current_step",
    "attempt_count",
    "retry_count",
    "worktree_path",
    "created_at",
    "updated_at",
    "model_used",
)

# Default values for every NotRequired field.
_FIELD_DEFAULTS: dict[str, object] = {
    "last_score": None,
    "last_feedback": None,
    "step_log": [],
    "remaining_steps": None,
    "max_steps": None,
    "mqa_metadata": {
        "score": None,
        "criteria": {},
        "threshold": None,
        "feedback": None,
    },
    "retry_metadata": {
        "retry_count": None,
        "max_retries": None,
        "retry_history": [],
    },
    "error": None,
    "error_type": None,
}

# ---------------------------------------------------------------------------
# TypedDict definitions
# ---------------------------------------------------------------------------


class StepLogEntry(TypedDict):
    """Single entry in a step log."""

    step: str
    result: str  # "ok" | "fail" | "error"
    timestamp: str  # ISO-8601 format
    duration_ms: NotRequired[int]
    error: NotRequired[str]


class MQAMetadata(TypedDict):
    """Metadata for multi-quality-assessment (MQA) evaluation."""

    score: NotRequired[float]
    criteria: NotRequired[dict]
    threshold: NotRequired[int]
    feedback: NotRequired[str]


class RetryMetadata(TypedDict):
    """Metadata about retry attempts."""

    retry_count: NotRequired[int]
    max_retries: NotRequired[int]
    retry_history: NotRequired[list]


class TaskState(TypedDict):
    """Canonical state for a Hermes-flywheel task.

    Required fields:
        task_id, status, current_step, attempt_count, retry_count,
        worktree_path, created_at, updated_at, model_used.

    Optional fields carry sensible defaults via migrate_old_state / json_to_state.
    """

    task_id: str
    status: str  # one of VALID_STATUSES
    current_step: str
    attempt_count: int
    retry_count: int
    last_score: NotRequired[float | None]
    last_feedback: NotRequired[str | None]
    worktree_path: str
    created_at: str  # ISO
    updated_at: str  # ISO
    model_used: str  # "local" | "claude"
    step_log: NotRequired[list[StepLogEntry]]
    remaining_steps: NotRequired[int]
    max_steps: NotRequired[int]
    mqa_metadata: NotRequired[MQAMetadata]
    retry_metadata: NotRequired[RetryMetadata]
    error: NotRequired[str]
    error_type: NotRequired[str]  # see VALID_ERROR_TYPES


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def state_to_json(state: TaskState) -> dict:
    """Return a serialisable dict representation of *state*.

    Always includes ``state_version`` at the top level.
    """
    data = dict(state)
    data["state_version"] = STATE_VERSION
    return data


def json_to_state(data: dict) -> TaskState:
    """Convert a dict (typically loaded from JSON) into a TaskState.

    Missing NotRequired fields are filled with their defaults.  The
    ``state_version`` field, if present, is copied through.
    """
    result: dict = {}

    # Copy required fields (will raise KeyError if absent).
    for key in REQUIRED_FIELDS:
        if key not in data:
            raise ValueError(f"Missing required field in state: {key!r}")
        result[key] = data[key]

    # Merge defaults for optional fields.
    for key, default in _FIELD_DEFAULTS.items():
        result.setdefault(key, copy.deepcopy(default))

    # state_version — copy from input if present, else default.
    result["state_version"] = data.get("state_version", STATE_VERSION)

    return result  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Migration helper
# ---------------------------------------------------------------------------


def migrate_old_state(old: dict) -> dict:
    """Add missing fields to an ad-hoc (pre-schema) state dict.

    This is the primary backward-compatibility bridge: any dict that
    contains the required keys will be normalised by filling in all
    NotRequired fields with sensible defaults.

    Returns a *new* dict with the migrated structure.
    """
    migrated: dict = dict(old)

    # Always inject state_version.
    migrated["state_version"] = migrated.get("state_version", STATE_VERSION)

    # Ensure status is one of the recognised values.
    if "status" in migrated and migrated["status"] not in VALID_STATUSES:
        migrated["_status_was"] = migrated["status"]  # keep original
        migrated["status"] = "triaged"

    # Ensure model_used is valid.
    if "model_used" in migrated and migrated["model_used"] not in VALID_MODEL_USED:
        migrated["_model_was"] = migrated["model_used"]  # keep original
        migrated["model_used"] = "local"

    # Fill optional fields that are missing.
    for key, default in _FIELD_DEFAULTS.items():
        if key not in migrated:
            migrated[key] = copy.deepcopy(default)

    return migrated


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_state(state: dict) -> tuple[bool, list[str]]:
    """Validate a dict against the TaskState schema.

    Returns:
        (is_valid, errors) where *errors* is a list of human-readable
        violation messages.  The list is empty when *is_valid* is True.
    """
    errors: list[str] = []

    # --- type-level checks ---
    if not isinstance(state, dict):
        return False, ["state must be a dict"]

    # --- required fields ---
    for field in REQUIRED_FIELDS:
        if field not in state:
            errors.append(f"missing required field: {field!r}")

    # --- state_version ---
    if state.get("state_version") is not None:
        if not isinstance(state["state_version"], str):
            errors.append("state_version must be a string")

    # --- status enum ---
    status = state.get("status")
    if status is not None:
        if status not in VALID_STATUSES:
            errors.append(
                f"status {status!r} not valid; must be one of {VALID_STATUSES}"
            )

    # --- model_used enum ---
    model = state.get("model_used")
    if model is not None:
        if model not in VALID_MODEL_USED:
            errors.append(
                f"model_used {model!r} not valid; must be one of {VALID_MODEL_USED}"
            )

    # --- error_type enum ---
    error_type = state.get("error_type")
    if error_type is not None:
        if error_type not in VALID_ERROR_TYPES:
            errors.append(
                f"error_type {error_type!r} not valid; "
                f"must be one of {VALID_ERROR_TYPES}"
            )

    # --- attempt_count, retry_count must be int ---
    for int_field in ("attempt_count", "retry_count"):
        val = state.get(int_field)
        if val is not None and not isinstance(val, int):
            errors.append(f"{int_field} must be an integer, got {type(val).__name__}")

    # --- ISO date check (best-effort) ---
    for date_field in ("created_at", "updated_at"):
        val = state.get(date_field)
        if val is not None:
            if not isinstance(val, str):
                errors.append(f"{date_field} must be a string")
            else:
                try:
                    datetime.fromisoformat(val)
                except (ValueError, TypeError):
                    errors.append(
                        f"{date_field} {val!r} is not a valid ISO-8601 date"
                    )

    # --- step_log entries ---
    step_log = state.get("step_log")
    if step_log is not None:
        if not isinstance(step_log, list):
            errors.append("step_log must be a list")
        else:
            for idx, entry in enumerate(step_log):
                if not isinstance(entry, dict):
                    errors.append(f"step_log[{idx}] must be a dict")
                    continue
                for req in ("step", "result", "timestamp"):
                    if req not in entry:
                        errors.append(
                            f"step_log[{idx}] missing required field {req!r}"
                        )
                res = entry.get("result")
                if res is not None and res not in VALID_STEP_RESULTS:
                    errors.append(
                        f"step_log[{idx}].result {res!r} not in {VALID_STEP_RESULTS}"
                    )

    # --- mqa_metadata sub-checks ---
    mqa = state.get("mqa_metadata")
    if mqa is not None and not isinstance(mqa, dict):
        errors.append("mqa_metadata must be a dict or absent")

    # --- retry_metadata sub-checks ---
    retry_meta = state.get("retry_metadata")
    if retry_meta is not None and not isinstance(retry_meta, dict):
        errors.append("retry_metadata must be a dict or absent")

    return (len(errors) == 0, errors)


# ---------------------------------------------------------------------------
# Convenience: build a fresh (empty) state ready for population.
# ---------------------------------------------------------------------------


def create_empty_state(task_id: str, model_used: str = "local") -> TaskState:
    """Return a freshly initialised TaskState with defaults for everything except
    *task_id* and *now*.

    Parameters:
        task_id: unique identifier for the task.
        model_used: either "local" or "claude".

    Returns:
        A TaskState dict ready for the agent to populate.
    """
    now = datetime.now(timezone.utc).isoformat()
    return {
        "state_version": STATE_VERSION,
        "task_id": task_id,
        "status": "triaged",
        "current_step": "",
        "attempt_count": 0,
        "retry_count": 0,
        "last_score": None,
        "last_feedback": None,
        "worktree_path": "",
        "created_at": now,
        "updated_at": now,
        "model_used": model_used,
        "step_log": [],
        "remaining_steps": None,
        "max_steps": None,
        "mqa_metadata": {
            "score": None,
            "criteria": {},
            "threshold": None,
            "feedback": None,
        },
        "retry_metadata": {
            "retry_count": None,
            "max_retries": None,
            "retry_history": [],
        },
        "error": None,
        "error_type": None,
    }


# ---------------------------------------------------------------------------
# Self-test (run with: python task_state.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    _counts = [0, 0]  # [passed, failed]

    def check(name: str, condition: bool) -> None:
        if condition:
            _counts[0] += 1
        else:
            _counts[1] += 1
            print(f"  FAIL: {name}")

    # --- test validate_state ---
    good, errs = validate_state(create_empty_state("TEST-1"))
    check("valid fresh state", good and not errs)

    bad, errs = validate_state({"task_id": "X", "status": "bogus"})
    check("rejects bad status", not bad and any("status" in e for e in errs))

    # --- test json round-trip ---
    orig = create_empty_state("TEST-2")
    d = state_to_json(orig)
    restored = json_to_state(d)
    check("json round-trip", restored["task_id"] == "TEST-2")

    # --- test migration ---
    old = {"task_id": "OLD-1", "status": "triaged", "model_used": "local"}
    migrated = migrate_old_state(old)
    check("migration fills defaults", migrated["step_log"] == [] and migrated["state_version"] == STATE_VERSION)

    # --- test create_empty_state model_used ---
    empty = create_empty_state("T3", model_used="claude")
    check("create_empty model_used", empty["model_used"] == "claude")

    # --- test migration of old status ---
    weird = {"task_id": "W", "status": "unknown_status", "model_used": "unknown_model"}
    mig2 = migrate_old_state(weird)
    check("migration normalises status", mig2["status"] == "triaged")
    check("migration preserves original status", mig2.get("_status_was") == "unknown_status")

    print(f"\n{_counts[0]} passed, {_counts[1]} failed")
    sys.exit(0 if _counts[1] == 0 else 1)
