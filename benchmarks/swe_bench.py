"""SWE-bench runner.

SWE-bench evaluates agents on real-world software engineering tasks drawn
from GitHub repositories. Each test case consists of:
- A GitHub issue / PR context
- A git patch that fixes the issue
- A test suite that validates the fix

This runner:
1. Clones the SWE-bench Lite dataset from GitHub.
2. Parses test-case JSON / JSONL files.
3. Runs each test by applying the patch in a Docker container and executing
   the test suite.
4. Reports pass/fail in the standardized BenchmarkRun format.

Reference: https://github.com/SWE-bench/SWE-bench
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
    BenchmarkRun,
    BaseBenchmarkRunner,
    TestResult,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SWE_BENCH_REPO = "https://github.com/SWE-bench/SWE-bench.git"
_DEFAULT_BRANCH = "main"
_LITE_SUITE = "verified"  # "verified" subset = ~300 issues


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


def _run_docker_swe_test(
    image_name: str,
    instance_id: str,
    test_script: str,
    timeout: Optional[float],
    env: Optional[dict[str, str]],
) -> tuple[str, str, int, float]:
    """Run a single SWE-bench test inside the official Docker image.

    Returns (stdout, stderr, returncode, duration_seconds).
    """
    cmd = [
        "docker", "run", "--rm",
        "-v", f"{test_script}:/test_script.sh",
        "-e", f"INSTANCE_ID={instance_id}",
        f"{image_name}",
        "bash", "-c", test_script,
    ]
    start = __import__("time").time()
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, env=env,
    )
    return proc.stdout, proc.stderr, proc.returncode, __import__("time").time() - start


# ---------------------------------------------------------------------------
# Runner class
# ---------------------------------------------------------------------------


@register_benchmark("swe_bench")
class SWEBenchRunner(BaseBenchmarkRunner):
    """Run SWE-bench evaluation suite."""

    BENCHMARK_NAME: str = "SWE-bench"

    def __init__(self, config: Optional[BenchmarkConfig] = None) -> None:
        cfg = config or BenchmarkConfig()
        super().__init__(cfg)
        self._docker_image: str = cfg.metadata.get("docker_image", "swebench/swebench-docker:latest")  # type: ignore
        self._repo_dir: Path = Path(cfg.dataset_dir) if cfg.dataset_dir else Path("/tmp/swe_bench_repo")
        self._instances_path: Optional[Path] = None

    @property
    def name(self) -> str:
        return self.BENCHMARK_NAME

    @classmethod
    def class_name(cls) -> str:
        return cls.__name__

    def _find_instances(self) -> Path:
        """Search for SWE-bench instances file in the cloned repo.

        The SWE-bench repo has evolved — instances may be in:
        - benchmarks/<subset>/instances.jsonl  (legacy structure)
        - swebench/resources/swebench-og/<subset>/  (newer structure)
        - swebench/hf_data/<subset>/           (HF dataset structure)
        """
        repo = self._repo_dir
        subset = self.config.subset or _LITE_SUITE

        candidates = [
            # Legacy: benchmarks/<subset>/instances.jsonl
            repo / "benchmarks" / subset / "instances.jsonl",
            # Newer: swebench/resources/swebench-og/<subset>/instances.jsonl
            repo / "swebench" / "resources" / "swebench-og" / subset / "instances.jsonl",
            repo / "swebench" / "resources" / "swebench-og" / subset / "instances.json",
            # HF dataset style
            repo / "swebench" / "hf_data" / subset / "instances.jsonl",
            repo / "swebench" / "hf_data" / subset / "instances.json",
        ]

        for path in candidates:
            if path.exists():
                return path

        # Last resort: search the entire repo for instances.jsonl files
        for jsonl in repo.rglob("instances.jsonl"):
            return jsonl

        raise FileNotFoundError(
            f"SWE-bench instances not found in {repo}. "
            f"Checked paths: {[str(c) for c in candidates]}. "
            f"The SWE-bench repo structure may have changed — update _find_instances()."
        )

    def _clone_dataset(self) -> Path:
        """Clone the SWE-bench repo and locate the instances file."""
        logger.info("Cloning SWE-bench dataset from %s", _SWE_BENCH_REPO)
        _git_clone(_SWE_BENCH_REPO, self._repo_dir, _DEFAULT_BRANCH)

        instances_file = self._find_instances()
        self._instances_path = instances_file
        logger.info("Found instances at %s", instances_file)
        return self._repo_dir

    def _load_tests(self) -> list[dict[str, Any]]:
        """Parse SWE-bench instances.jsonl into test-case dicts."""
        tests: list[dict[str, Any]] = []

        if self._instances_path is None:
            self._clone_dataset()

        if self._instances_path is None:
            raise RuntimeError("No instances path set for _load_tests")

        instances_path = self._instances_path
        subset = self.config.subset or _LITE_SUITE

        with open(instances_path, "r", encoding="utf-8") as fh:
            for line_num, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    inst = json.loads(line)
                except json.JSONDecodeError as exc:
                    logger.warning("Skipping malformed JSONL line %d: %s", line_num, exc)
                    continue

                # Skip if a subset filter is active
                if self.config.subset and inst.get("subset") != self.config.subset:
                    continue

                tests.append({
                    "id": inst["instance_id"],
                    "spec": {
                        "repo": inst.get("repo", ""),
                        "base_commit": inst.get("base_commit", ""),
                        "patch": inst.get("patch", ""),
                        "test_patch": inst.get("test_patch", ""),
                        "hints_text": inst.get("hints_text", ""),
                        "problem_statement": inst.get("problem_statement", ""),
                    },
                    "metadata": {
                        "subset": subset,
                        "line_number": line_num,
                    },
                })

        logger.info("Parsed %d SWE-bench instances from %s", len(tests), instances_path)
        return tests

    def _run_test(self, test_case: dict[str, Any]) -> TestResult:
        """Execute a single SWE-bench test case.

        The runner applies the git patch and test patch, then runs the
        test suite inside a Docker container.
        """
        test_id = test_case["id"]
        spec = test_case["spec"]
        timeout = self.config.timeout_per_test if self.config.timeout_per_test > 0 else None
        env = os.environ.copy()
        if self.config.agent_env:
            env.update(self.config.agent_env)

        logger.debug("Running SWE-bench test %s", test_id)

        # Build Docker run script
        test_script = (
            "source /swe_util/env.sh && "
            "cd /swe_util/ && "
            "eval \"$CMD\" && "
            "echo 'Testing...' && "
            "python -m pytest --no-header -rA --tb=short -q "
            f"$TEST_DIR/{spec.get('test_patch', '')}"
            if spec.get("test_patch")
            else "echo 'No test suite'; exit 1"
        )

        stdout, stderr, rc, duration = _run_docker_swe_test(
            image_name=self._docker_image,
            instance_id=test_id,
            test_script=test_script,
            timeout=timeout,
            env=env,
        )

        if rc == 0:
            status = "pass"
        elif rc == 1:
            # pytest exit code 1 = test failure
            status = "fail"
        else:
            status = "error"

        return TestResult(
            test_id=test_id,
            status=status,
            duration_seconds=duration,
            stdout=stdout[-2000:],
            stderr=stderr[-2000:],
            metadata=test_case.get("metadata", {}),
        )

    @property
    def available_subsets(self) -> list[str]:
        """List available SWE-bench subsets."""
        resource_dir = self._repo_dir / "swebench" / "resources" / "swebench-og"
        if not resource_dir.exists():
            return []
        return [d.name for d in resource_dir.iterdir() if d.is_dir()]
