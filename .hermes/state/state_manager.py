"""
State management module for the Hermes flywheel.

Wraps JSON file I/O with TaskState validation, migration, and thread safety.

Usage::

    from state_manager import StateManager

    # Load a single task state
    state = StateManager.load("LAT-154")

    # Load all task states
    all_states = StateManager.load_all()

    # Save a task state
    StateManager.save("LAT-154", state)

    # Save all states
    StateManager.save_all(all_states)
"""

from __future__ import annotations

from datetime import datetime, timezone
import fcntl
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from task_state import (
    TaskState,
    create_empty_state,
    json_to_state,
    migrate_old_state,
    state_to_json,
    validate_state,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# File paths
# ---------------------------------------------------------------------------

STATE_FILE = Path(
    os.environ.get(
        "HERMES_STATE_DIR", str(Path.home() / ".hermes" / "state")
    )
)
FLYWHEEL_STATE = STATE_FILE / "linear_flywheel.json"

# State keys used inside linear_flywheel.json for per-task tracking.
_TASKS_KEY = "tasks"
_METADATA_KEY = "_meta"

# ---------------------------------------------------------------------------
# Helpers: file locking, atomic writes
# ---------------------------------------------------------------------------


def _acquire_lock(lock_path: Path) -> int:
    """Acquire an advisory file lock on *lock_path*. Returns the file descriptor."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_WRONLY, 0o644)
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fd
    except OSError as exc:
        logger.warning("Could not acquire lock %s: %s", lock_path, exc)
        return -1


def _release_lock(fd: int) -> None:
    """Release the advisory file lock on *fd*."""
    if fd < 0:
        return
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
    except OSError:
        pass


def _atomic_write(path: Path, content: str) -> None:
    """Write *content* to *path* atomically via a temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=path.parent, prefix=".flywheel_tmp_"
        )
        with os.fdopen(fd, "w") as fh:
            fh.write(content)
        os.replace(tmp_path, path)
    except OSError as exc:
        # Clean up temp file if it survived.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise exc


# ---------------------------------------------------------------------------
# StateManager
# ---------------------------------------------------------------------------


