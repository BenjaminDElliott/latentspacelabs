#!/usr/bin/env python3
"""
Training Data Collector for Imitation Learning (LAT-328)

Captures successful task executions as state→action pairs and logs them
in structured JSON format for IL trainer consumption (LAT-329).

Usage:
    # Create a collector for a session
    collector = TrainingDataCollector(session_id="session-001")

    # Record the initial state (user request)
    collector.record_state({
        "input": "What's the voltage at bus 14?",
        "context": {"grid_mode": "normal", "timestamp": "..."},
    })

    # Record tool calls and their results
    collector.record_action("read_bus_voltage", {
        "params": {"bus_id": 14},
        "output": {"voltage": 235.2, "unit": "kV"},
    })

    # Record the next state after the action
    collector.record_state({
        "input": "Adjust it to 240 kV.",
        "context": {"bus_14_voltage": 235.2},
    })

    # Record another action
    collector.record_action("set_bus_voltage", {
        "params": {"bus_id": 14, "target_voltage": 240.0},
        "output": {"status": "ok", "actual_voltage": 240.1},
    })

    # Finalize the episode and write to disk
    trajectory = collector.finalize()
    collector.save_to_path("/path/to/data.jsonl")

PRD Reference: LAT-328 Training data collector
Epic: LAT-318 AI Power Grid Control (imitation learning transfer)
"""

from __future__ import annotations

import json
import uuid
import warnings
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class ActionRecord:
    """A single action taken by the agent during an episode.

    Each action captures the tool call name, its parameters, and the output.
    """

    action_id: str = ""
    tool_name: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    output: Any = None
    timestamp: str = ""
    success: bool = True
    error: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
        if not self.action_id:
            self.action_id = uuid.uuid4().hex[:12]


@dataclass
class StateRecord:
    """The agent's observation state at a point in time.

    Captures the input, surrounding context, and any intermediate
    observations that formed the basis for the next decision.
    """

    state_id: str = ""
    input: str = ""
    context: dict[str, Any] = field(default_factory=dict)
    observations: dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""
    success: bool = True

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
        if not self.state_id:
            self.state_id = uuid.uuid4().hex[:12]


