"""Abstract base class for benchmark runners.

Defines the standardized interface that all benchmark runners must implement.
Each concrete runner (SWE-bench, AgentBench, WebArena) clones its dataset,
runs test cases against an agent, and reports results in a unified format.
"""

from __future__ import annotations

import abc
import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional, Type

__all__ = [
    "register_benchmark",
    "registry",
    "TestResult",
    "BenchmarkRun",
    "BenchmarkConfig",
    "BaseBenchmarkRunner",
]

logger = logging.getLogger(__name__)


@dataclass
class TestResult:
    """Individual test case result."""
    test_id: str
    status: str  # "pass", "fail", "error", "skipped"
    duration_seconds: float = 0.0
    stdout: str = ""
    stderr: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "test_id": self.test_id,
            "status": self.status,
            "duration_seconds": self.duration_seconds,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "metadata": self.metadata,
        }


@dataclass
class BenchmarkRun:
    """Aggregated results for a full benchmark run."""
    benchmark_name: str
    agent_name: str
    agent_version: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
    results: list[TestResult] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status == "pass")

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.status == "fail")

    @property
    def errored(self) -> int:
        return sum(1 for r in self.results if r.status == "error")

    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.status == "skipped")

    @property
    def duration_seconds(self) -> float:
        if self.started_at and self.finished_at:
            return self.finished_at - self.started_at
        return 0.0

    @property
    def pass_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.passed / self.total

    def to_dict(self) -> dict[str, Any]:
        return {
            "benchmark_name": self.benchmark_name,
            "agent_name": self.agent_name,
            "agent_version": self.agent_version,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_seconds": self.duration_seconds,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "errored": self.errored,
            "skipped": self.skipped,
            "pass_rate": self.pass_rate,
            "error": self.error,
            "results": [r.to_dict() for r in self.results],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


@dataclass
class BenchmarkConfig:
    """Configuration for a benchmark run.

    Attributes:
        dataset_dir: Local directory to clone/store the benchmark dataset.
        subset: Optional subset of tests to run (e.g., "verified", "lite").
        max_workers: Concurrency for running tests (0 = sequential).
        timeout_per_test: Per-test timeout in seconds (0 = no limit).
        agent_command: Shell command to invoke the agent for a test case.
        agent_env: Environment variables to pass to the agent command.
    """
    dataset_dir: str = ""
    subset: Optional[str] = None
    max_workers: int = 0
    timeout_per_test: float = 0.0
    agent_command: str = ""
    agent_env: Optional[dict[str, str]] = None
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Benchmark registry — maps benchmark names to their runner factories
# ---------------------------------------------------------------------------

registry: dict[str, Callable[[BenchmarkConfig], BaseBenchmarkRunner]] = {}


def register_benchmark(name: str) -> Callable[[Type[BaseBenchmarkRunner]], Type[BaseBenchmarkRunner]]:
    """Decorator to register a benchmark runner class in the global registry.

    Usage:
        @register_benchmark("swe_bench")
        class SWEBenchRunner(BaseBenchmarkRunner):
            ...
    """
    def wrapper(cls: Type[BaseBenchmarkRunner]) -> Type[BaseBenchmarkRunner]:
        if not issubclass(cls, BaseBenchmarkRunner):
            raise TypeError(f"{cls.__name__} must subclass BaseBenchmarkRunner")
        registry[name] = lambda config: cls(config)
        return cls
    return wrapper


class BaseBenchmarkRunner(abc.ABC):
    """Abstract base class that all benchmark runners inherit from.

    Each runner must:
    1. Implement `_clone_dataset()` to fetch/store the benchmark dataset.
    2. Implement `_load_tests()` to parse the dataset into test cases.
    3. Implement `_run_test()` to execute a single test against the agent.
    4. Optionally override `run()` for the full orchestration flow.

    The `run()` method handles dataset cloning, test loading, test execution,
    and result collection — following the PRD Step 1 architecture.
    """

    def __init__(self, config: Optional[BenchmarkConfig] = None) -> None:
        self.config = config or BenchmarkConfig()
        self._dataset_path: Optional[Path] = None
        self._test_cases: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """Human-readable name of this benchmark (e.g. 'SWE-bench')."""
        raise NotImplementedError("Subclasses must implement .name")

    @classmethod
    @abc.abstractmethod
    def class_name(cls) -> str:
        """Return the class name for identification."""

    @property
    def dataset_path(self) -> Optional[Path]:
        """Resolved path to the local benchmark dataset, or None."""
        return self._dataset_path

    def clone_dataset(self) -> Path:
        """Clone / prepare the benchmark dataset on disk.

        Returns:
            The local path where the dataset was placed.
        """
        path = self._clone_dataset()
        self._dataset_path = path
        logger.info("Dataset ready at %s", path)
        return path

    def load_tests(self) -> list[dict[str, Any]]:
        """Load and parse test cases from the cloned dataset.

        Returns:
            List of test-case dicts, each with at least 'id' and 'spec'.
        """
        if self._dataset_path is None:
            self.clone_dataset()
        tests = self._load_tests()
        self._test_cases = tests
        logger.info("Loaded %d test cases", len(tests))
        return tests

    def run(self, agent_name: str, agent_version: str = "") -> BenchmarkRun:
        """Execute a full benchmark run: clone → load → run tests → report.

        Args:
            agent_name: Identifier for the agent being evaluated.
            agent_version: Version string for the agent.

        Returns:
            A BenchmarkRun with aggregated results.
        """
        logger.info("Starting benchmark run: %s → %s (%s)",
                     self.name, agent_name, agent_version)

        run = BenchmarkRun(
            benchmark_name=self.name,
            agent_name=agent_name,
            agent_version=agent_version,
            started_at=time.time(),
        )

        try:
            # Step 1: Clone dataset
            self.clone_dataset()

            # Step 2: Load tests
            test_cases = self.load_tests()

            # Step 3: Run each test
            for i, test_case in enumerate(test_cases):
                logger.info("[%d/%d] Running test %s", i + 1, len(test_cases),
                            test_case.get("id", "<unknown>"))
                result = self._run_test(test_case)
                run.results.append(result)

            # Step 4: Finalize
            run.finished_at = time.time()
            logger.info("Benchmark complete: %d/%d passed (%.1f%%)",
                        run.passed, run.total, run.pass_rate * 100)

        except Exception as exc:
            run.error = str(exc)
            run.finished_at = time.time()
            logger.exception("Benchmark run failed with error: %s", exc)

        return run

    def export_results(self, run: BenchmarkRun, output_path: Optional[str] = None) -> str:
        """Serialize benchmark results to JSON and optionally write to file.

        Args:
            run: The BenchmarkRun to serialize.
            output_path: Optional file path to write JSON to.

        Returns:
            The JSON string representation.
        """
        json_str = run.to_json()
        if output_path:
            Path(output_path).write_text(json_str, encoding="utf-8")
            logger.info("Results written to %s", output_path)
        return json_str

    # ------------------------------------------------------------------
    # Abstract methods — subclasses must implement
    # ------------------------------------------------------------------

    @abc.abstractmethod
    def _clone_dataset(self) -> Path:
        """Clone or prepare the benchmark dataset.

        Subclasses should:
        - Clone the Git repo / download the dataset archive.
        - Extract / organize files into a working directory.
        - Return the path to the dataset root.
        """

    @abc.abstractmethod
    def _load_tests(self) -> list[dict[str, Any]]:
        """Parse the dataset into test-case dicts.

        Each dict must contain at minimum:
        - 'id': unique test identifier (str)
        - 'spec': benchmark-specific spec dict describing the test

        Additional fields are allowed and preserved as metadata.
        """

    def _run_test(self, test_case: dict[str, Any]) -> TestResult:
        """Execute a single test case against the agent.

        Default implementation runs `agent_command` in a subprocess.
        Subclasses may override for benchmark-specific logic
        (e.g. Docker containers for WebArena, git patches for SWE-bench).

        Args:
            test_case: A dict from `_load_tests()` describing the test.

        Returns:
            A TestResult with the outcome.
        """
        timeout = self.config.timeout_per_test if self.config.timeout_per_test > 0 else None
        env = os.environ.copy()
        if self.config.agent_env:
            env.update(self.config.agent_env)

        test_id = test_case.get("id", "unknown")
        cmd = self.config.agent_command

        if not cmd:
            return TestResult(
                test_id=test_id,
                status="error",
                stderr="No agent_command configured in BenchmarkConfig",
            )

        start = time.time()
        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            duration = time.time() - start

            if proc.returncode == 0:
                status = "pass"
            else:
                status = "fail"

            return TestResult(
                test_id=test_id,
                status=status,
                duration_seconds=duration,
                stdout=proc.stdout[-4000:],  # truncate large outputs
                stderr=proc.stderr[-4000:],
                metadata=test_case.get("metadata", {}),
            )
        except subprocess.TimeoutExpired:
            duration = time.time() - start
            return TestResult(
                test_id=test_id,
                status="fail",
                duration_seconds=duration,
                stderr=f"Test timed out after {timeout}s",
                metadata=test_case.get("metadata", {}),
            )
        except Exception as exc:
            duration = time.time() - start
            return TestResult(
                test_id=test_id,
                status="error",
                duration_seconds=duration,
                stderr=str(exc),
                metadata=test_case.get("metadata", {}),
            )

    def list_datasets(self) -> list[dict[str, str]]:
        """Return available dataset options (e.g. different subsets).

        Default: list what's on disk. Subclasses override for richer info.
        """
        if self._dataset_path is None:
            return []
        available: list[dict[str, str]] = []
        for path in self._dataset_path.rglob("*.json"):
            available.append({"path": str(path), "type": "json"})
        return available
