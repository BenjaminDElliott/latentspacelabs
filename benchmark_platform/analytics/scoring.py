"""
Scoring engine with MQA-style facet analysis.

Evaluates agent performance across multiple quality dimensions:
- Architecture: How well the agent structures its approach
- Tests: Pass rate on test suites
- Quality: Code quality, readability, efficiency
- Correctness: Accuracy against ground-truth answers
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from benchmark_platform.models.schemas import BenchmarkResult, EvaluationRun

logger = logging.getLogger(__name__)


class ScoringEngine:
    """Multi-dimensional scoring engine.

    Produces scorecards with MQA-style facet analysis (Architecture, Quality,
    Accuracy/Tests) for each evaluation run and per-instance results.
    """

    def __init__(
        self,
        facet_weights: Optional[Dict[str, float]] = None,
    ) -> None:
        # MQA-style facets with configurable weights
        self.facet_weights = facet_weights or {
            "correctness": 0.40,
            "test_pass_rate": 0.30,
            "quality": 0.15,
            "architecture": 0.10,
            "efficiency": 0.05,
        }
        logger.info("ScoringEngine initialized with facets: %s", self.facet_weights)

    def score_run(self, run: EvaluationRun) -> Dict[str, Any]:
        """Compute the full scorecard for an evaluation run."""
        results = run.results
        if not results:
            return {"error": "No results to score"}

        # Per-facet scores
        scores = {
            "correctness": self._score_correctness(results),
            "test_pass_rate": self._score_test_pass_rate(results),
            "quality": self._score_quality(results),
            "architecture": self._score_architecture(results),
            "efficiency": self._score_efficiency(run, results),
        }

        # Weighted composite score
        composite = sum(
            scores.get(facet, 0) * weight
            for facet, weight in self.facet_weights.items()
        )

        return {
            "run_id": run.run_id,
            "benchmark": run.benchmark.value,
            "agent_name": run.agent_name,
            "model": run.model,
            "composite_score": round(composite, 4),
            "facets": {k: round(v, 4) for k, v in scores.items()},
            "facet_weights": self.facet_weights,
            "total_instances": run.total_instances,
            "pass_rate": run.aggregate_score,
            "total_cost_usd": run.cost.total_cost_usd,
            "total_tokens": run.cost.input_tokens + run.cost.output_tokens,
            "duration_seconds": run.duration_seconds,
            "per_instance": [
                {
                    "instance_id": r.instance_id,
                    "score": r.score,
                    "status": r.status.value,
                    "details": r.details,
                }
                for r in results
            ],
        }

    # ------------------------------------------------------------------
    # Per-facet scoring methods
    # ------------------------------------------------------------------

    def _score_correctness(self, results: List[BenchmarkResult]) -> float:
        """Score based on correctness — exact match to expected answers."""
        if not results:
            return 0.0
        total = sum(r.score for r in results)
        return total / len(results)

    def _score_test_pass_rate(self, results: List[BenchmarkResult]) -> float:
        """Score based on test pass rate (pass instances / total)."""
        run = self._get_run_from_results(results)
        if run is None or run.total_instances == 0:
            return 0.0
        return run.passed_instances / run.total_instances

    def _score_quality(self, results: List[BenchmarkResult]) -> float:
        """Score based on output quality heuristics."""
        # Heuristic: longer, more detailed responses scored higher
        if not results:
            return 0.0
        scores = []
        for r in results:
            detail_score = r.details.get("score", 0)
            # Penalize extremely verbose responses
            detail_len = len(r.details.get("agent_answer", r.details.get("patch_length", 0)))
            quality_bonus = min(0.1, detail_len / 10000)
            scores.append(min(1.0, detail_score + quality_bonus))
        return sum(scores) / len(scores)

    def _score_architecture(self, results: List[BenchmarkResult]) -> float:
        """Score based on approach quality / structure."""
        if not results:
            return 0.0
        scores = []
        for r in results:
            steps = r.details.get("steps_taken", r.details.get("steps", 0))
            # Optimal step range: 3-15 steps
            if 3 <= steps <= 15:
                scores.append(1.0)
            elif steps < 3:
                scores.append(0.5)
            elif steps <= 30:
                scores.append(0.75)
            else:
                scores.append(0.3)
        return sum(scores) / len(scores)

    def _score_efficiency(self, run: EvaluationRun, results: List[BenchmarkResult]) -> float:
        """Score based on cost efficiency (tokens/cost per result)."""
        if not run.results or run.cost.total_cost_usd == 0:
            return 0.0
        # Lower cost per successful instance = higher score
        successful = run.passed_instances
        if successful == 0:
            return 0.0
        cost_per_pass = run.cost.total_cost_usd / successful
        # Normalize: $0.01/pass = 1.0, $1.00/pass = 0.5, $10+/pass = 0.1
        score = max(0.0, min(1.0, 1.0 - (cost_per_pass - 0.01) / 1.0))
        return score

    def _get_run_from_results(self, results: List[BenchmarkResult]):
        """Extract the EvaluationRun from a list of BenchmarkResults."""
        if not results:
            return None
        first = results[0]
        # Build a minimal run object with the counters we need
        run = EvaluationRun(
            run_id="scoring",
            benchmark=first.benchmark,
            agent_name="scoring",
            model="scoring",
            total_instances=len(results),
            passed_instances=sum(1 for r in results if r.status.value == "pass"),
            failed_instances=sum(1 for r in results if r.status.value == "fail"),
            error_instances=sum(1 for r in results if r.status.value == "error"),
            timeout_instances=sum(1 for r in results if r.status.value == "timeout"),
        )
        return run
