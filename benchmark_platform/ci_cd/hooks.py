"""
CI/CD integration hooks.

Provides hooks for integrating the benchmark platform with CI/CD pipelines,
webhook triggers, Slack notifications, and Linear issue tracking.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from benchmark_platform.config import CICDConfig, PlatformConfig
from benchmark_platform.models.schemas import (
    EvaluationRun,
    ReportData,
    RegressionAlert,
)

logger = logging.getLogger(__name__)


class CICDHooks:
    """CI/CD integration hooks for benchmark evaluations.

    Integrates with:
    - Generic webhooks (JSON payload)
    - Slack (via incoming webhooks)
    - Linear (via API for issue tracking)
    - GitHub Actions / GitLab CI (via environment variables)
    """

    def __init__(self, config: Optional[CICDConfig] = None) -> None:
        self.config = config or CICDConfig()

    # ------------------------------------------------------------------
    # Run completion hook
    # ------------------------------------------------------------------

    def on_run_complete(self, run: EvaluationRun, report: ReportData) -> None:
        """Called when an evaluation run completes."""
        logger.info("CI/CD hook triggered for run %s (benchmark=%s, status=%s)",
                     run.run_id, run.benchmark.value, run.status.value)

        self._notify_slack(run, report)
        self._send_webhook(run, report)
        self._create_linear_issue(run, report)

    def on_regression_detected(self, alert: RegressionAlert) -> None:
        """Called when a regression is detected."""
        logger.warning("Regression hook triggered: %s", alert)
        self._notify_slack_alert(alert)
        self._send_webhook_alert(alert)

    # ------------------------------------------------------------------
    # Slack notifications
    # ------------------------------------------------------------------

    def _notify_slack(self, run: EvaluationRun, report: ReportData) -> None:
        """Send a Slack message about run completion."""
        if not self.config.slack_webhook_url:
            return

        try:
            import requests

            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": f"🏁 Benchmark Run Complete: {run.benchmark.value}",
                    },
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Agent:* {run.agent_name}"},
                        {"type": "mrkdwn", "text": f"*Model:* {run.model}"},
                        {"type": "mrkdwn", "text": f"*Score:* {report.pass_rate:.2%}"},
                        {"type": "mrkdwn", "text": f"*Cost:* ${report.total_cost_usd:.2f}"},
                        {"type": "mrkdwn", "text": f"*Instances:* {report.total_instances}"},
                        {"type": "mrkdwn", "text": f"*Status:* {run.status.value}"},
                    ],
                },
            ]

            payload = {
                "text": f"Benchmark run {report.run_id} completed",
                "blocks": blocks,
            }
            requests.post(
                self.config.slack_webhook_url,
                json=payload,
                timeout=10,
            )
            logger.info("Slack notification sent for run %s", run.run_id)
        except Exception as exc:
            logger.error("Failed to send Slack notification: %s", exc)

    def _notify_slack_alert(self, alert: RegressionAlert) -> None:
        """Send a Slack alert for a performance regression."""
        if not self.config.slack_webhook_url:
            return

        try:
            import requests

            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": f"📉 Regression Detected: {alert.benchmark.value}",
                    },
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Agent:* {alert.agent_name}"},
                        {"type": "mrkdwn", "text": f"*Current Score:* {alert.current_score:.3f}"},
                        {"type": "mrkdwn", "text": f"*Previous Avg:* {alert.previous_avg_score:.3f}"},
                        {"type": "mrkdwn", "text": f"*Drop:* {alert.score_delta_pct:.1f}%"},
                        {"type": "mrkdwn", "text": f"*Threshold:* {alert.threshold_pct}%"},
                    ],
                },
            ]

            payload = {
                "text": f"Regression alert: {alert}",
                "blocks": blocks,
            }
            requests.post(
                self.config.slack_webhook_url,
                json=payload,
                timeout=10,
            )
        except Exception as exc:
            logger.error("Failed to send Slack alert: %s", exc)

    # ------------------------------------------------------------------
    # Generic webhook
    # ------------------------------------------------------------------

    def _send_webhook(self, run: EvaluationRun, report: ReportData) -> None:
        """Send run data to a generic webhook endpoint."""
        if not self.config.webhook_url:
            return

        try:
            import requests

            payload = {
                "event": "benchmark_run_complete",
                "run_id": run.run_id,
                "benchmark": run.benchmark.value,
                "agent_name": run.agent_name,
                "model": run.model,
                "status": run.status.value,
                "pass_rate": run.aggregate_score,
                "total_cost_usd": run.cost.total_cost_usd,
                "total_tokens": run.cost.input_tokens + run.cost.output_tokens,
                "total_instances": run.total_instances,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            }

            requests.post(
                self.config.webhook_url,
                json=payload,
                headers=self.config.webhook_headers,
                timeout=10,
            )
            logger.info("Webhook notification sent for run %s", run.run_id)
        except Exception as exc:
            logger.error("Failed to send webhook: %s", exc)

    def _send_webhook_alert(self, alert: RegressionAlert) -> None:
        """Send regression alert to generic webhook."""
        if not self.config.webhook_url:
            return

        try:
            import requests

            payload = {
                "event": "benchmark_regression",
                "benchmark": alert.benchmark.value,
                "agent_name": alert.agent_name,
                "current_score": alert.current_score,
                "previous_avg_score": alert.previous_avg_score,
                "score_delta_pct": alert.score_delta_pct,
                "threshold_pct": alert.threshold_pct,
                "detected_at": alert.detected_at.isoformat(),
                "message": alert.message,
            }

            requests.post(
                self.config.webhook_url,
                json=payload,
                headers=self.config.webhook_headers,
                timeout=10,
            )
        except Exception as exc:
            logger.error("Failed to send regression webhook: %s", exc)

    # ------------------------------------------------------------------
    # Linear integration
    # ------------------------------------------------------------------

    def _create_linear_issue(self, run: EvaluationRun, report: ReportData) -> None:
        """Create a Linear issue for tracking benchmark results."""
        if not self.config.linear_api_key:
            return

        try:
            import requests

            # Format result summary
            summary = (
                f"# Benchmark Results: {run.benchmark.value}\n\n"
                f"- **Agent:** {run.agent_name}\n"
                f"- **Model:** {run.model}\n"
                f"- **Pass Rate:** {report.pass_rate:.2%}\n"
                f"- **Cost:** ${report.total_cost_usd:.2f}\n"
                f"- **Tokens:** {report.total_tokens:,}\n"
                f"- **Instances:** {report.total_instances}\n"
                f"- **Run ID:** `{run.run_id}`\n"
            )

            payload = {
                "title": f"Benchmark: {run.benchmark.value} - {run.agent_name} ({report.pass_rate:.0%})",
                "description": summary,
            }

            response = requests.post(
                "https://api.linear.app/v1/mutations",
                json={"query": 'mutation { issueCreate(input: $input) { success } }',
                      "variables": {"input": payload}},
                headers={
                    "Authorization": self.config.linear_api_key,
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            response.raise_for_status()
            logger.info("Linear issue created for run %s", run.run_id)
        except Exception as exc:
            logger.error("Failed to create Linear issue: %s", exc)
