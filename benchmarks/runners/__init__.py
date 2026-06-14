"""
Benchmark runners for all supported evaluation suites.

Exports the factory method BenchmarkRunner.for_suite() to instantiate
the appropriate runner for a given benchmark suite.
"""

from __future__ import annotations

from benchmarks.runners.base import BaseBenchmarkRunner
from benchmarks.runners.swe_bench import SWEBenchRunner
from benchmarks.runners.agent_bench import AgentBenchRunner
from benchmarks.runners.webarena import WebArenaRunner
from benchmarks.runners.gaia import GAIARunner
from benchmarks.runners.toolbench import ToolBenchRunner
from benchmarks.config import BenchmarkConfig, BenchmarkSuite


class BenchmarkRunner:
    """Factory for creating benchmark runners."""

    _registry: dict[BenchmarkSuite, type[BaseBenchmarkRunner]] = {
        BenchmarkSuite.SWE_BENCH: SWEBenchRunner,
        BenchmarkSuite.AGENT_BENCH: AgentBenchRunner,
        BenchmarkSuite.WEBARENA: WebArenaRunner,
        BenchmarkSuite.GAIA: GAIARunner,
        BenchmarkSuite.TOOLBENCH: ToolBenchRunner,
    }

    @classmethod
    def for_suite(cls, suite: str | BenchmarkSuite, config: BenchmarkConfig) -> BaseBenchmarkRunner:
        """Create a benchmark runner for the given suite name.

        Args:
            suite: Benchmark suite name or BenchmarkSuite enum.
            config: The benchmark configuration.

        Returns:
            A configured benchmark runner instance.

        Raises:
            ValueError: If the suite is not supported.
        """
        if isinstance(suite, str):
            suite = BenchmarkSuite.from_string(suite)
        runner_cls = cls._registry.get(suite)
        if runner_cls is None:
            raise ValueError(
                f"Unsupported benchmark suite: {suite.value!r}. "
                f"Supported: {[s.value for s in cls._registry]}"
            )
        return runner_cls(config)

    @classmethod
    def register(cls, suite: BenchmarkSuite, runner_cls: type[BaseBenchmarkRunner]) -> None:
        """Register a custom runner for a benchmark suite."""
        cls._registry[suite] = runner_cls

    @classmethod
    def supported_suites(cls) -> list[str]:
        """Return list of supported benchmark suite names."""
        return [s.value for s in cls._registry]