class StateManager:
    """Thread-safe state manager with validation and migration.

    All public methods are static and operate on the singleton
    ``FLYWHEEL_STATE`` file.  They use advisory file locking so that
    concurrent callers are serialized.
    """

    # ------------------------------------------------------------------
    # load / save (single task)
    # ------------------------------------------------------------------

    @staticmethod
    def load(task_id: str) -> Optional[TaskState]:
        """Load task state with migration and validation.

        Returns the *TaskState* for *task_id*, or ``None`` if the
        task is not found or the file is corrupt.
        """
        lock_path = STATE_FILE / ".flywheel.lock"
        fd = _acquire_lock(lock_path)
        try:
            if not FLYWHEEL_STATE.exists():
                logger.info("State file does not exist: %s", FLYWHEEL_STATE)
                return None

            raw = FLYWHEEL_STATE.read_text(encoding="utf-8")
            if not raw.strip():
                logger.warning("State file is empty: %s", FLYWHEEL_STATE)
                return None

            data = json.loads(raw)

            # --- migration on load ---
            if not isinstance(data, dict):
                logger.error(
                    "State file top-level is not a dict; "
                    "treating as ad-hoc state"
                )
                data = migrate_old_state({"_raw": raw})

            migrated = migrate_old_state(data)

            # --- validate ---
            is_valid, errors = validate_state(migrated)
            if not is_valid:
                logger.warning(
                    "State validation warnings (%d): %s",
                    len(errors),
                    errors,
                )

            # Extract task-level state if the file uses the nested format
            if _TASKS_KEY in data:
                task_data = data[_TASKS_KEY].get(task_id)
                if task_data is None:
                    return None
                task_data = migrate_old_state(task_data)
                is_valid, errors = validate_state(task_data)
                if not is_valid:
                    logger.warning(
                        "Task %s validation warnings (%d): %s",
                        task_id,
                        len(errors),
                        errors,
                    )
                return task_data  # type: ignore[return-value]

            # Top-level state: treat as the single task's state
            if data.get("task_id") == task_id:
                return migrated  # type: ignore[return-value]

            # task_id not found in nested format either
            return None
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to load state: %s", exc)
            return None
        finally:
            _release_lock(fd)

    @staticmethod
    def save(task_id: str, state: TaskState) -> None:
        """Save task state with validation."""
        lock_path = STATE_FILE / ".flywheel.lock"
        fd = _acquire_lock(lock_path)
        try:
            # Validate before writing.
            is_valid, errors = validate_state(state)
            if not is_valid:
                logger.warning(
                    "Validation warnings before save (%d): %s",
                    len(errors),
                    errors,
                )

            # Build or read the file.
            if FLYWHEEL_STATE.exists():
                try:
                    raw = FLYWHEEL_STATE.read_text(encoding="utf-8")
                    data: dict = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    logger.warning("Corrupt state file; starting fresh")
                    data = {_TASKS_KEY: {}, _METADATA_KEY: {}}
            else:
                data = {_TASKS_KEY: {}, _METADATA_KEY: {}}

            if _TASKS_KEY not in data:
                data[_TASKS_KEY] = {}
            data[_TASKS_KEY][task_id] = dict(state)

            # Update metadata.
            data[_METADATA_KEY] = {
                **data.get(_METADATA_KEY, {}),
                "last_updated": state.get(
                    "updated_at",
                    state.get("created_at"),
                ),
                "task_count": len(data[_TASKS_KEY]),
            }

            content = json.dumps(data, indent=2, ensure_ascii=False)
            _atomic_write(FLYWHEEL_STATE, content)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to save state for %s: %s", task_id, exc)
        finally:
            _release_lock(fd)

    # ------------------------------------------------------------------
    # load_all / save_all
    # ------------------------------------------------------------------

    @staticmethod
    def load_all() -> dict:
        """Load all task states from linear_flywheel.json.

        Returns a dict of ``{task_id: TaskState}``.
        """
        lock_path = STATE_FILE / ".flywheel.lock"
        fd = _acquire_lock(lock_path)
        try:
            if not FLYWHEEL_STATE.exists():
                logger.info("State file does not exist: %s", FLYWHEEL_STATE)
                return {}

            raw = FLYWHEEL_STATE.read_text(encoding="utf-8")
            if not raw.strip():
                logger.warning("State file is empty: %s", FLYWHEEL_STATE)
                return {}

            data = json.loads(raw)

            if not isinstance(data, dict):
                logger.error("State file top-level is not a dict")
                return {}

            # Migrate the entire file.
            migrated = migrate_old_state(data)

            tasks: dict = {}
            task_map = migrated.get(_TASKS_KEY, {})
            if isinstance(task_map, dict):
                for tid, raw_task in task_map.items():
                    if not isinstance(raw_task, dict):
                        logger.warning(
                            "Skipping non-dict task entry for %s", tid
                        )
                        continue
                    migrated_task = migrate_old_state(raw_task)
                    is_valid, errors = validate_state(migrated_task)
                    if not is_valid:
                        logger.warning(
                            "Task %s validation warnings (%d): %s",
                            tid,
                            len(errors),
                            errors,
                        )
                    tasks[tid] = migrated_task  # type: ignore[assignment]
            else:
                # No nested tasks key: treat the whole file as one task.
                if "task_id" in migrated:
                    tasks[migrated["task_id"]] = migrated  # type: ignore[assignment]

            return tasks
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to load all states: %s", exc)
            return {}
        finally:
            _release_lock(fd)

    @staticmethod
    def save_all(states: dict) -> None:
        """Save all task states to linear_flywheel.json."""
        lock_path = STATE_FILE / ".flywheel.lock"
        fd = _acquire_lock(lock_path)
        try:
            if FLYWHEEL_STATE.exists():
                try:
                    raw = FLYWHEEL_STATE.read_text(encoding="utf-8")
                    data: dict = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    logger.warning("Corrupt state file; starting fresh")
                    data = {_TASKS_KEY: {}, _METADATA_KEY: {}}
            else:
                data = {_TASKS_KEY: {}, _METADATA_KEY: {}}

            if _TASKS_KEY not in data:
                data[_TASKS_KEY] = {}

            for task_id, state in states.items():
                # Validate each state before writing.
                if isinstance(state, dict):
                    is_valid, errors = validate_state(state)
                    if not is_valid:
                        logger.warning(
                            "Task %s validation warnings (%d): %s",
                            task_id,
                            len(errors),
                            errors,
                        )
                    data[_TASKS_KEY][task_id] = state
                else:
                    logger.warning(
                        "Skipping non-dict state for task %s", task_id
                    )

            # Update metadata.
            data[_METADATA_KEY] = {
                **data.get(_METADATA_KEY, {}),
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "task_count": len(data[_TASKS_KEY]),
            }

            content = json.dumps(data, indent=2, ensure_ascii=False)
            _atomic_write(FLYWHEEL_STATE, content)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to save all states: %s", exc)
        finally:
            _release_lock(fd)

    # ------------------------------------------------------------------
    # Migration
    # ------------------------------------------------------------------

    @staticmethod
    def migrate_old_state(old_data: dict) -> dict:
        """Migrate pre-schema state to new format.

        Delegates to ``task_state.migrate_old_state`` and returns the
        migrated dict.  If *old_data* is not a dict, returns an empty
        migrated state.
        """
        if not isinstance(old_data, dict):
            return migrate_old_state({"task_id": "unknown", "status": "triaged"})
        return migrate_old_state(old_data)

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    @staticmethod
    def create(task_id: str, model_used: str = "local") -> TaskState:
        """Create a fresh task state and persist it immediately."""
        state = create_empty_state(task_id, model_used)
        StateManager.save(task_id, state)
        return state

    @staticmethod
    def delete(task_id: str) -> None:
        """Remove a task state from the state file."""
        lock_path = STATE_FILE / ".flywheel.lock"
        fd = _acquire_lock(lock_path)
        try:
            if not FLYWHEEL_STATE.exists():
                return

            raw = FLYWHEEL_STATE.read_text(encoding="utf-8")
            data = json.loads(raw)

            tasks = data.get(_TASKS_KEY, {})
            if task_id in tasks:
                del tasks[task_id]
                data[_TASKS_KEY] = tasks

                data[_METADATA_KEY] = {
                    **data.get(_METADATA_KEY, {}),
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                    "task_count": len(tasks),
                }

                content = json.dumps(data, indent=2, ensure_ascii=False)
                _atomic_write(FLYWHEEL_STATE, content)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to delete task %s: %s", task_id, exc)
        finally:
            _release_lock(fd)

    # ------------------------------------------------------------------
    # Inspect
    # ------------------------------------------------------------------

    @staticmethod
    def list_tasks() -> list[str]:
        """Return a sorted list of task IDs currently tracked in state."""
        all_states = StateManager.load_all()
        return sorted(all_states.keys())


