"""Tests for Agent Benchmark Evaluation Platform."""

from __future__ import annotations

import asyncio
import json
import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent_bench.models import (
    AgentConfig,
    BenchmarkConfig,
    BenchmarkResult,
    BenchmarkType,
    EvaluationRun,
    MQAScore,
    Scorecard,
    TaskResult,
)
from agent_bench.orchestrator import Orchestrator, get_runner_class
from agent_bench.scoring import ScoringEngine
from agent_bench.cost_tracker import CostTracker
from agent_bench.reports import ReportGenerator
from agent_bench.runners.swe_bench import SWEBenchRunner
from agent_bench.runners.agent_bench import AgentBenchRunner
from agent_bench.runners.webarena import WebArenaRunner
from agent_bench.runners.base import TaskExecutor

logging.basicConfig(level=logging.WARNING)


# ── Models ──────────────────────────────────────────────────────────────


class TestModels:
    """Tests for data models."""

    def test_agent_config_defaults(self) -> None:
        config = AgentConfig(model="test")
        assert config.temperature == 0.2
        assert config.max_tokens == 4096

    def test_benchmark_config_defaults(self) -> None:
        config = BenchmarkConfig(
            benchmark_type=BenchmarkType.SWE_BENCH,
            agent_config=AgentConfig(model="test"),
        )
        assert config.subset_size == 50
        assert config.max_concurrent == 5
        assert config.cost_cap == 100.0

    def test_evaluation_run_defaults(self) -> None:
        run = EvaluationRun()
        assert run.status == "pending"
        assert run.run_id is not None
        assert len(run.run_id) == 32  # hex UUID

    def test_task_result_defaults(self) -> None:
        result = TaskResult(task_id="test-1", benchmark_type=BenchmarkType.SWE_BENCH, status="failed")
        assert result.status == "failed"
        assert result.score == 0.0

    def test_scorecard_defaults(self) -> None:
        sc = Scorecard(run_id="abc")
        assert sc.overall_score == 0.0


# ── Benchmark Runners ──────────────────────────────────────────────────


class TestSWEBenchRunner:
    """Tests for SWE-bench runner."""

    def test_runner_registry(self) -> None:
        assert get_runner_class("swe_bench") is SWEBenchRunner

    @pytest.mark.asyncio
    async def test_fetch_tasks(self, swe_bench_config: BenchmarkConfig) -> None:
        runner = SWEBenchRunner(swe_bench_config)
        tasks = await runner.fetch_tasks(5)
        assert len(tasks) == 5
        assert "task_id" in tasks[0]
        assert "repo" in tasks[0]

    @pytest.mark.asyncio
    async def test_fetch_tasks_limited(self, swe_bench_config: BenchmarkConfig) -> None:
        runner = SWEBenchRunner(swe_bench_config)
        tasks = await runner.fetch_tasks(2)
        assert len(tasks) == 2

    @pytest.mark.asyncio
    async def test_execute_task(self, swe_bench_config: BenchmarkConfig) -> None:
        runner = SWEBenchRunner(swe_bench_config)
        tasks = await runner.fetch_tasks(1)
        result = await runner.execute_task(tasks[0])
        assert result.task_id is not None
        assert result.status in ("passed", "failed", "timeout", "error")
        assert 0 <= result.score <= 100

    @pytest.mark.asyncio
    async def test_full_run(self, swe_bench_config: BenchmarkConfig) -> None:
        runner = SWEBenchRunner(swe_bench_config)
        result = await runner.run()
        assert result.benchmark_type == BenchmarkType.SWE_BENCH
        assert result.total_tasks == 10
        assert result.completed_tasks == 10
        assert result.total_tokens > 0
        assert result.total_cost_usd >= 0


class TestAgentBenchRunner:
    """Tests for AgentBench runner."""

    def test_runner_registry(self) -> None:
        assert get_runner_class("agent_bench") is AgentBenchRunner

    @pytest.mark.asyncio
    async def test_fetch_tasks(self, agent_bench_config: BenchmarkConfig) -> None:
        runner = AgentBenchRunner(agent_bench_config)
        tasks = await runner.fetch_tasks(10)
        assert len(tasks) == 10

    @pytest.mark.asyncio
    async def test_full_run(self, agent_bench_config: BenchmarkConfig) -> None:
        runner = AgentBenchRunner(agent_bench_config)
        result = await runner.run()
        assert result.benchmark_type == BenchmarkType.AGENT_BENCH
        assert result.completed_tasks == 10


