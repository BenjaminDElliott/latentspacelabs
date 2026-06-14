"""
Agent Benchmark Evaluation Platform

An automated benchmark evaluation platform supporting SWE-bench, AgentBench,
WebArena, GAIA, and ToolBench with cost/accuracy analytics and regression detection.

Usage:
    from benchmarks import BenchmarkRunner, BenchmarkConfig
    from benchmarks.analytics import CostAnalytics, AccuracyAnalytics
    from benchmarks.regression import RegressionDetector

    config = BenchmarkConfig.from_file("config.yaml")
    runner = BenchmarkRunner.for_suite("swe_bench", config)
    results = runner.run()
    analytics = CostAnalytics(results)
    analytics.report()
"""

__version__ = "0.1.0"
__author__ = "Nous Research"

from benchmarks.config import BenchmarkConfig, BenchmarkSuite
from benchmarks.models import (
    BenchmarkResult,
    BenchmarkRun,
    TrialResult,
    CostBreakdown,
    AgentAction,
    BenchmarkProblem,
    ProblemType,
)
from benchmarks.runners.base import BaseBenchmarkRunner
from benchmarks.analytics.cost_analytics import CostAnalytics
from benchmarks.analytics.accuracy_analytics import AccuracyAnalytics
from benchmarks.regression.detector import RegressionDetector

__all__ = [
    "__version__",
    "BenchmarkConfig",
    "BenchmarkSuite",
    "BenchmarkResult",
    "BenchmarkRun",
    "TrialResult",
    "CostBreakdown",
    "AgentAction",
    "BenchmarkProblem",
    "ProblemType",
    "BaseBenchmarkRunner",
    "CostAnalytics",
    "AccuracyAnalytics",
    "RegressionDetector",
]
