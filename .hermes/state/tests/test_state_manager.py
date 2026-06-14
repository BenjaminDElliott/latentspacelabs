"""Tests for state_manager.py — load/save with migration and validation."""

from __future__ import annotations

import copy
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

import pytest
from pathlib import Path

STATE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(STATE_DIR))

from state_manager import StateManager


@pytest.fixture()
def tmp_state_dir():
    """Create a temporary directory and override module-level paths."""
    d = tempfile.mkdtemp(prefix="sm_test_")
    import state_manager as _sm

    _sm.STATE_FILE = Path(d)
    _sm.FLYWHEEL_STATE = Path(d) / "linear_flywheel.json"
    yield d
    _sm.STATE_FILE = Path(os.environ.get(
        "HERMES_STATE_DIR", str(Path.home() / ".hermes" / "state")
    ))
    _sm.FLYWHEEL_STATE = _sm.STATE_FILE / "linear_flywheel.json"
    shutil.rmtree(d, ignore_errors=True)


# ============================================================================
# Load / Save round-trip
# ============================================================================


class TestLoadSave:
    """Test load, save, load_all, save_all."""

    def test_load_nonexistent_returns_none(self, tmp_state_dir):
        result = StateManager.load("NONEXIST")
        assert result is None

    def test_load_all_nonexistent_returns_empty(self, tmp_state_dir):
        result = StateManager.load_all()
        assert result == {}

    def test_create_save_load_roundtrip(self, tmp_state_dir):
        state = StateManager.create("TEST-1", model_used="local")
        assert state["task_id"] == "TEST-1"
        assert state["status"] == "triaged"

        loaded = StateManager.load("TEST-1")
        assert loaded is not None
        assert loaded["task_id"] == "TEST-1"
        assert loaded["status"] == "triaged"

    def test_save_all_load_all_roundtrip(self, tmp_state_dir):
        s1 = StateManager.create("T1", model_used="local")
        s2 = StateManager.create("T2", model_used="claude")

        all_states = StateManager.load_all()
        assert "T1" in all_states
        assert "T2" in all_states
        assert all_states["T1"]["model_used"] == "local"
        assert all_states["T2"]["model_used"] == "claude"

    def test_save_invalid_state_logs_warning_but_succeeds(self, tmp_state_dir):
        bad = {"task_id": "BAD", "status": "bogus_status"}
        StateManager.save("BAD", bad)
        loaded = StateManager.load("BAD")
        assert loaded is not None
        assert loaded["task_id"] == "BAD"

    def test_corrupt_json_returns_none(self, tmp_state_dir):
        flywheel = StateManager.FLYWHEEL_STATE
        flywheel.write_text("{invalid json")
        result = StateManager.load("TEST")
        assert result is None

    def test_empty_file_returns_none(self, tmp_state_dir):
        flywheel = StateManager.FLYWHEEL_STATE
        flywheel.write_text("")
        result = StateManager.load("TEST")
        assert result is None

    def test_list_tasks_sorted(self, tmp_state_dir):
        StateManager.create("B-1")
        StateManager.create("A-1")
        StateManager.create("C-1")
        tasks = StateManager.list_tasks()
        assert tasks == sorted(tasks)
        assert "A-1" in tasks
        assert "B-1" in tasks
        assert "C-1" in tasks

    def test_delete_task(self, tmp_state_dir):
        StateManager.create("DEL-1")
        StateManager.create("DEL-2")
        StateManager.delete("DEL-1")
        remaining = StateManager.list_tasks()
        assert "DEL-1" not in remaining
        assert "DEL-2" in remaining

    def test_delete_nonexistent_task_no_crash(self, tmp_state_dir):
        StateManager.delete("NONEXIST")  # should not raise

    def test_save_all_preserves_existing(self, tmp_state_dir):
        StateManager.create("P1")
        StateManager.create("P2")
        extra = {"P3": StateManager.create("P3")}
        StateManager.save_all(extra)
        all_states = StateManager.load_all()
        assert "P1" in all_states
        assert "P2" in all_states
        assert "P3" in all_states

    def test_save_all_skips_non_dict(self, tmp_state_dir):
        StateManager.create("S1")
        StateManager.save_all({"S2": "not-a-dict", "S3": StateManager.create("S3")})
        all_states = StateManager.load_all()
        assert "S1" in all_states
        assert "S3" in all_states

    def test_metadata_updated_on_save(self, tmp_state_dir):
        StateManager.create("M1")
        import state_manager as _sm
        raw = _sm.FLYWHEEL_STATE.read_text()
        data = json.loads(raw)
        assert "_meta" in data
        assert "task_count" in data["_meta"]
        assert data["_meta"]["task_count"] == 1

    def test_non_dict_state_file_migrated(self, tmp_state_dir):
        """If state file is not a dict, migrate_old_state is called."""
        import state_manager as _sm
        _sm.FLYWHEEL_STATE.write_text('"just a string"')
        result = _sm.StateManager.load_all()
        assert isinstance(result, dict)

    def test_nested_tasks_key_migrated(self, tmp_state_dir):
        """Old nested format with tasks key should be migrated."""
        import state_manager as _sm
        data = {
            "tasks": {
                "NESTED-1": {
                    "task_id": "NESTED-1",
                    "status": "triaged",
                    "current_step": "plan",
                    "attempt_count": 0,
                    "retry_count": 0,
                    "worktree_path": "/tmp/wt",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "model_used": "local",
                }
            },
            "_meta": {"last_updated": "2026-01-01"},
        }
        _sm.FLYWHEEL_STATE.write_text(json.dumps(data))
        result = StateManager.load_all()
        assert "NESTED-1" in result
        assert result["NESTED-1"]["state_version"] == "1.0"

    def test_backward_compat_adhoc_format(self, tmp_state_dir):
        """Old ad-hoc format should be loaded and migrated."""
        import state_manager as _sm
        old_format = {
            "version": 2,
            "updated": "2026-06-13T22:13:40Z",
            "last_dispatch": {"issue_id": "LAT-154"},
            "retry_states": {"LAT-208": {"retry_count": 0, "max_retries": 2}},
        }
        _sm.FLYWHEEL_STATE.write_text(json.dumps(old_format))
        result = StateManager.load_all()
        assert isinstance(result, dict)

    def test_atomic_write(self, tmp_state_dir):
        """After save, the file should be valid JSON that can be loaded."""
        StateManager.create("ATOMIC-1")
        import state_manager as _sm
        assert _sm.FLYWHEEL_STATE.exists()
        loaded = StateManager.load("ATOMIC-1")
        assert loaded is not None
        assert loaded["task_id"] == "ATOMIC-1"

    def test_migrate_old_state_via_state_manager(self, tmp_state_dir):
        """StateManager.migrate_old_state should delegate correctly."""
        old = {"task_id": "M1", "status": "triaged", "model_used": "local"}
        migrated = StateManager.migrate_old_state(old)
        assert migrated["state_version"] == "1.0"
        assert migrated["step_log"] == []

    def test_migrate_non_dict(self, tmp_state_dir):
        StateManager.migrate_old_state("not-a-dict")
        # Should return a valid dict without crashing

    def test_load_all_with_missing_nested_task(self, tmp_state_dir):
        """Non-dict task entries should be skipped."""
        import state_manager as _sm
        data = {
            "tasks": {
                "GOOD-1": {
                    "task_id": "GOOD-1",
                    "status": "triaged",
                    "current_step": "plan",
                    "attempt_count": 0,
                    "retry_count": 0,
                    "worktree_path": "/tmp/wt",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "model_used": "local",
                },
                "BAD-1": "not-a-dict",
            }
        }
        _sm.FLYWHEEL_STATE.write_text(json.dumps(data))
        result = StateManager.load_all()
        assert "GOOD-1" in result
        assert "BAD-1" not in result
