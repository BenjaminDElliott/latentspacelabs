"""MQA-style scoring engine with facet analysis.

Computes Multi-Quality Assessment (MQA) scores across facets:
- Architecture (0-100)
- Tests (0-100)
- Quality (0-100)
- Correctness (0-100)

Also provides historical trend analysis and regression detection.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from agent_bench.models import (
    BenchmarkResult,
    EvaluationRun,
    MQAScore,
    Scorecard,
)

logger = logging.getLogger(__name__)


class ScoringEngine:
    """Computes scorecards from evaluation runs.

    The scoring engine:
    1. Computes MQA facet scores from benchmark results
    2. Generates overall summary scores
    3. Provides recommendations
    4. Analyzes historical trends
    """

    # MQA facet definitions with weights
    FACETS = {
        "architecture": {"weight": 0.20, "description": "System design quality"},
        "tests": {"weight": 0.25, "description": "Test coverage and quality"},
        "quality": {"weight": 0.25, "description": "Code quality and maintainability"},
        "correctness": {"weight": 0.30, "description": "Pass rate on benchmark tasks"},
    }

    def __init__(self) -> None:
        self._history: list[EvaluationRun] = []

    def add_history(self, run: EvaluationRun) -> None:
        """Register a completed run for trend analysis."""
        self._history.append(run)
        self._history.sort(key=lambda r: r.created_at)

    async def compute_scorecard(self, run: EvaluationRun) -> Scorecard:
        """Generate a full scorecard from an evaluation run."""
        if run.status not in ("completed", "failed"):
            raise ValueError(f"Cannot score run with status '{run.status}'")

        # 1. Compute benchmark-level scores
        benchmark_scores: dict[str, float] = {}
        for bt, result in run.benchmark_results.items():
            benchmark_scores[bt] = round(result.average_score, 2)

        # 2. Compute MQA facet scores
        mqa_scores = self._compute_mqa_scores(run, benchmark_scores)

        # 3. Compute weighted summary
        summary = self._compute_summary(mqa_scores)

        # 4. Cost analysis
        cost_analysis = self._cost_analysis(run)

        # 5. Trend data
        trend_data = self._trend_analysis(run)

        # 6. Recommendations
        recommendations = self._generate_recommendations(mqa_scores, benchmark_scores, run)

        # 7. Overall score (weighted MQA)
        overall = self._weighted_average(mqa_scores)

        scorecard = Scorecard(
            run_id=run.run_id,
            summary=summary,
            mqa_scores=mqa_scores,
            benchmark_scores=benchmark_scores,
            cost_analysis=cost_analysis,
            trend_data=trend_data,
            recommendations=recommendations,
            overall_score=overall,
        )

        logger.info(
            f"Scorecard generated for {run.run_id}: overall={overall:.1f}, "
            f"cost=${run.total_cost_usd:.2f}"
        )
        return scorecard

    def _compute_mqa_scores(self, run: EvaluationRun,
                            benchmark_scores: dict[str, float]) -> list[MQAScore]:
        """Compute MQA facet scores from benchmark results."""
        results = list(run.benchmark_results.values())
        if not results:
            return [
                MQAScore(facet=f, score=0.0, rationale="No results available")
                for f in self.FACETS
            ]

        # Correctness: weighted by task volume
        total_tasks = sum(r.total_tasks for r in results)
        total_passed = sum(r.passed_tasks for r in results)
        correctness_score = (total_passed / total_tasks * 100) if total_tasks > 0 else 0.0

        # Architecture: derived from score distribution (higher scores suggest better design)
        avg_score = sum(benchmark_scores.values()) / len(benchmark_scores) if benchmark_scores else 0
        architecture_score = min(100, avg_score * 1.1)  # Scale up slightly

        # Tests: based on consistency across benchmarks (lower variance = better tests)
        if len(benchmark_scores) > 1:
            scores_list = list(benchmark_scores.values())
            mean = sum(scores_list) / len(scores_list)
            variance = sum((s - mean) ** 2 for s in scores_list) / len(scores_list)
            test_score = max(0, 100 - variance * 2)
        else:
            test_score = avg_score

        # Quality: blend of correctness and consistency
        quality_score = (correctness_score * 0.5 + test_score * 0.5)

        return [
            MQAScore(
                facet=facet,
                score=round(min(100, max(0, score)), 2),
                rationale=self._facet_rationale(facet, score),
                details=self._facet_details(facet, run),
            )
            for facet, score in [
                ("architecture", architecture_score),
                ("tests", test_score),
                ("quality", quality_score),
                ("correctness", correctness_score),
            ]
        ]

    def _facet_rationale(self, facet: str, score: float) -> str:
        """Generate a human-readable rationale for a facet score."""
        if score >= 80:
            return "Strong performance in this area."
        if score >= 60:
            return "Good performance with room for improvement."
        if score >= 40:
            return "Moderate performance — targeted improvements recommended."
        return "Needs significant improvement."

    def _facet_details(self, facet: str, run: EvaluationRun) -> dict[str, Any]:
        """Generate detailed metrics for a facet."""
        return {
            "total_benchmarks": len(run.benchmark_results),
            "total_tasks": sum(r.total_tasks for r in run.benchmark_results.values()),
            "total_cost_usd": run.total_cost_usd,
            "total_tokens": run.total_tokens,
        }

    def _compute_summary(self, mqa_scores: list[MQAScore]) -> dict[str, float]:
        """Compute weighted summary scores."""
        summary = {}
        for mq in mqa_scores:
            facet_info = self.FACETS.get(mq.facet, {})
            weight = facet_info.get("weight", 0.25)
            summary[mq.facet] = round(mq.score * weight, 2)
        return summary

    def _cost_analysis(self, run: EvaluationRun) -> dict[str, float]:
        """Compute cost analysis metrics."""
        total = run.total_cost_usd
        return {
            "total_cost_usd": round(total, 4),
            "cost_per_task": round(total / max(1, sum(r.total_tasks for r in run.benchmark_results.values())), 6),
            "cost_per_token": round(total / max(1, run.total_tokens), 10),
            "cost_per_hour": round(total / max(0.001, sum(r.total_duration_seconds for r in run.benchmark_results.values()) / 3600), 2),
        }

    def _trend_analysis(self, run: EvaluationRun) -> list[dict[str, Any]]:
        """Analyze performance trends from historical runs."""
        trends: list[dict[str, Any]] = []
        if len(self._history) < 2:
            return trends

        current = run
        for prev in self._history:
            if prev.run_id == run.run_id:
                continue
            if not prev.benchmark_results or not current.benchmark_results:
                continue

            common = set(prev.benchmark_results.keys()) & set(current.benchmark_results.keys())
            for bt in common:
                old_score = prev.benchmark_results[bt].average_score
                new_score = current.benchmark_results[bt].average_score
                change = new_score - old_score
                change_pct = (change / old_score * 100) if old_score > 0 else 0

                trends.append({
                    "benchmark": bt,
                    "prev_run": prev.run_id,
                    "current_run": run.run_id,
                    "old_score": round(old_score, 2),
                    "new_score": round(new_score, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                })

        return trends

    def _generate_recommendations(self, mqa_scores: list[MQAScore],
                                   benchmark_scores: dict[str, float],
                                   run: EvaluationRun) -> list[str]:
        """Generate actionable recommendations based on scores."""
        recs: list[str] = []

        for mq in mqa_scores:
            if mq.score < 50:
                recs.append(f"Improve '{mq.facet}' score ({mq.score:.0f}/100): {mq.rationale}")

        for bt, score in benchmark_scores.items():
            if score < 40:
                recs.append(f"Benchmark '{bt}' underperforming ({score:.0f}/100) — review agent prompt and tools.")
            elif score > 80:
                recs.append(f"Benchmark '{bt}' excelling ({score:.0f}/100) — consider harder task subset.")

        # Check cost against config cap
        cost_cap = 100.0  # default
        for cfg in run.benchmark_configs:
            if cfg.cost_cap < cost_cap:
                cost_cap = cfg.cost_cap
        if run.total_cost_usd > cost_cap:
            recs.append(f"Cost overrun: spent ${run.total_cost_usd:.2f} vs cap ${cost_cap:.2f}. Optimize token usage.")

        if not recs:
            recs.append("All benchmarks performing well. No immediate actions needed.")

        return recs

    def _weighted_average(self, mqa_scores: list[MQAScore]) -> float:
        """Compute overall score from MQA facets."""
        total_weight = 0
        weighted_sum = 0
        for mq in mqa_scores:
            facet_info = self.FACETS.get(mq.facet, {})
            weight = facet_info.get("weight", 0.25)
            weighted_sum += mq.score * weight
            total_weight += weight
        return round(weighted_sum / max(1, total_weight), 2)
