"""
Regression detection logic.

Monitors benchmark scores over time and triggers alerts when performance
drops below a configurable threshold. Integrates with cost/accuracy analytics
to provide context-aware alerts.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np

from benchmark_platform.analytics.cost_accuracy import CostAccuracyAnalytics
from benchmark_platform.config import RegressionConfig
from benchmark_platform.models.schemas import (
    BenchmarkName,
    EvaluationRun,
    RegressionAlert,
)

logger = logging.getLogger(__name__)


class RegressionDetector:
    """Detects performance regressions across evaluation runs.

    Compares recent run scores against a rolling baseline (mean of previous N runs).
    When a drop exceeds the threshold, triggers an alert via configured channels.
    """

    def __init__(
        self,
        config: Optional[RegressionConfig] = None,
        analytics: Optional[CostAccuracyAnalytics] = None,
    ) -> None:
        self.config = config or RegressionConfig()
        self.analytics = analytics
        self._alerts: List[RegressionAlert] = []

    def evaluate_run(self, run: EvaluationRun) -> List[RegressionAlert]:
        """Evaluate a completed run against historical baselines.

        Returns a list of alerts triggered (empty if no regression detected).
        """
        if run.status.value != "completed":
            return []

        if not self.config.enabled:
            return []

        benchmark = run.benchmark.value
        agent = run.agent_name

        alerts = self._check_regression(run, benchmark, agent)
        self._alerts.extend(alerts)

        # Dispatch alerts
        for alert in alerts:
            self._dispatch_alert(alert)

        return alerts

    def get_alerts(
        self,
        benchmark: Optional[BenchmarkName] = None,
        agent: Optional[str] = None,
        limit: int = 20,
    ) -> List[RegressionAlert]:
        """Get historical alerts, optionally filtered."""
        filtered = self._alerts
        if benchmark:
            filtered = [a for a in filtered if a.benchmark == benchmark]
        if agent:
            filtered = [a for a in filtered if a.agent_name == agent]
        return filtered[-limit:]

    def clear_alerts(self) -> int:
        """Clear all alerts. Returns count cleared."""
        count = len(self._alerts)
        self._alerts.clear()
        return count

    # ------------------------------------------------------------------
    # Private methods
    # ------------------------------------------------------------------

    def _check_regression(
        self, run: EvaluationRun, benchmark: str, agent: str
    ) -> List[RegressionAlert]:
        """Check if the current run shows a regression."""
        if not self.analytics:
            return []

        trend = self.analytics.get_accuracy_trend(benchmark, agent)
        if len(trend) < self.config.lookback_runs:
            return []  # Not enough history yet

        current_score = run.aggregate_score
        historical = trend[:-1]  # Exclude current run

        if not historical:
            return []

        # Calculate baseline statistics
        scores = [h["accuracy"] for h in historical]
        mean_score = float(np.mean(scores))
        std_score = float(np.std(scores))

        # Detect regression: score dropped significantly
        delta = mean_score - current_score
        if delta <= 0:
            return []  # Score improved or stable

        delta_pct = (delta / max(0.001, mean_score)) * 100

        if delta_pct >= self.config.threshold_percent:
            alert = RegressionAlert(
                benchmark=run.benchmark,
                agent_name=agent,
                current_score=current_score,
                previous_avg_score=mean_score,
                score_delta_pct=delta_pct,
                detected_at=datetime.utcnow(),
                threshold_pct=self.config.threshold_percent,
                message=(
                    f"Score dropped {delta_pct:.1f}% from baseline "
                    f"({current_score:.3f} vs avg {mean_score:.3f}). "
                    f"StdDev: {std_score:.4f}"
                ),
            )
            logger.warning("Regression detected: %s", alert)
            return [alert]

        return []

    def _dispatch_alert(self, alert: RegressionAlert) -> None:
        """Send alert through configured channels."""
        alert_text = str(alert)

        for channel in self.config.alert_channels:
            if channel == "console":
                logger.warning("ALERT: %s", alert_text)
            elif channel == "log":
                logger.info("ALERT_LOG: %s", alert_text)
            else:
                logger.warning("Unknown alert channel: %s", channel)
