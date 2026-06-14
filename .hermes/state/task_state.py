"""TaskState TypedDict schema for Agentic Loops Improvement.

Defines a typed state schema replacing ad-hoc JSON for managing
agentic task lifecycle. Supports status validation, Pydantic v2
serialization/deserialization, and JSON conversion.

See also: https://linear.app/latentspacelabs/issue/LAT-211
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional, TypedDict


# ---------------------------------------------------------------------------
# Status enum
# ---------------------------------------------------------------------------

class TaskStatus(str, Enum):
    """Valid lifecycle statuses for a TaskState.

    Order reflects the natural progression:
        triaged -> planned -> in-progress -> reviewing -> (retrying / done / failed)
    """

    TRIAGED = "triaged"
    PLANNED = "planned"
    IN_PROGRESS = "in-progress"
    REVIEWING = "reviewing"
    RETRYING = "retrying"
    DONE = "done"
    FAILED = "failed"

    @classmethod
    def valid_values(cls) -> list[str]:
        """Return the list of all valid status string values."""
        return [s.value for s in cls]

    @classmethod
    def is_valid(cls, value: str) -> bool:
        """Check whether *value* is a recognized status."""
        return value in cls._value2member_map_


# ---------------------------------------------------------------------------
# TypedDict
# ---------------------------------------------------------------------------

class TaskState(TypedDict, total=False):
    """TypedDict describing the state of an agentic loop task.

    All fields except *task_id* and *created_at* carry defaults so callers
    can construct a minimal state and incrementally populate it.
    """

    # --- identity ---
    task_id: str
    status: str
    current_step: str

    # --- counters ---
    attempt_count: int
    retry_count: int
    step_count: int
    max_steps: int

    # --- scoring / feedback ---
    last_score: Optional[float]
    last_feedback: Optional[str]

    # --- environment ---
    worktree_path: str

    # --- timestamps (ISO-8601 strings) ---
    created_at: str
    updated_at: str

    # --- model info ---
    model_used: Optional[str]

    # --- step log ---
    step_log: list[dict[str, Any]]

    # --- error ---
    error: Optional[str]


# --- sensible defaults ---------------------------------------------------

_DEFAULTS: dict[str, Any] = {
    "status": TaskStatus.TRIAGED,
    "current_step": "",
    "attempt_count": 0,
    "retry_count": 0,
    "step_count": 0,
    "max_steps": 100,
    "last_score": None,
    "last_feedback": None,
    "worktree_path": "",
    "model_used": None,
    "step_log": [],
    "error": None,
}


def _now_iso() -> str:
    """Return the current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def create_task_state(task_id: str, worktree_path: str = "") -> TaskState:
    """Return a fresh TaskState ready for use.

    Args:
        task_id: Unique identifier for the task.
        worktree_path: Path to the worktree (if any).

    Returns:
        A TaskState with *task_id* and *created_at* set, all other fields
        populated with sensible defaults.
    """
    now = _now_iso()
    state: TaskState = {
        "task_id": task_id,
        "worktree_path": worktree_path,
        "created_at": now,
    }
    for key, default in _DEFAULTS.items():
        if key not in state:
            state[key] = default  # type: ignore[literal-required]
    state["updated_at"] = now  # type: ignore[literal-required]
    return state


# ---------------------------------------------------------------------------
# Pydantic v2 models
# ---------------------------------------------------------------------------

try:
    from pydantic import BaseModel, Field, field_validator

    _PYDANTIC_AVAILABLE = True
except ImportError:
    _PYDANTIC_AVAILABLE = False


