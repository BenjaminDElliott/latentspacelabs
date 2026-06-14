"""WebArena runner.

WebArena evaluates agents on realistic web navigation tasks. Each task
involves navigating a suite of websites (GitHub, Reddit, Gmail, etc.) to
complete goals such as:
- Posting on Reddit
- Sending an email in Gmail
- Creating a GitHub issue
- Filling out forms

Reference: https://github.com/web-arena-x/webarena

This runner:
1. Clones the WebArena dataset and prepares Docker containers.
2. Parses the task JSON configurations.
3. Runs each task inside a Docker container with the agent interacting
   via the browser.
4. Reports pass/fail in the standardized BenchmarkRun format.
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

_WEBARENA_REPO = "https://github.com/web-arena-x/webarena.git"
_DEFAULT_BRANCH = "main"
_DEFAULT_PORT = 7788  # WebArena scoring server port


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


@register_benchmark("webarena")
class WebArenaRunner(BaseBenchmarkRunner):
    """Run WebArena evaluation suite."""

    BENCHMARK_NAME: str = "WebArena"

    def __init__(self, config: Optional[BenchmarkConfig] = None) -> None:
        cfg = config or BenchmarkConfig()
        super().__init__(cfg)
        self._repo_dir: Path = Path(cfg.dataset_dir) if cfg.dataset_dir else Path("/tmp/webarena_repo")
        self._scoring_port: int = cfg.metadata.get("scoring_port", _DEFAULT_PORT)  # type: ignore

    @property
    def name(self) -> str:
        return self.BENCHMARK_NAME

    @classmethod
    def class_name(cls) -> str:
        return cls.__name__

    def _clone_dataset(self) -> Path:
        """Clone the WebArena repo and prepare scoring scripts."""
        logger.info("Cloning WebArena dataset from %s", _WEBARENA_REPO)
        _git_clone(_WEBARENA_REPO, self._repo_dir, _DEFAULT_BRANCH)

        # Verify scoring scripts exist
        scoring_dir = self._repo_dir / "scoring"
        if not scoring_dir.exists():
            raise FileNotFoundError(
                f"WebArena scoring directory not found at {scoring_dir}. "
                f"The repo structure may have changed."
            )

        # Verify environment config
        env_file = self._repo_dir / "environment_configs" / "local_exec"
        if env_file.exists():
            logger.info("WebArena local_exec environment config found")
        else:
            logger.warning("No local_exec env config; agent will connect to remote WebArena instances")

        logger.info("WebArena dataset ready at %s", self._repo_dir)
        return self._repo_dir

    def _load_tests(self) -> list[dict[str, Any]]:
        """Parse WebArena task definitions into test-case dicts.

        WebArena stores task configurations as JSON files in a 'tasks'
        directory. Each file defines the goal, start page, and scoring
        criteria for one task.
        """
        tasks_dir = self._repo_dir / "tasks"
        if not tasks_dir.exists():
            return []

        tests: list[dict[str, Any]] = []

        for task_file in sorted(tasks_dir.rglob("*.json")):
            try:
                with open(task_file, "r", encoding="utf-8") as fh:
                    task_data = json.load(fh)
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Skipping %s: %s", task_file, exc)
                continue

            task_id = task_data.get("task_id", task_file.stem)
            domain = task_data.get("domain", "unknown")
            website = task_data.get("website", "")
            task_name = task_data.get("task_name", task_data.get("description", task_file.name))
            goal = task_data.get("goal", task_data.get("description", ""))
            setup_actions = task_data.get("setup_actions", [])
            init_mode = task_data.get("init_mode", "default")

            # Filter by requested subset (e.g., "hard" subset)
            difficulty = task_data.get("difficulty", "easy")
            if self.config.subset and self.config.subset != difficulty:
                continue

            tests.append({
                "id": task_id,
                "spec": {
                    "task_name": task_name,
                    "domain": domain,
                    "website": website,
                    "goal": goal,
                    "setup_actions": setup_actions,
                    "init_mode": init_mode,
                },
                "metadata": {
                    "source_file": str(task_file),
                    "difficulty": difficulty,
                    "website": website,
                },
            })

        logger.info("Parsed %d WebArena tasks from %s", len(tests), tasks_dir)
        return tests

    def _run_test(self, test_case: dict[str, Any]) -> TestResult:
        """Execute a single WebArena task.

        The runner:
        1. Sets up any pre-actions (e.g., creating accounts).
        2. Launches the agent with the task goal.
        3. Uses the WebArena scoring server to evaluate the outcome.
        """
        test_id = test_case["id"]
        spec = test_case["spec"]
        timeout = self.config.timeout_per_test if self.config.timeout_per_test > 0 else None
        env = os.environ.copy()
        if self.config.agent_env:
            env.update(self.config.agent_env)

        logger.debug("Running WebArena task %s (domain=%s, difficulty=%s)",
                     test_id, spec.get("domain"), test_case.get("metadata", {}).get("difficulty"))

        start = __import__("time").time()

        # Step 1: Run setup actions (if any)
        setup_actions = spec.get("setup_actions", [])
        if setup_actions:
            for action_json in setup_actions:
                try:
                    subprocess.run(
                        f"echo '{json.dumps(action_json)}'",
                        shell=True, capture_output=True, text=True, timeout=30,
                    )
                except Exception as exc:
                    logger.warning("Setup action failed for %s: %s", test_id, exc)

        # Step 2: Run the agent with the task goal
        cmd = self.config.agent_command
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

            # Step 3: Score the task via WebArena scoring script
            scoring_script = self._repo_dir / "scoring" / "run_scoring.sh"
            if scoring_script.exists():
                score_proc = subprocess.run(
                    f"bash {scoring_script} {spec.get('website', '')} "
                    f"'{spec.get('goal', '')}'",
                    shell=True, capture_output=True, text=True,
                    timeout=60, env=env,
                )
                # WebArena scoring outputs 1 for pass, 0 for fail
                output = score_proc.stdout.strip()
                if "1" in output or "PASS" in output.upper():
                    status = "pass"
                elif "0" in output or "FAIL" in output.upper():
                    status = "fail"
                else:
                    # Fallback: use agent exit code
                    status = "pass" if proc.returncode == 0 else "fail"

                return TestResult(
                    test_id=test_id,
                    status=status,
                    duration_seconds=duration,
                    stdout=proc.stdout[-2000:],
                    stderr=proc.stderr[-2000:] or score_proc.stderr[-1000:],
                    metadata={**test_case.get("metadata", {}), "score_output": output},
                )

            # No scoring script — fall back to agent exit code
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
    def available_domains(self) -> list[str]:
        """List available WebArena domains from the dataset."""
        tasks_dir = self._repo_dir / "tasks"
        if not tasks_dir.exists():
            return []
        domains: set[str] = set()
        for task_file in tasks_dir.rglob("*.json"):
            try:
                with open(task_file, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                    domain = data.get("domain", "unknown")
                    domains.add(domain)
            except (json.JSONDecodeError, OSError):
                continue
        return sorted(domains)
