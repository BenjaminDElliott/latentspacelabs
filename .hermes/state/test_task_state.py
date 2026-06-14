"""Unit tests for the TaskState TypedDict schema.

Run with:
    pytest .hermes/state/test_task_state.py -v
"""

import json
import sys
from pathlib import Path

import pytest

# Ensure the package parent is importable regardless of cwd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from .task_state import (
    TaskState,
    TaskStatus,
    TaskStateModel,
    StepEntry,
    create_task_state,
    state_to_json,
    state_from_json,
)


# ---------------------------------------------------------------------------
# Status enum tests
# ---------------------------------------------------------------------------

class TestTaskStatus:
    """Tests for the TaskStatus enum."""

    def test_all_statuses_present(self):
        """All seven lifecycle statuses must exist."""
        expected = {"triaged", "planned", "in-progress", "reviewing", "retrying", "done", "failed"}
        actual = {s.value for s in TaskStatus}
        assert actual == expected

    def test_valid_values(self):
        """valid_values() returns the list of status strings."""
        vals = TaskStatus.valid_values()
        assert isinstance(vals, list)
        assert len(vals) == 7
        assert "triaged" in vals
        assert "done" in vals

    def test_is_valid_true(self):
        """is_valid returns True for known statuses."""
        assert TaskStatus.is_valid("triaged") is True
        assert TaskStatus.is_valid("done") is True
        assert TaskStatus.is_valid("in-progress") is True

    def test_is_valid_false(self):
        """is_valid returns False for unknown statuses."""
        assert TaskStatus.is_valid("unknown") is False
        assert TaskStatus.is_valid("") is False
        assert TaskStatus.is_valid("DONE") is False  # case-sensitive

    def test_enum_str_equality(self):
        """Enum members compare equal to their string values."""
        assert TaskStatus.DONE.value == "done"
        assert TaskStatus.TRIAGED.value == "triaged"


# ---------------------------------------------------------------------------
# create_task_state tests
# ---------------------------------------------------------------------------

class TestCreateTaskState:
    """Tests for the create_task_state factory."""

    def test_basic_creation(self):
        """A basic task state has required fields."""
        state = create_task_state(task_id="test-001", worktree_path="/tmp/ws")
        assert state["task_id"] == "test-001"
        assert state["status"] == "triaged"
        assert state["created_at"] != ""
        assert state["updated_at"] != ""
        assert state["worktree_path"] == "/tmp/ws"

    def test_default_attempt_counts(self):
        """Counter fields start at zero."""
        state = create_task_state(task_id="test-002")
        assert state["attempt_count"] == 0
        assert state["retry_count"] == 0
        assert state["step_count"] == 0

    def test_default_max_steps(self):
        """max_steps defaults to 100."""
        state = create_task_state(task_id="test-003")
        assert state["max_steps"] == 100

    def test_default_optional_fields(self):
        """Optional fields start as None or empty."""
        state = create_task_state(task_id="test-004")
        assert state["last_score"] is None
        assert state["last_feedback"] is None
        assert state["model_used"] is None
        assert state["error"] is None
        assert state["step_log"] == []
        assert state["current_step"] == ""

    def test_timestamps_are_iso(self):
        """Timestamps are valid ISO-8601 strings."""
        state = create_task_state(task_id="test-005")
        from datetime import datetime, timezone
        datetime.fromisoformat(state["created_at"])
        datetime.fromisoformat(state["updated_at"])

    def test_updated_at_is_after_created_at(self):
        """updated_at should be >= created_at."""
        state = create_task_state(task_id="test-006")
        assert state["updated_at"] >= state["created_at"]

    def test_default_status_is_triaged(self):
        """New tasks start in triaged status."""
        state = create_task_state(task_id="test-007")
        assert state["status"] == "triaged"


# ---------------------------------------------------------------------------
# Pydantic model tests
# ---------------------------------------------------------------------------