@dataclass
class Episode:
    """A complete task execution trajectory: state→action→state→action…

    This is the unit of data that the IL trainer consumes.
    """

    episode_id: str
    session_id: str
    states: list[StateRecord] = field(default_factory=list)
    actions: list[ActionRecord] = field(default_factory=list)
    start_time: str = ""
    end_time: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.episode_id:
            self.episode_id = uuid.uuid4().hex[:12]
        if not self.start_time:
            self.start_time = datetime.now(timezone.utc).isoformat()

    @property
    def step_count(self) -> int:
        """Number of interleaved state→action steps."""
        return len(self.states)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the episode for JSON export."""
        return {
            "episode_id": self.episode_id,
            "session_id": self.session_id,
            "start_time": self.start_time,
            "end_time": self.end_time or datetime.now(timezone.utc).isoformat(),
            "step_count": self.step_count,
            "metadata": self.metadata,
            "trajectory": self._build_trajectory(),
        }

    def _build_trajectory(self) -> list[dict[str, Any]]:
        """Build an interleaved state→action trajectory list.

        Returns a list where each element is either a "state" step or
        an "action" step, in chronological order.
        """
        trajectory: list[dict[str, Any]] = []
        state_idx = 0
        action_idx = 0

        # States always come first, then actions, interleaved
        while state_idx < len(self.states) or action_idx < len(self.actions):
            if state_idx < len(self.states):
                trajectory.append(
                    {
                        "type": "state",
                        "state_id": self.states[state_idx].state_id,
                        "input": self.states[state_idx].input,
                        "context": self.states[state_idx].context,
                        "observations": self.states[state_idx].observations,
                        "success": self.states[state_idx].success,
                        "timestamp": self.states[state_idx].timestamp,
                    }
                )
                state_idx += 1
            if action_idx < len(self.actions):
                trajectory.append(
                    {
                        "type": "action",
                        "action_id": self.actions[action_idx].action_id,
                        "tool_name": self.actions[action_idx].tool_name,
                        "params": self.actions[action_idx].params,
                        "output": self.actions[action_idx].output,
                        "success": self.actions[action_idx].success,
                        "error": self.actions[action_idx].error,
                        "timestamp": self.actions[action_idx].timestamp,
                    }
                )
                action_idx += 1

        return trajectory


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

class TrainingDataCollector:
    """Captures task executions as state→action pairs for IL training.

    The collector maintains an in-memory episode buffer. Call
    ``record_state()`` to record observations and ``record_action()`` to
    record tool calls. When the task is complete, call ``finalize()`` to
    lock the episode and mark its end time, then ``save_to_path()`` to
    persist it.

    Example::

        collector = TrainingDataCollector(session_id="sess-1")
        collector.record_state({"input": "Check voltage", "context": {...}})
        collector.record_action("get_voltage", {"bus": 14}, {"voltage": 235})
        collector.record_state({"input": "Raise to 240", "context": {...}})
        collector.record_action("set_voltage", {"bus": 14, "target": 240}, ...)
        collector.finalize()
        collector.save_to_path("/data/episodes.jsonl")
    """

    def __init__(
        self,
        session_id: str,
        episode_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Initialize a collector for a single session.

        Args:
            session_id: Identifier for the session this episode belongs to.
            episode_id: Optional custom episode ID. Auto-generated if omitted.
            metadata: Optional extra metadata to attach to the episode.
        """
        self.session_id = session_id
        self._episode = Episode(
            episode_id=episode_id or "",
            session_id=session_id,
            metadata=metadata or {},
        )

    @property
    def episode(self) -> Episode:
        """Access the current (possibly incomplete) episode."""
        return self._episode

    # ------------------------------------------------------------------
    # Recording methods
    # ------------------------------------------------------------------

    def record_state(
        self,
        state_data: dict[str, Any],
    ) -> StateRecord:
        """Record an observation state.

        Args:
            state_data: Dict with keys like ``input``, ``context``,
                        ``observations``. The ``input`` key is required.

        Returns:
            The created StateRecord.
        """
        input_text = state_data.get("input", "")
        if not input_text:
            warnings.warn(
                "State recorded with empty input — this may indicate a "
                "no-op observation.",
                stacklevel=2,
            )

        state = StateRecord(
            input=input_text,
            context=state_data.get("context", {}),
            observations=state_data.get("observations", {}),
        )
        self._episode.states.append(state)
        return state

    def record_action(
        self,
        tool_name: str,
        params: Optional[dict[str, Any]] = None,
        output: Any = None,
        success: bool = True,
        error: Optional[str] = None,
    ) -> ActionRecord:
        """Record an agent action (tool call).

        Args:
            tool_name: Name of the tool/function called.
            params: Parameters passed to the tool.
            output: Tool output / return value.
            success: Whether the action succeeded.
            error: Error message if the action failed.

        Returns:
            The created ActionRecord.
        """
        action = ActionRecord(
            tool_name=tool_name,
            params=params or {},
            output=output,
            success=success,
            error=error,
        )
        self._episode.actions.append(action)
        return action

    def record_failed_action(
        self,
        tool_name: str,
        params: Optional[dict[str, Any]] = None,
        error: str = "",
    ) -> ActionRecord:
        """Convenience wrapper for recording a failed action."""
        return self.record_action(
            tool_name=tool_name,
            params=params,
            output={"error": error},
            success=False,
            error=error,
        )

    # ------------------------------------------------------------------
    # Finalization
    # ------------------------------------------------------------------

    def finalize(self) -> Episode:
        """Lock the episode and set the end time.

        Returns:
            The finalized Episode.
        """
        self._episode.end_time = datetime.now(timezone.utc).isoformat()
        return self._episode

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def save_to_path(self, path: str | Path) -> int:
        """Append the episode as a single JSON line to the given file.

        Creates parent directories if needed. Appends (does not overwrite).

        Args:
            path: Destination JSONL file path.

        Returns:
            Number of lines written (always 1 for a single episode).
        """
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)

        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(self._episode.to_dict(), default=str) + "\n")

        return 1

    def to_jsonl_line(self) -> str:
        """Return a JSON line string for the episode."""
        return json.dumps(self._episode.to_dict(), default=str)

    @staticmethod
    def load_from_jsonl(
        path: str | Path,
    ) -> list[dict[str, Any]]:
        """Load all episodes from a JSONL file.

        Args:
            path: JSONL file path.

        Returns:
            List of episode dicts.
        """
        p = Path(path)
        if not p.exists():
            return []

        episodes: list[dict[str, Any]] = []
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    episodes.append(json.loads(line))
        return episodes


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------


