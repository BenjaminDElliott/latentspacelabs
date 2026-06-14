"""Benchmark runner registry.

Exports a registry mapping benchmark names to their runner factory functions,
and provides convenience functions for instantiation.

Usage:
    from benchmarks import registry, create_runner

    # Create a runner by name
    runner = create_runner("swe_bench", config=my_config)

    # Run a benchmark
    results = runner.run(agent_name="claude-opus", agent_version="2026-06-01")

    # Export results
    json_str = runner.export_results(results, "results.json")
"""

from __future__ import annotations

from typing import Callable, Dict, Optional, Type

from benchmarks.base import BenchmarkConfig, BenchmarkRun, TestResult, BaseBenchmarkRunner, registry

# ---------------------------------------------------------------------------
# Registry: name → factory  (re-exported from base)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def create_runner(
    benchmark_name: str,
    config: Optional[BenchmarkConfig] = None,
) -> BaseBenchmarkRunner:
    """Instantiate a benchmark runner by name.

    Args:
        benchmark_name: One of the registered names (e.g. 'swe_bench',
            'agent_bench', 'webarena').
        config: Optional benchmark configuration.

    Returns:
        An instantiated BaseBenchmarkRunner subclass.

    Raises:
        ValueError: If the benchmark name is not registered.
    """
    if benchmark_name not in registry:
        available = sorted(registry.keys())
        raise ValueError(
            f"Unknown benchmark '{benchmark_name}'. "
            f"Available: {available}"
        )
    return registry[benchmark_name](config or BenchmarkConfig())


# ---------------------------------------------------------------------------
# Import concrete runners to trigger registration
# ---------------------------------------------------------------------------

# Import order matters — each module registers itself via the decorator.
from benchmarks.swe_bench import SWEBenchRunner  # noqa: E402, F401
from benchmarks.agent_bench import AgentBenchRunner  # noqa: E402, F401
from benchmarks.webarena import WebArenaRunner  # noqa: E402, F401

__all__ = [
    "registry",
    "create_runner",
    "BaseBenchmarkRunner",
    "BenchmarkConfig",
    "BenchmarkRun",
    "TestResult",
]