# ---------------------------------------------------------------------------
# Self-test (run with: python state_manager.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import shutil
    from datetime import datetime as _dt, timezone as _tz

    # Use a temporary directory so we don't clobber the real state file.
    _tmp_dir = Path(tempfile.mkdtemp(prefix="sm_test_"))
    _test_flywheel = _tmp_dir / "linear_flywheel.json"
    _test_lock = _tmp_dir / ".flywheel.lock"

    # Temporarily override the module-level paths.
    import state_manager as _sm

    _old_state_file = _sm.STATE_FILE
    _old_flywheel = _sm.FLYWHEEL_STATE

    _sm.STATE_FILE = _tmp_dir
    _sm.FLYWHEEL_STATE = _test_flywheel

    _counts = [0, 0]  # [passed, failed]

    def check(name: str, condition: bool) -> None:
        if condition:
            _counts[0] += 1
        else:
            _counts[1] += 1
            print(f"  FAIL: {name}")

    try:
        # --- Test 1: load from nonexistent file returns None ---
        result = _sm.StateManager.load("NONEXIST")
        check("load nonexistent -> None", result is None)

        # --- Test 2: load_all from nonexistent file returns {} ---
        result = _sm.StateManager.load_all()
        check("load_all nonexistent -> {}", result == {})

        # --- Test 3: create + save + load round-trip ---
        state = _sm.StateManager.create("TEST-1", model_used="local")
        check("create returns TaskState", "task_id" in state and state["task_id"] == "TEST-1")

        loaded = _sm.StateManager.load("TEST-1")
        check("load saved state", loaded is not None and loaded["task_id"] == "TEST-1")
        check("load preserves status", loaded["status"] == "triaged")

        # --- Test 4: save_all + load_all round-trip ---
        state2 = _sm.StateManager.create("TEST-2", model_used="claude")
        all_states = _sm.StateManager.load_all()
        check("load_all has both tasks", "TEST-1" in all_states and "TEST-2" in all_states)
        check("load_all TEST-2 status", all_states["TEST-2"]["status"] == "triaged")

        # --- Test 5: invalid data handled gracefully ---
        _test_flywheel.write_text("{invalid json")
        result = _sm.StateManager.load("TEST-1")
        check("corrupt JSON returns None", result is None)

        # Write back valid data for remaining tests.
        _sm.StateManager.create("TEST-1", model_used="local")
        _sm.StateManager.create("TEST-2", model_used="claude")

        # --- Test 6: migrate_old_state on ad-hoc dict ---
        old = {"task_id": "OLD-1", "status": "triaged", "model_used": "local"}
        migrated = _sm.StateManager.migrate_old_state(old)
        check("migration adds step_log", migrated.get("step_log") == [])
        check("migration adds state_version", "state_version" in migrated)

        # --- Test 7: list_tasks ---
        tasks = _sm.StateManager.list_tasks()
        check("list_tasks returns sorted list", tasks == sorted(tasks))
        check("list_tasks includes TEST-1", "TEST-1" in tasks)

        # --- Test 8: delete ---
        _sm.StateManager.delete("TEST-2")
        remaining = _sm.StateManager.list_tasks()
        check("delete removes task", "TEST-2" not in remaining and "TEST-1" in remaining)

        # --- Test 9: save invalid state (validation warnings) ---
        bad_state = {"task_id": "BAD-1", "status": "bogus_status"}
        # This should log a warning but not crash.
        _sm.StateManager.save("BAD-1", bad_state)
        loaded_bad = _sm.StateManager.load("BAD-1")
        check("save+load bad state survives", loaded_bad is not None)

        # --- Test 10: backward compat with old ad-hoc format ---
        old_format = {
            "version": 2,
            "updated": "2026-06-13T22:13:40Z",
            "last_dispatch": {"issue_id": "LAT-154"},
            "retry_states": {
                "LAT-208": {"retry_count": 0, "max_retries": 2}
            },
        }
        _test_flywheel.write_text(json.dumps(old_format))
        migrated_all = _sm.StateManager.load_all()
        check("backward compat: load_all on old format", isinstance(migrated_all, dict))

        # --- Test 11: atomic write (temp file exists during write) ---
        _test_flywheel.unlink()
        _sm.StateManager.create("ATOMIC-1")
        check("atomic write creates file", _test_flywheel.exists())
        # Verify the file is valid JSON and can be loaded.
        loaded_atomic = _sm.StateManager.load("ATOMIC-1")
        check("atomic write is readable", loaded_atomic is not None)

        # --- Test 12: save_all preserves existing keys ---
        _sm.StateManager.create("PRESERVE-1")
        _sm.StateManager.create("PRESERVE-2")
        all_before = _sm.StateManager.load_all()
        _sm.StateManager.save_all({"PRESERVE-3": _sm.create_empty_state("PRESERVE-3")})
        all_after = _sm.StateManager.load_all()
        check("save_all preserves existing tasks", "PRESERVE-1" in all_after and "PRESERVE-3" in all_after)

    finally:
        # Restore original paths.
        _sm.STATE_FILE = _old_state_file
        _sm.FLYWHEEL_STATE = _old_flywheel
        # Clean up temp directory.
        shutil.rmtree(_tmp_dir, ignore_errors=True)

    print(f"\n{_counts[0]} passed, {_counts[1]} failed")
    sys.exit(0 if _counts[1] == 0 else 1)