def run_and_collect(
    session_id: str,
    task_fn,
    metadata: Optional[dict[str, Any]] = None,
    output_path: Optional[str | Path] = None,
) -> Episode:
    """Run a task function while collecting training data.

    Wraps a task function and records its state transitions and actions.
    The task function receives a collector object it can use to record.

    Args:
        session_id: Session identifier.
        task_fn: Callable that accepts a TrainingDataCollector and runs
                 the task. Must return True on success, False on failure.
        metadata: Optional metadata dict for the episode.
        output_path: Optional path to save the episode to JSONL.

    Returns:
        The finalized Episode.

    Example::

        def my_task(collector):
            collector.record_state({"input": "Query bus voltages"})
            result = collector.record_action("query_voltages", ...)
            if result.output["all_ok"]:
                return True
            return False

        episode = run_and_collect("sess-1", my_task, output_path="episodes.jsonl")
    """
    collector = TrainingDataCollector(session_id, metadata=metadata)
    success = task_fn(collector)
    collector._episode.states[-1].success = success
    collector.finalize()
    if output_path is not None:
        collector.save_to_path(output_path)
    return collector.episode


def merge_jsonl_files(
    input_paths: list[str | Path],
    output_path: str | Path,
) -> int:
    """Merge multiple JSONL files into one, deduplicating by episode_id.

    Args:
        input_paths: Source JSONL file paths.
        output_path: Destination JSONL file path.

    Returns:
        Number of episodes written.
    """
    seen_ids: set[str] = set()
    all_episodes: list[dict[str, Any]] = []

    for p in input_paths:
        for ep in TrainingDataCollector.load_from_jsonl(p):
            eid = ep.get("episode_id", "")
            if eid and eid not in seen_ids:
                seen_ids.add(eid)
                all_episodes.append(ep)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for ep in all_episodes:
            f.write(json.dumps(ep, default=str) + "\n")

    return len(all_episodes)


def filter_episodes(
    input_path: str | Path,
    output_path: str | Path,
    min_steps: int = 1,
    tool_names: Optional[list[str]] = None,
) -> int:
    """Filter episodes from a JSONL file and write the result.

    Args:
        input_path: Source JSONL file.
        output_path: Destination JSONL file.
        min_steps: Minimum trajectory steps required.
        tool_names: If provided, only keep episodes containing these tools.

    Returns:
        Number of episodes written.
    """
    episodes = TrainingDataCollector.load_from_jsonl(input_path)
    kept: list[dict[str, Any]] = []

    for ep in episodes:
        trajectory = ep.get("trajectory", [])
        step_count = len(trajectory)

        if step_count < min_steps:
            continue

        if tool_names:
            tools_in_ep = {
                s.get("tool_name") for s in trajectory if s.get("type") == "action"
            }
            if not tools_in_ep.intersection(tool_names):
                continue

        kept.append(ep)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for ep in kept:
            f.write(json.dumps(ep, default=str) + "\n")

    return len(kept)
