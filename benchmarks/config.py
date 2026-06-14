"""
Configuration module for the Agent Benchmark Evaluation Platform.

Provides BenchmarkConfig for specifying runner parameters,
trial settings, cost limits, and suite-specific options.
Supports YAML and programmatic configuration.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Suite Enum
# ---------------------------------------------------------------------------

class BenchmarkSuite(Enum):
    """Supported benchmark suites."""
    SWE_BENCH = "swe_bench"
    AGENT_BENCH = "agent_bench"
    WEBARENA = "webarena"
    GAIA = "gaia"
    TOOLBENCH = "toolbench"

    @classmethod
    def from_string(cls, name: str) -> BenchmarkSuite:
        """Convert a string to the matching BenchmarkSuite enum value."""
        mapping = {s.value: s for s in cls}
        if name in mapping:
            return mapping[name]
        raise ValueError(
            f"Unknown benchmark suite: {name!r}. "
            f"Valid options: {list(mapping.keys())}"
        )


# ---------------------------------------------------------------------------
# Configuration Data Classes
# ---------------------------------------------------------------------------

@dataclass
class APIConfig:
    """API endpoint configuration for a benchmark suite."""
    base_url: str = ""
    api_key_env: str = ""       # environment variable name for API key
    default_model: str = ""     # default model to use
    timeout_seconds: int = 300  # request timeout

    def to_dict(self) -> dict[str, Any]:
        return {
            "base_url": self.base_url,
            "api_key_env": self.api_key_env,
            "default_model": self.default_model,
            "timeout_seconds": self.timeout_seconds,
        }


@dataclass
class SuiteConfig:
    """Configuration specific to a benchmark suite."""
    suite: BenchmarkSuite
    parallel: int = 1                  # number of parallel workers
    max_retries: int = 3               # max retries per problem
    retry_backoff: float = 1.0         # base retry backoff in seconds
    max_cost_per_problem: float = 10.0 # cost cap per problem
    max_duration_per_problem: float = 600.0  # time cap per problem
    api: APIConfig = field(default_factory=APIConfig)
    extra: dict[str, Any] = field(default_factory=dict)  # suite-specific overrides

    def to_dict(self) -> dict[str, Any]:
        return {
            "suite": self.suite.value,
            "parallel": self.parallel,
            "max_retries": self.max_retries,
            "retry_backoff": self.retry_backoff,
            "max_cost_per_problem": self.max_cost_per_problem,
            "max_duration_per_problem": self.max_duration_per_problem,
            "api": self.api.to_dict(),
            "extra": self.extra,
        }


@dataclass
class RunConfig:
    """Configuration for a single benchmark run."""
    trials_per_problem: int = 1        # number of attempts per problem
    cost_limit: float = float("inf")   # total cost limit for the run
    duration_limit: float = float("inf")  # total duration limit
    seed: int | None = None            # random seed for reproducibility
    output_dir: str = "benchmark_results"  # where to save results
    verbose: bool = False              # enable debug logging
    save_intermediate: bool = False    # save partial results during run

    def to_dict(self) -> dict[str, Any]:
        return {
            "trials_per_problem": self.trials_per_problem,
            "cost_limit": self.cost_limit,
            "duration_limit": self.duration_limit,
            "seed": self.seed,
            "output_dir": self.output_dir,
            "verbose": self.verbose,
            "save_intermediate": self.save_intermediate,
        }


@dataclass
class RegressionConfig:
    """Configuration for regression detection."""
    baseline_run_path: str = ""        # path to baseline results
    accuracy_threshold: float = 0.05   # % drop to trigger alert
    cost_threshold_ratio: float = 1.5  # cost multiplier to trigger alert
    severity_levels: dict[str, tuple[float, float]] = field(default_factory=lambda: {
        "minor": (0.0, 0.05),
        "moderate": (0.05, 0.15),
        "significant": (0.15, 0.30),
        "critical": (0.30, 1.0),
    })

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseline_run_path": self.baseline_run_path,
            "accuracy_threshold": self.accuracy_threshold,
            "cost_threshold_ratio": self.cost_threshold_ratio,
            "severity_levels": self.severity_levels,
        }


@dataclass
class BenchmarkConfig:
    """Top-level configuration for the benchmark evaluation platform."""
    suites: list[SuiteConfig] = field(default_factory=list)
    run: RunConfig = field(default_factory=RunConfig)
    regression: RegressionConfig = field(default_factory=RegressionConfig)
    global_api_key: str = ""           # shared API key (optional)
    output_dir: str = "benchmark_results"

    @property
    def suite_configs(self) -> dict[str, SuiteConfig]:
        return {sc.suite.value: sc for sc in self.suites}

    def get_suite_config(self, suite: str) -> SuiteConfig | None:
        """Get configuration for a specific suite."""
        return self.suite_configs.get(suite)

    def to_dict(self) -> dict[str, Any]:
        return {
            "suites": [sc.to_dict() for sc in self.suites],
            "run": self.run.to_dict(),
            "regression": self.regression.to_dict(),
            "global_api_key": self.global_api_key,
            "output_dir": self.output_dir,
        }

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, path: str | Path) -> BenchmarkConfig:
        """Load configuration from a YAML file."""
        import yaml
        path = Path(path)
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return cls._from_dict(data)

    @classmethod
    def from_json(cls, path: str | Path) -> BenchmarkConfig:
        """Load configuration from a JSON file."""
        path = Path(path)
        with open(path) as f:
            data = json.load(f)
        return cls._from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BenchmarkConfig:
        """Load configuration from a dictionary."""
        return cls._from_dict(data)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> BenchmarkConfig:
        """Internal deserialization from dictionary."""
        suites = []
        for sd in data.get("suites", []):
            api = APIConfig(**sd.get("api", {}))
            sc = SuiteConfig(
                suite=BenchmarkSuite.from_string(sd["suite"]),
                parallel=sd.get("parallel", 1),
                max_retries=sd.get("max_retries", 3),
                retry_backoff=sd.get("retry_backoff", 1.0),
                max_cost_per_problem=sd.get("max_cost_per_problem", 10.0),
                max_duration_per_problem=sd.get("max_duration_per_problem", 600.0),
                api=api,
                extra=sd.get("extra", {}),
            )
            suites.append(sc)

        run_data = data.get("run", {})
        run = RunConfig(
            trials_per_problem=run_data.get("trials_per_problem", 1),
            cost_limit=run_data.get("cost_limit", float("inf")),
            duration_limit=run_data.get("duration_limit", float("inf")),
            seed=run_data.get("seed"),
            output_dir=run_data.get("output_dir", "benchmark_results"),
            verbose=run_data.get("verbose", False),
            save_intermediate=run_data.get("save_intermediate", False),
        )

        reg_data = data.get("regression", {})
        regression = RegressionConfig(
            baseline_run_path=reg_data.get("baseline_run_path", ""),
            accuracy_threshold=reg_data.get("accuracy_threshold", 0.05),
            cost_threshold_ratio=reg_data.get("cost_threshold_ratio", 1.5),
        )

        return cls(
            suites=suites,
            run=run,
            regression=regression,
            global_api_key=data.get("global_api_key", ""),
            output_dir=data.get("output_dir", "benchmark_results"),
        )

    def save(self, path: str | Path) -> None:
        """Save configuration to a file (YAML or JSON based on extension)."""
        path = Path(path)
        if path.suffix in (".yaml", ".yml"):
            import yaml
            with open(path, "w") as f:
                yaml.dump(self.to_dict(), f, default_flow_style=False)
        elif path.suffix == ".json":
            with open(path, "w") as f:
                json.dump(self.to_dict(), f, indent=2)
        else:
            raise ValueError(
                f"Unsupported config file extension: {path.suffix!r}. "
                f"Use '.yaml', '.yml', or '.json'."
            )