class TestWebArenaRunner:
    """Tests for WebArena runner."""

    def test_runner_registry(self) -> None:
        assert get_runner_class("webarena") is WebArenaRunner

    @pytest.mark.asyncio
    async def test_fetch_tasks(self, webarena_config: BenchmarkConfig) -> None:
        runner = WebArenaRunner(webarena_config)
        tasks = await runner.fetch_tasks(10)
        assert len(tasks) == 10

    @pytest.mark.asyncio
    async def test_full_run(self, webarena_config: BenchmarkConfig) -> None:
        runner = WebArenaRunner(webarena_config)
        result = await runner.run()
        assert result.benchmark_type == BenchmarkType.WEBARENA
        assert result.completed_tasks == 10


# ── Orchestrator ────────────────────────────────────────────────────────


class TestOrchestrator:
    """Tests for the orchestrator."""

    def test_get_benchmarks(self) -> None:
        orch = Orchestrator(max_workers=2)
        benchmarks = orch.get_benchmarks()
        assert "swe_bench" in benchmarks
        assert "agent_bench" in benchmarks
        assert "webarena" in benchmarks

    def test_get_runner_class_unknown(self) -> None:
        with pytest.raises(ValueError, match="Unknown benchmark type"):
            get_runner_class("nonexistent")

    @pytest.mark.asyncio
    async def test_single_benchmark(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=2)
        run = await orch.evaluate([swe_bench_config])
        assert run.status == "completed"
        assert len(run.benchmark_results) == 1
        assert "swe_bench" in run.benchmark_results
        orch.shutdown()

    @pytest.mark.asyncio
    async def test_multiple_benchmarks(
        self,
        swe_bench_config: BenchmarkConfig,
        agent_bench_config: BenchmarkConfig,
        webarena_config: BenchmarkConfig,
    ) -> None:
        orch = Orchestrator(max_workers=3)
        run = await orch.evaluate([swe_bench_config, agent_bench_config, webarena_config])
        assert run.status == "completed"
        assert len(run.benchmark_results) == 3
        for bt in ("swe_bench", "agent_bench", "webarena"):
            assert bt in run.benchmark_results
            assert run.benchmark_results[bt].completed_tasks > 0
        orch.shutdown()

    def test_get_run_not_found(self) -> None:
        orch = Orchestrator()
        with pytest.raises(KeyError):
            orch.get_run("nonexistent-run")

    def test_progress_tracking(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=1)
        run = asyncio.get_event_loop().run_until_complete(
            orch.evaluate([swe_bench_config])
        )
        status = orch.get_status(run.run_id)
        assert isinstance(status, EvaluationRun)
        orch.shutdown()


# ── Scoring Engine ─────────────────────────────────────────────────────


class TestScoringEngine:
    """Tests for the MQA scoring engine."""

    @pytest.mark.asyncio
    async def test_compute_scorecard(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=1)
        run = await orch.evaluate([swe_bench_config])
        orch.shutdown()

        engine = ScoringEngine()
        engine.add_history(run)
        scorecard = await engine.compute_scorecard(run)

        assert scorecard.run_id == run.run_id
        assert scorecard.overall_score > 0
        assert len(scorecard.mqa_scores) == 4  # architecture, tests, quality, correctness
        assert len(scorecard.benchmark_scores) == 1
        assert len(scorecard.recommendations) >= 1

    @pytest.mark.asyncio
    async def test_mqa_facet_count(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=1)
        run = await orch.evaluate([swe_bench_config])
        orch.shutdown()

        engine = ScoringEngine()
        scorecard = await engine.compute_scorecard(run)

        facets = {mq.facet for mq in scorecard.mqa_scores}
        assert "architecture" in facets
        assert "tests" in facets
        assert "quality" in facets
        assert "correctness" in facets

    def test_compute_scorecard_pending(self) -> None:
        run = EvaluationRun(status="pending")
        engine = ScoringEngine()
        with pytest.raises(ValueError, match="Cannot score run"):
            asyncio.get_event_loop().run_until_complete(
                engine.compute_scorecard(run)
            )


# ── Cost Tracker ────────────────────────────────────────────────────────