class TestTaskStateModel:
    """Tests for the Pydantic v2 TaskStateModel."""

    def test_create_model_from_dict(self):
        """Constructing a model from a plain dict works."""
        raw: TaskState = {
            "task_id": "test-010",
            "status": "planned",
            "current_step": "analyze",
            "attempt_count": 0,
            "retry_count": 0,
            "step_count": 0,
            "max_steps": 50,
            "worktree_path": "/tmp/ws",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        model = TaskStateModel.from_task_state(raw)
        assert model.task_id == "test-010"
        assert model.status == TaskStatus.PLANNED
        assert model.attempt_count == 0

    def test_model_invalid_status_raises(self):
        """Invalid status string raises ValueError."""
        raw: TaskState = {
            "task_id": "test-011",
            "status": "invalid_status",
            "worktree_path": "/tmp/ws",
        }
        with pytest.raises(ValueError, match="Invalid status"):
            TaskStateModel.from_task_state(raw)

    def test_model_invalid_model_used_empty(self):
        """Whitespace model_used is stripped to empty string."""
        model = TaskStateModel(task_id="test-012", model_used="  ")
        assert model.model_used == ""

    def test_model_defaults(self):
        """Constructing a model with minimal fields applies defaults."""
        model = TaskStateModel(task_id="test-013")
        assert model.status == TaskStatus.TRIAGED
        assert model.attempt_count == 0
        assert model.retry_count == 0
        assert model.step_count == 0
        assert model.max_steps == 100
        assert model.last_score is None
        assert model.last_feedback is None
        assert model.worktree_path == ""
        assert model.model_used is None
        assert model.step_log == []
        assert model.error is None

    def test_model_step_count_ge_zero(self):
        """step_count must be >= 0."""
        with pytest.raises(ValueError):
            TaskStateModel(task_id="test-014", step_count=-1)

    def test_model_max_steps_ge_one(self):
        """max_steps must be >= 1."""
        with pytest.raises(ValueError):
            TaskStateModel(task_id="test-015", max_steps=0)

    def test_model_last_score_range(self):
        """last_score must be between 0.0 and 1.0."""
        model = TaskStateModel(task_id="test-016", last_score=0.5)
        assert model.last_score == 0.5

    def test_model_last_score_bounds(self):
        """last_score out of range raises ValueError."""
        with pytest.raises(ValueError):
            TaskStateModel(task_id="test-017", last_score=-0.1)
        with pytest.raises(ValueError):
            TaskStateModel(task_id="test-018", last_score=1.5)


class TestStepEntry:
    """Tests for the StepEntry model."""

    def test_step_entry_creation(self):
        """A StepEntry can be created with required fields."""
        entry = StepEntry(step="analyze", result="passed", timestamp="2026-01-01T00:00:00+00:00")
        assert entry.step == "analyze"
        assert entry.result == "passed"

    def test_step_entry_defaults(self):
        """StepEntry fields default to empty strings."""
        entry = StepEntry()
        assert entry.step == ""
        assert entry.result == ""
        assert entry.timestamp == ""

    def test_step_entry_extra_forbidden(self):
        """StepEntry rejects extra fields."""
        with pytest.raises(Exception):
            StepEntry(step="a", result="b", timestamp="c", extra_field="bad")


# ---------------------------------------------------------------------------
# Serialization / deserialization tests
# ---------------------------------------------------------------------------

class TestSerialization:
    """Tests for JSON round-trip serialization."""

    def test_state_to_json_raw_dict(self):
        """state_to_json accepts a raw TaskState dict."""
        state = create_task_state(task_id="test-020", worktree_path="/tmp/ws")
        json_str = state_to_json(state)
        data = json.loads(json_str)
        assert data["task_id"] == "test-020"
        assert data["status"] == "triaged"

    def test_state_to_json_pydantic_model(self):
        """state_to_json accepts a TaskStateModel."""
        model = TaskStateModel(task_id="test-021")
        json_str = state_to_json(model)
        data = json.loads(json_str)
        assert data["task_id"] == "test-021"

    def test_state_from_json(self):
        """state_from_json deserializes back to a TaskStateModel."""
        model = TaskStateModel(task_id="test-022")
        json_str = state_to_json(model)
        restored = state_from_json(json_str)
        assert isinstance(restored, TaskStateModel)
        assert restored.task_id == "test-022"

    def test_round_trip(self):
        """Full round-trip preserves all fields."""
        original = create_task_state(task_id="test-023", worktree_path="/tmp/ws")
        original["attempt_count"] = 2
        original["retry_count"] = 1
        original["last_score"] = 0.85
        original["last_feedback"] = "Good progress"
        original["model_used"] = "claude"
        original["step_log"] = [
            {"step": "plan", "result": "ok", "timestamp": "2026-01-01T00:00:00+00:00"},
            {"step": "execute", "result": "ok", "timestamp": "2026-01-01T01:00:00+00:00"},
        ]
        json_str = state_to_json(original)
        restored = state_from_json(json_str)

        assert restored.task_id == "test-023"
        assert restored.status == TaskStatus.TRIAGED
        assert restored.attempt_count == 2
        assert restored.retry_count == 1
        assert restored.last_score == 0.85
        assert restored.last_feedback == "Good progress"
        assert restored.model_used == "claude"
        assert restored.worktree_path == "/tmp/ws"
        assert len(restored.step_log) == 2
        assert restored.step_log[0].step == "plan"
        assert restored.step_log[1].result == "ok"

    def test_to_task_state_conversion(self):
        """TaskStateModel.to_task_state() returns a dict."""
        model = TaskStateModel(task_id="test-024")
        state = model.to_task_state()
        assert isinstance(state, dict)
        assert state["task_id"] == "test-024"
        assert state["status"] == "triaged"
        assert isinstance(state["step_log"], list)

    def test_json_indent(self):
        """state_to_json produces indented JSON."""
        model = TaskStateModel(task_id="test-025")
        json_str = state_to_json(model)
        assert "\n" in json_str  # indented = multi-line
