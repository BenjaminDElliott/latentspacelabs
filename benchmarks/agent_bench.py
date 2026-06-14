"""AgentBench runner.

AgentBench evaluates agents on interactive tasks where the agent must:
- Interact with a Linux terminal environment
- Solve programming tasks, QA tasks, and web tasks
- Achieve a defined goal within a session

Reference: https://github.com/THUDM/AgentBench

This runner:
1. Clones the AgentBench dataset from GitHub.
2. Parses the evaluation suite (JSON / Python test files).
3. Runs each task in an isolated environment and checks for success.
4. Reports results in the standardized BenchmarkRun format.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

from benchmarks.base import (
    register_benchmark,
    BenchmarkConfig,
    BaseBenchmarkRunner,
    TestResult,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_AGENT_BENCH_REPO = "https://github.com/THUDM/AgentBench.git"
_DEFAULT_BRANCH = "main"
_SUPPORTED_TASKS = ["linux", "coding", "qa"]


def _git_clone(url: str, dest: Path, branch: str = _DEFAULT_BRANCH) -> Path:
    """Clone a Git repository to *dest*."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "--depth", "1", "-b", branch, url, str(dest)],
        check=True,
        capture_output=True,
        text=True,
    )
    return dest


# ---------------------------------------------------------------------------
# Runner class
# ---------------------------------------------------------------------------


