#!/usr/bin/env python3
"""
Tests for training_data_collector.py — LAT-328 Training Data Collector.

Covers:
1. State and action record creation
2. Episode construction and serialization
3. State→action trajectory interleaving
4. JSONL save/load roundtrip
5. filter_episodes and merge_jsonl_files helpers
6. run_and_collect convenience wrapper
7. Failed action recording
8. Empty input warning
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

# Add parent directory to path
sys.path.insert(
    0,
    str(Path(__file__).resolve().parent),
)

from training_data_collector import (
    ActionRecord,
    Episode,
    StateRecord,
    TrainingDataCollector,
    filter_episodes,
    merge_jsonl_files,
    run_and_collect,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tmp_jsonl() -> Path:
    """Create a temporary JSONL file path."""
    return Path(tempfile.mktemp(suffix=".jsonl"))


# ---------------------------------------------------------------------------
# AC 1: State and action record creation
# ---------------------------------------------------------------------------


class TestStateRecord(unittest.TestCase):
    """Test StateRecord creation and defaults."""

    def test_create_with_all_fields(self) -> None:
        rec = StateRecord(
            state_id="s1",
            input="Query voltage",
            context={"mode": "normal"},
            observations={"bus_14": 235.2},
        )
        self.assertEqual(rec.state_id, "s1")
        self.assertEqual(rec.input, "Query voltage")
        self.assertEqual(rec.context["mode"], "normal")
        self.assertTrue(rec.success)
        self.assertTrue(len(rec.timestamp) > 0)

    def test_create_with_minimal_fields_auto_ids(self) -> None:
        rec = StateRecord(input="Minimal state")
        self.assertTrue(len(rec.state_id) > 0)
        self.assertIn("Minimal state", rec.input)

    def test_default_success(self) -> None:
        rec = StateRecord(input="test")
        self.assertTrue(rec.success)


class TestActionRecord(unittest.TestCase):
    """Test ActionRecord creation and defaults."""

    def test_create_with_all_fields(self) -> None:
        rec = ActionRecord(
            action_id="a1",
            tool_name="read_bus_voltage",
            params={"bus_id": 14},
            output={"voltage": 235.2},
            success=True,
        )
        self.assertEqual(rec.action_id, "a1")
        self.assertEqual(rec.tool_name, "read_bus_voltage")
        self.assertEqual(rec.params["bus_id"], 14)
        self.assertEqual(rec.output["voltage"], 235.2)

    def test_create_minimal_auto_ids(self) -> None:
        rec = ActionRecord(tool_name="get_temp")
        self.assertTrue(len(rec.action_id) > 0)
        self.assertEqual(rec.params, {})
        self.assertTrue(rec.success)

    def test_failed_action(self) -> None:
        rec = ActionRecord(
            tool_name="set_voltage",
            params={"bus": 14},
            output={"error": "out of range"},
            success=False,
            error="out of range",
        )
        self.assertFalse(rec.success)
        self.assertEqual(rec.error, "out of range")


# ---------------------------------------------------------------------------
# AC 2: Episode construction and serialization
# ---------------------------------------------------------------------------


class TestEpisode(unittest.TestCase):
    """Test Episode lifecycle and serialization."""

    def test_empty_episode(self) -> None:
        ep = Episode(episode_id="e1", session_id="s1")
        self.assertEqual(ep.episode_id, "e1")
        self.assertEqual(ep.step_count, 0)
        self.assertEqual(ep.end_time, "")

    def test_to_dict_basic(self) -> None:
        ep = Episode(episode_id="e1", session_id="s1")
        ep.start_time = "2026-01-01T00:00:00Z"
        ep.end_time = "2026-01-01T00:01:00Z"
        ep.metadata = {"source": "test"}

        d = ep.to_dict()
        self.assertEqual(d["episode_id"], "e1")
        self.assertEqual(d["session_id"], "s1")
        self.assertEqual(d["metadata"]["source"], "test")
        self.assertEqual(d["step_count"], 0)
        self.assertIsInstance(d["trajectory"], list)

    def test_serialize_roundtrip(self) -> None:
        """to_dict then json.loads should be valid JSON."""
        ep = Episode(episode_id="e1", session_id="s1")
        json_str = json.dumps(ep.to_dict(), default=str)
        loaded = json.loads(json_str)
        self.assertEqual(loaded["episode_id"], "e1")


# ---------------------------------------------------------------------------
# AC 3: State→action trajectory interleaving
# ---------------------------------------------------------------------------


class TestTrajectoryInterleaving(unittest.TestCase):
    """Test that states and actions are correctly interleaved in trajectory."""

    def test_simple_one_step(self) -> None:
        """state → action should produce two trajectory entries."""
        collector = TrainingDataCollector(session_id="s1")
        collector.record_state({"input": "Check voltage", "context": {"mode": "normal"}})
        collector.record_action("read_voltage", {"bus": 14}, {"voltage": 235.2})
        collector.finalize()

        d = collector.episode.to_dict()
        trajectory = d["trajectory"]
        self.assertEqual(len(trajectory), 2)
        self.assertEqual(trajectory[0]["type"], "state")
        self.assertEqual(trajectory[1]["type"], "action")
        self.assertEqual(trajectory[1]["tool_name"], "read_voltage")
        self.assertEqual(trajectory[1]["params"]["bus"], 14)

    def test_multi_step_episode(self) -> None:
        """Multiple state→action steps should interleave correctly."""
        collector = TrainingDataCollector(session_id="s1")

        collector.record_state({"input": "Check bus 14", "context": {"mode": "normal"}})
        collector.record_action("read_voltage", {"bus": 14}, {"voltage": 235.2})

        collector.record_state({"input": "Raise to 240", "context": {"voltage_14": 235.2}})
        collector.record_action("set_voltage", {"bus": 14, "target": 240.0}, {"ok": True})

        collector.record_state({"input": "Verify", "context": {"voltage_14": 240.1}})
        collector.record_action("read_voltage", {"bus": 14}, {"voltage": 240.1})

        collector.finalize()

        d = collector.episode.to_dict()
        trajectory = d["trajectory"]
        self.assertEqual(len(trajectory), 6)

        expected_types = ["state", "action", "state", "action", "state", "action"]
        for i, t in enumerate(trajectory):
            self.assertEqual(t["type"], expected_types[i])

    def test_action_output_none(self) -> None:
        """Actions without output should serialize cleanly."""
        collector = TrainingDataCollector(session_id="s1")
        collector.record_state({"input": "Ping"})
        collector.record_action("ping", {})
        collector.finalize()

        trajectory = collector.episode.to_dict()["trajectory"]
        self.assertIsNone(trajectory[1]["output"])


# ---------------------------------------------------------------------------
# AC 4: JSONL save/load roundtrip
# ---------------------------------------------------------------------------


class TestJsonlSaveLoad(unittest.TestCase):
    """Test save_to_path and load_from_jsonl."""

    def test_save_and_load(self) -> None:
        """Save an episode and load it back."""
        path = _tmp_jsonl()
        try:
            collector = TrainingDataCollector(session_id="s1")
            collector.record_state({"input": "Query voltage"})
            collector.record_action("read_voltage", {"bus": 14}, {"voltage": 235.2})
            collector.finalize()

            written = collector.save_to_path(path)
            self.assertEqual(written, 1)

            episodes = TrainingDataCollector.load_from_jsonl(path)
            self.assertEqual(len(episodes), 1)
            self.assertEqual(episodes[0]["episode_id"], collector.episode.episode_id)
        finally:
            path.unlink(missing_ok=True)

    def test_append_mode(self) -> None:
        """Multiple saves should append, not overwrite."""
        path = _tmp_jsonl()
        try:
            for i in range(3):
                c = TrainingDataCollector(session_id=f"s{i}")
                c.record_state({"input": f"Task {i}"})
                c.finalize()
                c.save_to_path(path)

            episodes = TrainingDataCollector.load_from_jsonl(path)
            self.assertEqual(len(episodes), 3)
        finally:
            path.unlink(missing_ok=True)

    def test_load_nonexistent(self) -> None:
        self.assertEqual(
            TrainingDataCollector.load_from_jsonl(_tmp_jsonl()),
            [],
        )

    def test_save_creates_parent_dirs(self) -> None:
        path = _tmp_jsonl().parent / "subdir" / "nested" / "data.jsonl"
        try:
            collector = TrainingDataCollector(session_id="s1")
            collector.record_state({"input": "test"})
            collector.finalize()
            collector.save_to_path(path)
            self.assertTrue(path.exists())
        finally:
            path.unlink(missing_ok=True)

    def test_to_jsonl_line(self) -> None:
        collector = TrainingDataCollector(session_id="s1")
        collector.record_state({"input": "test"})
        collector.finalize()
        line = collector.to_jsonl_line()
        # Should be valid JSON
        data = json.loads(line)
        self.assertEqual(data["session_id"], "s1")


# ---------------------------------------------------------------------------
# AC 5: Helper functions (merge, filter, run_and_collect)
# ---------------------------------------------------------------------------


class TestHelpers(unittest.TestCase):
    """Test merge_jsonl_files, filter_episodes, run_and_collect."""

    def test_run_and_collect(self) -> None:
        """run_and_collect should create and finalize an episode."""
        path = _tmp_jsonl()
        try:
            def task_fn(collector):
                collector.record_state({"input": "Query voltages"})
                collector.record_action("query", {"grid": "test"}, {"ok": True})
                return True

            ep = run_and_collect(
                "s1",
                task_fn,
                metadata={"env": "test"},
                output_path=path,
            )

            self.assertTrue(ep.states[-1].success)
            self.assertEqual(ep.session_id, "s1")
            self.assertEqual(ep.step_count, 1)

            episodes = TrainingDataCollector.load_from_jsonl(path)
            self.assertEqual(len(episodes), 1)
        finally:
            path.unlink(missing_ok=True)

    def test_run_and_collect_failure(self) -> None:
        """Failed tasks should be recorded."""

        def failing_task(collector):
            collector.record_state({"input": "Query voltages"})
            collector.record_action("query", {}, {"error": "timeout"}, success=False)
            return False

        ep = run_and_collect("s1", failing_task)
        self.assertFalse(ep.states[-1].success)

    def test_merge_jsonl_files(self) -> None:
        """merge should combine files and deduplicate by episode_id."""
        f1 = _tmp_jsonl()
        f2 = _tmp_jsonl()
        try:
            c1 = TrainingDataCollector(session_id="s1")
            c1.record_state({"input": "A"})
            c1.finalize()
            c1.save_to_path(f1)

            c2 = TrainingDataCollector(session_id="s2")
            c2.record_state({"input": "B"})
            c2.finalize()
            c2.save_to_path(f2)

            out = _tmp_jsonl()
            try:
                count = merge_jsonl_files([f1, f2], out)
                self.assertEqual(count, 2)

                episodes = TrainingDataCollector.load_from_jsonl(out)
                self.assertEqual(len(episodes), 2)
            finally:
                out.unlink(missing_ok=True)
        finally:
            f1.unlink(missing_ok=True)
            f2.unlink(missing_ok=True)

    def test_filter_episodes_by_min_steps(self) -> None:
        """Only episodes with >= min_steps should be kept.

        Note: filter_episodes checks trajectory length (state+action entries).
        Each step produces 2 entries. So min_steps=4 requires at least
        1 full step (2 entries) — we use min_steps=4 to require 2+ steps.
        """
        path = _tmp_jsonl()
        try:
            for i in range(3):
                c = TrainingDataCollector(session_id=f"s{i}")
                for _ in range(i + 1):  # 1, 2, 3 steps
                    c.record_state({"input": f"Step {i}"})
                    c.record_action("tool", {})
                c.finalize()
                c.save_to_path(path)

            out = _tmp_jsonl()
            try:
                count = filter_episodes(path, out, min_steps=4)
                self.assertEqual(count, 2)  # i=1 (4 entries) and i=2 (6 entries) kept

                episodes = TrainingDataCollector.load_from_jsonl(out)
                self.assertEqual(len(episodes), 2)
            finally:
                out.unlink(missing_ok=True)
        finally:
            path.unlink(missing_ok=True)

    def test_filter_episodes_by_tool_name(self) -> None:
        """Only episodes containing specified tools should be kept."""
        path = _tmp_jsonl()
        try:
            for tool in ["read_voltage", "set_voltage", "query_temp"]:
                c = TrainingDataCollector(session_id=f"s_{tool}")
                c.record_state({"input": f"Use {tool}"})
                c.record_action(tool, {"id": 1}, {"ok": True})
                c.finalize()
                c.save_to_path(path)

            out = _tmp_jsonl()
            try:
                count = filter_episodes(
                    path,
                    out,
                    tool_names=["read_voltage", "set_voltage"],
                )
                self.assertEqual(count, 2)
            finally:
                out.unlink(missing_ok=True)
        finally:
            path.unlink(missing_ok=True)

    def test_failed_action_record(self) -> None:
        """record_failed_action should set success=False."""
        collector = TrainingDataCollector(session_id="s1")
        rec = collector.record_failed_action("read_voltage", {"bus": 99}, "bus not found")
        self.assertFalse(rec.success)
        self.assertEqual(rec.error, "bus not found")

    def test_empty_input_warning(self) -> None:
        """Empty input should trigger a warning."""
        collector = TrainingDataCollector(session_id="s1")
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            collector.record_state({"input": ""})
            self.assertEqual(len(w), 1)
            self.assertIn("empty input", str(w[0].message).lower())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main()
