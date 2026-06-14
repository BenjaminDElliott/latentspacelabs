"""Report generation for benchmark evaluation results.

Generates reports in JSON and CSV formats.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

from agent_bench.models import BenchmarkResult, Scorecard

logger = logging.getLogger(__name__)


class ReportGenerator:
    """Generates evaluation reports in various formats."""

    @staticmethod
    def to_json(scorecard: Scorecard) -> str:
        """Export a scorecard as JSON."""
        return json.dumps(scorecard.model_dump(), indent=2, default=str)

    @staticmethod
    def to_csv(scorecard: Scorecard) -> str:
        """Export a scorecard as CSV."""
        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        writer.writerow([
            "run_id", "overall_score", "timestamp",
        ])

        # Summary row
        writer.writerow([
            scorecard.run_id,
            scorecard.overall_score,
            scorecard.created_at.isoformat(),
        ])

        # MQA facets
        writer.writerow([])
        writer.writerow(["MQA Facet Scores"])
        writer.writerow(["facet", "score", "rationale"])
        for mq in scorecard.mqa_scores:
            writer.writerow([mq.facet, mq.score, mq.rationale])

        # Benchmark scores
        writer.writerow([])
        writer.writerow(["Benchmark Scores"])
        writer.writerow(["benchmark", "average_score"])
        for bt, score in scorecard.benchmark_scores.items():
            writer.writerow([bt, score])

        # Trend data
        if scorecard.trend_data:
            writer.writerow([])
            writer.writerow(["Trend Data"])
            writer.writerow(["benchmark", "old_score", "new_score", "change_pct"])
            for t in scorecard.trend_data:
                writer.writerow([
                    t.get("benchmark", ""),
                    t.get("old_score", ""),
                    t.get("new_score", ""),
                    t.get("change_pct", ""),
                ])

        # Recommendations
        writer.writerow([])
        writer.writerow(["Recommendations"])
        for rec in scorecard.recommendations:
            writer.writerow([rec])

        return output.getvalue()

    @staticmethod
    def benchmark_results_to_json(results: dict[str, BenchmarkResult]) -> str:
        """Export benchmark results as JSON."""
        data = {}
        for bt, result in results.items():
            data[bt] = {
                "total_tasks": result.total_tasks,
                "completed_tasks": result.completed_tasks,
                "passed_tasks": result.passed_tasks,
                "failed_tasks": result.failed_tasks,
                "timeout_tasks": result.timeout_tasks,
                "error_tasks": result.error_tasks,
                "average_score": result.average_score,
                "total_tokens": result.total_tokens,
                "total_cost_usd": result.total_cost_usd,
            }
        return json.dumps(data, indent=2)

    @staticmethod
    def benchmark_results_to_csv(results: dict[str, BenchmarkResult]) -> str:
        """Export benchmark results as CSV."""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "benchmark", "total_tasks", "completed", "passed",
            "failed", "timeout", "error", "avg_score",
            "tokens", "cost_usd",
        ])
        for bt, result in results.items():
            writer.writerow([
                bt, result.total_tasks, result.completed_tasks,
                result.passed_tasks, result.failed_tasks,
                result.timeout_tasks, result.error_tasks,
                result.average_score, result.total_tokens,
                result.total_cost_usd,
            ])
        return output.getvalue()

    @staticmethod
    def trend_report(trend_data: list[dict[str, Any]]) -> str:
        """Generate a human-readable trend report."""
        if not trend_data:
            return "No trend data available."

        lines = [
            "=== Performance Trend Report ===",
            f"Generated: {datetime.now(timezone.utc).isoformat()}",
            "",
        ]

        for t in trend_data:
            bt = t.get("benchmark", "unknown")
            old = t.get("old_score", 0)
            new = t.get("new_score", 0)
            change = t.get("change", 0)
            pct = t.get("change_pct", 0)

            direction = "▲" if change >= 0 else "▼"
            lines.append(f"  {bt}: {old:.1f} → {new:.1f} ({direction} {pct:+.1f}%)")

        return "\n".join(lines)

    @staticmethod
    def full_report(scorecard: Scorecard) -> str:
        """Generate a comprehensive text report."""
        lines = [
            "=" * 60,
            "  Agent Benchmark Evaluation Report",
            "=" * 60,
            "",
            f"  Run ID:      {scorecard.run_id}",
            f"  Scored at:   {scorecard.created_at.isoformat()}",
            f"  Overall:     {scorecard.overall_score:.1f}/100",
            "",
            "  MQA Scores:",
        ]

        for mq in scorecard.mqa_scores:
            bar = "█" * int(mq.score / 5) + "░" * (20 - int(mq.score / 5))
            lines.append(f"    {mq.facet:15} |{bar}| {mq.score:.1f}  {mq.rationale}")

        lines.append("")
        lines.append("  Benchmark Results:")
        for bt, score in scorecard.benchmark_scores.items():
            lines.append(f"    {bt:20} | {score:.1f}/100")

        lines.append("")
        lines.append("  Recommendations:")
        for rec in scorecard.recommendations:
            lines.append(f"    • {rec}")

        lines.append("")
        lines.append("=" * 60)

        return "\n".join(lines)
