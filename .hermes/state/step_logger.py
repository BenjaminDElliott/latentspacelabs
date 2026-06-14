"""
Step logger for Hermes flywheel task execution.

Logs individual steps during task execution, enabling:
- Debugging infinite loops (see which step repeats)
- Performance profiling (which steps take longest)
- MQA feedback (which steps produced bad output)

Usage::

    from step_logger import StepLogger

    logger = StepLogger("LAT-214")
    logger.log_step("plan_task", "ok", duration_ms=150)
    logger.log_step("execute", "error", error="timeout", duration_ms=30000)
    log = logger.get_log()
    summary = logger.get_summary()

Integration with state_manager.py:
    from step_logger import StepLogger
    from state_manager import StateManager

    logger = StepLogger(task_id)
    # ... log steps during task execution ...
    state = StateManager.load(task_id)
    state["step_log"] = logger.get_log()
    StateManager.save(task_id, state)

Self-test: python step_logger.py
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Optional

from task_state import StepLogEntry

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    pass


class StepLogger:
    """Logs individual steps in task execution.

    Each logger is bound to a single task ID.  Steps are appended to
    an in-memory list with automatic truncation (last 50 entries) to
    prevent state files from growing unbounded.
    """

    MAX_LOG_ENTRIES = 50  # truncate to prevent file bloat

    def __init__(self, task_id: str) -> None:
        """Initialise a step logger for a given task.

        Args:
            task_id: Unique identifier for the task (e.g. ``"LAT-214"``).
        """
        self.task_id = task_id
        self.step_log: list[StepLogEntry] = []

    def log_step(
        self,
        step: str,
        result: str,
        error: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        """Log a single execution step.

        Args:
            step: Human-readable name of the step (e.g. ``"plan_task"``).
            result: Outcome — one of ``"ok"``, ``"fail"``, or ``"error"``.
            error: Optional error message when the step failed.
            duration_ms: Optional duration in milliseconds for profiling.
        """
        entry: StepLogEntry = {
            "step": step,
            "result": result,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if duration_ms is not None:
            entry["duration_ms"] = duration_ms
        if error is not None:
            entry["error"] = error
        self.step_log.append(entry)
        self._truncate()

    def _truncate(self) -> None:
        """Keep only the last MAX_LOG_ENTRIES entries."""
        if len(self.step_log) > self.MAX_LOG_ENTRIES:
            self.step_log = self.step_log[-self.MAX_LOG_ENTRIES :]

    def get_log(self) -> list[StepLogEntry]:
        """Return a *copy* of the step log."""
        return list(self.step_log)

    def get_summary(self) -> dict:
        """Return summary statistics over the logged steps.

        Returns a dict with keys:

        - ``total_steps`` (int): total number of steps logged
        - ``step_counts`` (dict): count per result value (ok / fail / error)
        - ``success_rate`` (float): fraction of steps with result == "ok"
        - ``avg_duration_ms`` (float | None): average duration across timed steps
        - ``max_duration_ms`` (int | None): max duration across timed steps
        - ``min_duration_ms`` (int | None): min duration across timed steps
        - ``errors`` (list[str]): error messages from errored/failed steps
        - ``most_common_step`` (str | None): the step name that appears most often
        """
        total = len(self.step_log)

        # Per-result counts.
        step_counts: dict[str, int] = {}
        for entry in self.step_log:
            res = entry.get("result", "unknown")
            step_counts[res] = step_counts.get(res, 0) + 1

        # Duration stats.
        durations: list[int] = [
            e["duration_ms"]
            for e in self.step_log
            if "duration_ms" in e and e["duration_ms"] is not None
        ]
        avg_dur: Optional[float] = (
            sum(durations) / len(durations) if durations else None
        )
        max_dur: Optional[int] = max(durations) if durations else None
        min_dur: Optional[int] = min(durations) if durations else None

        # Error messages.
        errors: list[str] = [
            e["error"]
            for e in self.step_log
            if "error" in e and e["error"] is not None
        ]

        # Success rate.
        success_rate = step_counts.get("ok", 0) / total if total > 0 else 0.0

        # Most common step name.
        step_freq: dict[str, int] = {}
        for e in self.step_log:
            s = e["step"]
            step_freq[s] = step_freq.get(s, 0) + 1
        most_common_step: Optional[str] = (
            max(step_freq, key=step_freq.get) if step_freq else None
        )

        return {
            "total_steps": total,
            "step_counts": step_counts,
            "success_rate": success_rate,
            "avg_duration_ms": avg_dur,
            "max_duration_ms": max_dur,
            "min_duration_ms": min_dur,
            "errors": errors,
            "most_common_step": most_common_step,
        }

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def get_step_log_as_state_field(self) -> list[StepLogEntry]:
        """Return the step log ready to be stored in TaskState.step_log.

        This is an alias for ``get_log()`` kept for clarity when
        integrating with state_manager.py.
        """
        return self.get_log()


# ---------------------------------------------------------------------------
# Self-test (run with: python step_logger.py)
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

    # --- Test 1: basic logging ---
    logger = StepLogger("TEST-1")
    logger.log_step("step_a", "ok", duration_ms=100)
    logger.log_step("step_b", "error", error="timeout", duration_ms=5000)
    logger.log_step("step_c", "fail", duration_ms=200)

    log = logger.get_log()
    check("log has 3 entries", len(log) == 3)
    check("first step name", log[0]["step"] == "step_a")
    check("first result", log[0]["result"] == "ok")
    check("error field present", "error" in log[1] and log[1]["error"] == "timeout")
    check("duration_ms present", log[0].get("duration_ms") == 100)
    check("timestamp format", "T" in log[0]["timestamp"])

    # --- Test 2: truncation (log > MAX_LOG_ENTRIES) ---
    logger2 = StepLogger("TEST-2")
    for i in range(60):
        logger2.log_step(f"step_{i}", "ok", duration_ms=10)
    truncated = logger2.get_log()
    check("truncation keeps max 50", len(truncated) == 50)
    check("truncation keeps last 50", truncated[0]["step"] == "step_10")
    check("truncation keeps last 50 end", truncated[-1]["step"] == "step_59")

    # --- Test 3: summary statistics ---
    summary = logger.get_summary()
    check("summary total_steps", summary["total_steps"] == 3)
    check("summary step_counts ok", summary["step_counts"].get("ok") == 1)
    check("summary step_counts error", summary["step_counts"].get("error") == 1)
    check("summary step_counts fail", summary["step_counts"].get("fail") == 1)
    check("summary success_rate", abs(summary["success_rate"] - 1 / 3) < 0.01)
    check("summary avg_duration", summary["avg_duration_ms"] == 1766.6666666666667)
    check("summary max_duration", summary["max_duration_ms"] == 5000)
    check("summary min_duration", summary["min_duration_ms"] == 100)
    check("summary has 1 error", len(summary["errors"]) == 1)
    check("summary most_common_step", summary["most_common_step"] is not None)

    # --- Test 4: empty summary ---
    logger3 = StepLogger("TEST-3")
    summary_empty = logger3.get_summary()
    check("empty total_steps", summary_empty["total_steps"] == 0)
    check("empty success_rate", summary_empty["success_rate"] == 0.0)
    check("empty avg_duration", summary_empty["avg_duration_ms"] is None)
    check("empty most_common_step", summary_empty["most_common_step"] is None)

    # --- Test 5: get_log returns a copy ---
    original_log = logger.get_log()
    original_log.append({"fake": True})
    check("get_log returns copy", len(logger.get_log()) == 3)

    # --- Test 6: StepLogEntry schema compliance ---
    entry = logger.step_log[0]
    check("entry has step field", "step" in entry)
    check("entry has result field", "result" in entry)
    check("entry has timestamp field", "timestamp" in entry)

    print(f"\n{_counts[0]} passed, {_counts[1]} failed")
    sys.exit(0 if _counts[1] == 0 else 1)