@register_benchmark("agent_bench")
class AgentBenchRunner(BaseBenchmarkRunner):
    """Run AgentBench evaluation suite."""

    BENCHMARK_NAME: str = "AgentBench"

    def __init__(self, config: Optional[BenchmarkConfig] = None) -> None:
        cfg = config or BenchmarkConfig()
        super().__init__(cfg)
        self._repo_dir: Path = Path(cfg.dataset_dir) if cfg.dataset_dir else Path("/tmp/agent_bench_repo")

    @property
    def name(self) -> str:
        return self.BENCHMARK_NAME

    @classmethod
    def class_name(cls) -> str:
        return cls.__name__

    def _clone_dataset(self) -> Path:
        """Clone the AgentBench repo and prepare evaluation files."""
        logger.info("Cloning AgentBench dataset from %s", _AGENT_BENCH_REPO)
        _git_clone(_AGENT_BENCH_REPO, self._repo_dir, _DEFAULT_BRANCH)

        # Verify the evaluation directory exists
        eval_dir = self._repo_dir / "evaluation"
        if not eval_dir.exists():
            raise FileNotFoundError(
                f"AgentBench evaluation directory not found at {eval_dir}. "
                f"The repo structure may have changed."
            )

        logger.info("AgentBench evaluation directory found at %s", eval_dir)
        return self._repo_dir

    def _load_tests(self) -> list[dict[str, Any]]:
        """Parse AgentBench evaluation tasks into test-case dicts.

        AgentBench organizes tasks by category (linux, coding, qa) with
        each task defined in its own directory containing task-specific files.
        """
        eval_dir = self._repo_dir / "evaluation"
        if not eval_dir.exists():
            return []

        tests: list[dict[str, Any]] = []

        # Walk the evaluation directory for task definitions
        for task_file in eval_dir.rglob("*.json"):
            try:
                with open(task_file, "r", encoding="utf-8") as fh:
                    task_data = json.load(fh)
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Skipping %s: %s", task_file, exc)
                continue

            # Extract task information from the JSON structure
            task_id = task_data.get("task_id") or task_file.stem
            task_name = task_data.get("task_name", task_file.name)
            task_type = task_data.get("task_type", "unknown")
            initial_state = task_data.get("initial_state", "")
            expected_result = task_data.get("expected_result", "")
            setup_script = task_data.get("setup_script", "")
            evaluation_script = task_data.get("evaluation_script", "")

            # Filter by requested subset (task type)
            if self.config.subset and self.config.subset not in _SUPPORTED_TASKS:
                logger.warning(
                    "Unknown AgentBench subset '%s', using all tasks",
                    self.config.subset,
                )
            if self.config.subset and task_type != self.config.subset:
                continue

            tests.append({
                "id": task_id,
                "spec": {
                    "task_name": task_name,
                    "task_type": task_type,
                    "initial_state": initial_state,
                    "expected_result": expected_result,
                    "setup_script": setup_script,
                    "evaluation_script": evaluation_script,
                },
                "metadata": {
                    "source_file": str(task_file),
                    "task_type": task_type,
                },
            })

        # Also scan for Python-based task definitions
        for py_file in eval_dir.rglob("*.py"):
            if py_file.name.startswith("test_") or "task" in py_file.name.lower():
                task_id = py_file.stem
                tests.append({
                    "id": task_id,
                    "spec": {
                        "task_name": py_file.name,
                        "task_type": "python_script",
                        "initial_state": "",
                        "expected_result": "pass",
                        "setup_script": str(py_file),
                        "evaluation_script": str(py_file),
                    },
                    "metadata": {
                        "source_file": str(py_file),
                        "task_type": "python_script",
                    },
                })

        logger.info("Parsed %d AgentBench tasks from %s", len(tests), eval_dir)
        return tests

    def _run_test(self, test_case: dict[str, Any]) -> TestResult:
        """Execute a single AgentBench task.

        The runner:
        1. Runs the setup script (if any) to prepare the task environment.
        2. Runs the agent command, capturing the agent's interactions.
        3. Runs the evaluation script to determine success/failure.
        """
        test_id = test_case["id"]
        spec = test_case["spec"]
        timeout = self.config.timeout_per_test if self.config.timeout_per_test > 0 else None
        env = os.environ.copy()
        if self.config.agent_env:
            env.update(self.config.agent_env)

        logger.debug("Running AgentBench task %s (type=%s)", test_id, spec.get("task_type"))

        # Step 1: Setup
        setup = spec.get("setup_script", "")
        if setup:
            try:
                subprocess.run(
                    setup, shell=True, capture_output=True, text=True,
                    timeout=timeout, env=env,
                )
            except subprocess.TimeoutExpired:
                return TestResult(
                    test_id=test_id,
                    status="error",
                    stderr=f"Setup timed out after {timeout}s",
                    metadata=test_case.get("metadata", {}),
                )
            except Exception as exc:
                return TestResult(
                    test_id=test_id,
                    status="error",
                    stderr=f"Setup failed: {exc}",
                    metadata=test_case.get("metadata", {}),
                )

        # Step 2: Run the agent command
        cmd = self.config.agent_command
        start = __import__("time").time()

        if not cmd:
            return TestResult(
                test_id=test_id,
                status="error",
                stderr="No agent_command configured",
                metadata=test_case.get("metadata", {}),
            )

        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=timeout, env=env,
            )
            duration = __import__("time").time() - start

            # Step 3: Evaluate
            evaluation = spec.get("evaluation_script", "")
            if evaluation:
                eval_proc = subprocess.run(
                    evaluation, shell=True, capture_output=True, text=True,
                    timeout=timeout, env=env,
                )
                if eval_proc.returncode == 0:
                    status = "pass"
                else:
                    status = "fail"
                return TestResult(
                    test_id=test_id,
                    status=status,
                    duration_seconds=duration,
                    stdout=proc.stdout[-2000:] or eval_proc.stdout[-2000:],
                    stderr=proc.stderr[-2000:] or eval_proc.stderr[-2000:],
                    metadata=test_case.get("metadata", {}),
                )

            # No explicit evaluation script — use agent exit code
            status = "pass" if proc.returncode == 0 else "fail"
            return TestResult(
                test_id=test_id,
                status=status,
                duration_seconds=duration,
                stdout=proc.stdout[-2000:],
                stderr=proc.stderr[-2000:],
                metadata=test_case.get("metadata", {}),
            )

        except subprocess.TimeoutExpired:
            duration = __import__("time").time() - start
            return TestResult(
                test_id=test_id,
                status="fail",
                duration_seconds=duration,
                stderr=f"Task timed out after {timeout}s",
                metadata=test_case.get("metadata", {}),
            )
        except Exception as exc:
            duration = __import__("time").time() - start
            return TestResult(
                test_id=test_id,
                status="error",
                duration_seconds=duration,
                stderr=str(exc),
                metadata=test_case.get("metadata", {}),
            )

    @property
    def available_task_types(self) -> list[str]:
        """List supported AgentBench task categories."""
        return _SUPPORTED_TASKS.copy()