class TestCostTracker:
    """Tests for the cost tracker."""

    def test_record_and_aggregate(self) -> None:
        tracker = CostTracker()
        tracker.record("run-1", "swe_bench", tokens=1000, cost_usd=0.003)
        tracker.record("run-1", "agent_bench", tokens=2000, cost_usd=0.006)

        agg = tracker.aggregate("run-1")
        assert agg["total_tokens"] == 3000
        assert abs(agg["total_cost_usd"] - 0.009) < 0.0001

    def test_check_cap_within(self) -> None:
        tracker = CostTracker()
        tracker.record("run-1", "swe_bench", cost_usd=50.0)
        assert tracker.check_cap("run-1", cap=100.0) is True

    def test_check_cap_exceeded(self) -> None:
        tracker = CostTracker()
        tracker.record("run-1", "swe_bench", cost_usd=150.0)
        assert tracker.check_cap("run-1", cap=100.0) is False

    def test_estimate_cost(self) -> None:
        cost = CostTracker.estimate_cost(10000, "claude-opus")
        assert cost == pytest.approx(0.03, abs=0.001)

    def test_estimate_compute_cost(self) -> None:
        cost = CostTracker.estimate_compute_cost(3600000, "standard")
        assert cost == pytest.approx(1.8, abs=0.01)


# ── Report Generator ────────────────────────────────────────────────────


class TestReportGenerator:
    """Tests for report generation."""

    @pytest.mark.asyncio
    async def test_json_export(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=1)
        run = await orch.evaluate([swe_bench_config])
        orch.shutdown()

        engine = ScoringEngine()
        scorecard = await engine.compute_scorecard(run)
        json_str = ReportGenerator.to_json(scorecard)
        data = json.loads(json_str)
        assert data["run_id"] == run.run_id
        assert data["overall_score"] > 0

    @pytest.mark.asyncio
    async def test_csv_export(self, swe_bench_config: BenchmarkConfig) -> None:
        orch = Orchestrator(max_workers=1)
        run = await orch.evaluate([swe_bench_config])
        orch.shutdown()

        engine = ScoringEngine()
        scorecard = await engine.compute_scorecard(run)
        csv_str = ReportGenerator.to_csv(scorecard)

        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) > 1  # Has header + data

    def test_benchmark_csv(self, swe_bench_config: BenchmarkConfig) -> None:
        results = {
            "swe_bench": BenchmarkResult(
                benchmark_type=BenchmarkType.SWE_BENCH,
                total_tasks=10,
                completed_tasks=10,
                passed_tasks=5,
                average_score=55.0,
                total_tokens=50000,
                total_cost_usd=0.15,
            ),
        }
        csv_str = ReportGenerator.benchmark_results_to_csv(results)
        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) == 2  # header + one data row

    def test_benchmark_json(self, swe_bench_config: BenchmarkConfig) -> None:
        results = {
            "swe_bench": BenchmarkResult(
                benchmark_type=BenchmarkType.SWE_BENCH,
                total_tasks=10,
                passed_tasks=5,
                average_score=55.0,
            ),
        }
        json_str = ReportGenerator.benchmark_results_to_json(results)
        data = json.loads(json_str)
        assert "swe_bench" in data

    def test_trend_report_empty(self) -> None:
        report = ReportGenerator.trend_report([])
        assert "No trend data" in report

    def test_full_report(self, swe_bench_config: BenchmarkConfig) -> None:
        sc = Scorecard(
            run_id="test",
            overall_score=75.0,
            mqa_scores=[
                MQAScore(facet="architecture", score=80.0),
                MQAScore(facet="tests", score=70.0),
            ],
            benchmark_scores={"swe_bench": 75.0},
            recommendations=["Improve tests"],
        )
        report = ReportGenerator.full_report(sc)
        assert "test" in report
        assert "architecture" in report
        assert "Improve tests" in report


# ── Runner Registry ────────────────────────────────────────────────────


class TestRunnerRegistry:
    """Tests for runner type registry."""

    def test_all_known_runners(self) -> None:
        assert get_runner_class("swe_bench") is SWEBenchRunner
        assert get_runner_class("agent_bench") is AgentBenchRunner
        assert get_runner_class("webarena") is WebArenaRunner

    def test_unsupported_benchmark(self) -> None:
        with pytest.raises(ValueError):
            get_runner_class("unknown")