if _PYDANTIC_AVAILABLE:

    class StepEntry(BaseModel):
        """A single entry in the step_log."""

        step: str = ""
        result: str = ""
        timestamp: str = ""

        model_config = {"extra": "forbid"}

    class TaskStateModel(BaseModel):
        """Pydantic v2 model for TaskState validation & serialization."""

        task_id: str = Field(..., min_length=1)
        status: TaskStatus = TaskStatus.TRIAGED
        current_step: str = ""
        attempt_count: int = Field(default=0, ge=0)
        retry_count: int = Field(default=0, ge=0)
        step_count: int = Field(default=0, ge=0)
        max_steps: int = Field(default=100, ge=1)
        last_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
        last_feedback: Optional[str] = None
        worktree_path: str = ""
        created_at: str = Field(default_factory=_now_iso)
        updated_at: str = Field(default_factory=_now_iso)
        model_used: Optional[str] = None
        step_log: list[StepEntry] = Field(default_factory=list)
        error: Optional[str] = None

        @field_validator("status")
        @classmethod
        def validate_status(cls, v: TaskStatus) -> TaskStatus:
            """Ensure status is one of the allowed values."""
            if v not in TaskStatus:
                raise ValueError(
                    f"Invalid status: {v!r}. Must be one of {TaskStatus.valid_values()}"
                )
            return v

        @field_validator("model_used")
        @classmethod
        def validate_model_used(cls, v: Optional[str]) -> Optional[str]:
            """Allow None, 'local', 'claude', or any custom string."""
            if v is None:
                return None
            stripped = v.strip()
            if len(stripped) == 0:
                return ""
            return v

        model_config = {"extra": "allow"}

        def to_task_state(self) -> TaskState:
            """Convert the Pydantic model into a plain TaskState dict."""
            step_log_raw: list[dict[str, Any]] = []
            for entry in self.step_log:
                step_log_raw.append(
                    {
                        "step": entry.step,
                        "result": entry.result,
                        "timestamp": entry.timestamp,
                    }
                )
            return {
                "task_id": self.task_id,
                "status": self.status.value,
                "current_step": self.current_step,
                "attempt_count": self.attempt_count,
                "retry_count": self.retry_count,
                "step_count": self.step_count,
                "max_steps": self.max_steps,
                "last_score": self.last_score,
                "last_feedback": self.last_feedback,
                "worktree_path": self.worktree_path,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
                "model_used": self.model_used,
                "step_log": step_log_raw,
                "error": self.error,
            }

        @classmethod
        def from_task_state(cls, state: TaskState) -> "TaskStateModel":
            """Construct a Pydantic model from a TaskState dict."""
            data: dict[str, Any] = dict(state)
            # Convert step_log dicts into StepEntry models
            step_log_entries: list[StepEntry] = []
            raw_log: list[dict[str, Any]] = data.pop("step_log", [])
            for entry in raw_log:
                step_log_entries.append(
                    StepEntry(
                        step=entry.get("step", ""),
                        result=entry.get("result", ""),
                        timestamp=entry.get("timestamp", ""),
                    )
                )
            data["step_log"] = step_log_entries

            # Convert string status to enum
            status_val = data.get("status")
            if isinstance(status_val, str):
                if status_val in TaskStatus._value2member_map_:
                    data["status"] = TaskStatus(status_val)
                else:
                    raise ValueError(
                        f"Invalid status: {status_val!r}. "
                        f"Must be one of {TaskStatus.valid_values()}"
                    )

            return cls(**data)


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------

def state_to_json(state: TaskState | Any) -> str:
    """Serialize a TaskState to a JSON string.

    Accepts either a raw TaskState dict or a TaskStateModel Pydantic model.

    Args:
        state: The state to serialize.

    Returns:
        Pretty-printed JSON string.
    """
    if _PYDANTIC_AVAILABLE and hasattr(state, "model_dump_json"):
        # It's a Pydantic model
        return state.model_dump_json(indent=2)  # type: ignore[union-attr]
    # Raw TaskState dict -> round-trip through Pydantic model
    if _PYDANTIC_AVAILABLE:
        state_obj = TaskStateModel.from_task_state(state)  # type: ignore[name-defined]
        return state_obj.model_dump_json(indent=2)  # type: ignore[union-attr]
    return json.dumps(state, indent=2, default=str)


def state_from_json(json_str: str) -> Any:
    """Deserialize a JSON string into a TaskStateModel.

    Args:
        json_str: JSON string representation of a TaskState.

    Returns:
        A Pydantic v2 TaskStateModel instance (or raw dict if Pydantic is not available).
    """
    data = json.loads(json_str)
    if _PYDANTIC_AVAILABLE:
        return TaskStateModel.from_task_state(data)  # type: ignore[name-defined]
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

__all__ = [
    "TaskState",
    "TaskStatus",
    "create_task_state",
    "state_to_json",
    "state_from_json",
    "_PYDANTIC_AVAILABLE",
]

if _PYDANTIC_AVAILABLE:
    __all__.extend(["TaskStateModel", "StepEntry"])
