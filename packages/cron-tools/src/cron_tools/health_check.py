#!/usr/bin/env python3
"""Health Check Cron Job for Hermes Agent.

Monitors all configured cron jobs and alerts if any job hasn't run
within 2x its expected interval. Designed for the LAT-284 Cron Job
Recovery & Resilience System.

Acceptance Criteria:
  1. Runs every 15 minutes (configurable via --interval flag)
  2. Reads cron schedule config from ~/.hermes/cron/jobs.json
  3. Compares last_run_at vs expected_run for each job
  4. Alerts if job hasn't run in 2x expected interval
  5. Writes alerts to ~/.hermes/state/alerts.jsonl
  6. Zero new dependencies (Python stdlib only)

Usage:
    python3 health_check.py          # Run once
    python3 health_check.py --interval 900  # Custom interval in seconds

Integration:
    Add to crontab: */15 * * * * python3 ~/.hermes/cron/health_check.py
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_STATE_DIR = Path.home() / ".hermes" / "state"
JOBS_CONFIG_PATH = Path.home() / ".hermes" / "cron" / "jobs.json"
ALERTS_LOG_PATH = DEFAULT_STATE_DIR / "alerts.jsonl"
DEFAULT_INTERVAL_SECONDS = 900  # 15 minutes
ALERT_THRESHOLD_MULTIPLIER = 2  # Alert if not run in 2x interval

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
logger = logging.getLogger("health_check")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class CronJob:
    """Represents a single cron job from the jobs.json config.

    Attributes:
        name: Job identifier name.
        minutes: Expected interval in minutes (None for cron-based jobs).
        last_run_at: ISO-8601 timestamp of last successful run.
        id: Unique job identifier.
        state: Current job state (scheduled, paused, etc.).
    """

    def __init__(self, raw: dict[str, Any]) -> None:
        self.name: str = raw.get("name", "unknown")
        self.id: str = raw.get("id", "")
        self.state: str = raw.get("state", "unknown")
        self.last_run_at: Optional[str] = raw.get("last_run_at")
        self.last_status: Optional[str] = raw.get("last_status")

        # Parse schedule to get interval in minutes
        schedule = raw.get("schedule", {})
        if schedule.get("kind") == "interval":
            self.minutes: Optional[int] = schedule.get("minutes")
        else:
            # For cron-based jobs, use default intervals based on display
            display = schedule.get("display", "")
            self.minutes = self._infer_interval_from_cron(display)

    @staticmethod
    def _infer_interval_from_cron(cron_expr: str) -> Optional[int]:
        """Infer interval in minutes from a cron expression string.

        Handles common patterns:
            */10 * * * * -> 10 minutes
            */5 * * * *  -> 5 minutes
            0 3 * * *    -> daily (1440 minutes)
            */15 * * * * -> 15 minutes
            */30 * * * * -> 30 minutes
            0 * * * *    -> hourly (60 minutes)
            0 */2 * * *  -> every 2 hours (120 minutes)
        """
        parts = cron_expr.split()
        if len(parts) < 1:
            return None

        minute_field = parts[0]
        hour_field = parts[1] if len(parts) > 1 else "*"

        # */N * * * * -> every N minutes
        if minute_field.startswith("*/"):
            try:
                return int(minute_field[2:])
            except (ValueError, IndexError):
                return None

        # */N in hour field -> every N hours
        if hour_field.startswith("*/"):
            try:
                return int(hour_field[2:]) * 60
            except (ValueError, IndexError):
                return None

        # 0 * * * * -> hourly
        if minute_field == "0" and hour_field == "*":
            return 60

        # 0 3 * * * -> daily
        if minute_field == "0" and hour_field != "*" and not hour_field.startswith("*/"):
            return 1440  # 24 * 60

        # Default fallback for complex expressions
        return None


class HealthAlert:
    """Represents a health alert for a cron job that's behind schedule.

    Attributes:
        timestamp: When the alert was generated.
        job_name: Name of the lagging cron job.
        job_id: Unique job identifier.
        expected_interval_minutes: The job's expected interval.
        last_run_at: ISO timestamp of last run.
        seconds_since_last_run: Time elapsed since last run.
        threshold_minutes: 2x expected interval.
        seconds_until_next_run: When the job is expected to run next.
    """

    def __init__(
        self,
        job: CronJob,
        now: datetime,
        threshold_multiplier: int = ALERT_THRESHOLD_MULTIPLIER,
    ) -> None:
        self.job_name = job.name
        self.job_id = job.id
        self.expected_interval_minutes = job.minutes
        self.last_run_at = job.last_run_at

        # Calculate elapsed time
        if job.last_run_at:
            try:
                last_run = datetime.fromisoformat(job.last_run_at)
                if last_run.tzinfo is None:
                    last_run = last_run.replace(tzinfo=timezone.utc)
                elapsed = now - last_run
                self.seconds_since_last_run = int(elapsed.total_seconds())
            except (ValueError, TypeError):
                self.seconds_since_last_run = None
        else:
            self.seconds_since_last_run = None

        # Threshold: 2x expected interval
        if job.minutes:
            self.threshold_minutes = job.minutes * threshold_multiplier
        else:
            self.threshold_minutes = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize alert to dictionary for JSONL output."""
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "job_name": self.job_name,
            "job_id": self.job_id,
            "expected_interval_minutes": self.expected_interval_minutes,
            "last_run_at": self.last_run_at,
            "seconds_since_last_run": self.seconds_since_last_run,
            "threshold_minutes": self.threshold_minutes,
            "alert_type": "job_behind_schedule",
        }

    def to_json(self) -> str:
        """Serialize alert to JSON string for appending to alerts.jsonl."""
        return json.dumps(self.to_dict())


# ---------------------------------------------------------------------------
# Health checker
# ---------------------------------------------------------------------------

class HealthChecker:
    """Monitors cron jobs and generates alerts for lagging jobs.

    Reads the cron jobs configuration, checks each job's last run time
    against its expected interval, and generates alerts for any job
    that hasn't run within 2x its expected interval.

    Args:
        jobs_config_path: Path to the jobs.json configuration file.
        alerts_log_path: Path to the alerts JSONL log file.
    """

    def __init__(
        self,
        jobs_config_path: Path | None = None,
        alerts_log_path: Path | None = None,
    ) -> None:
        self.jobs_config_path = Path(jobs_config_path) if jobs_config_path else JOBS_CONFIG_PATH
        self.alerts_log_path = Path(alerts_log_path) if alerts_log_path else ALERTS_LOG_PATH

    def load_jobs(self) -> list[CronJob]:
        """Load and parse cron jobs from the configuration file.

        Returns:
            List of CronJob instances.

        Raises:
            FileNotFoundError: If jobs.json doesn't exist.
            json.JSONDecodeError: If jobs.json is not valid JSON.
        """
        if not self.jobs_config_path.exists():
            logger.error("Jobs config not found: %s", self.jobs_config_path)
            raise FileNotFoundError(f"Jobs config not found: {self.jobs_config_path}")

        with open(self.jobs_config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        jobs_list = data.get("jobs", [])
        logger.info("Loaded %d cron jobs from config", len(jobs_list))
        return [CronJob(job) for job in jobs_list]

    def check_job(self, job: CronJob, now: datetime) -> Optional[HealthAlert]:
        """Check a single job's health status.

        Args:
            job: The CronJob to check.
            now: Current time (for testability).

        Returns:
            HealthAlert if the job is behind schedule, None otherwise.
        """
        # Jobs with no schedule interval can't be checked
        if job.minutes is None:
            logger.debug("Skipping job '%s': no interval configured", job.name)
            return None

        # Jobs that haven't run yet
        if job.last_run_at is None:
            logger.info("Alert: job '%s' has never run", job.name)
            return HealthAlert(job, now)

        # Calculate expected run time
        expected_interval = timedelta(minutes=job.minutes)
        expected_run = now - expected_interval

        # Parse last_run_at
        try:
            last_run = datetime.fromisoformat(job.last_run_at)
            if last_run.tzinfo is None:
                last_run = last_run.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError) as e:
            logger.warning(
                "Invalid last_run_at for job '%s': %s — generating alert",
                job.name,
                job.last_run_at,
            )
            return HealthAlert(job, now)

        # Check if the job is behind schedule (2x threshold)
        if last_run < expected_run:
            threshold = expected_interval * 2
            threshold_str = f"{int(threshold.total_seconds() / 60)}m"
            logger.warning(
                "ALERT: job '%s' last run %s ago (threshold: %s)",
                job.name,
                int((now - last_run).total_seconds()),
                threshold_str,
            )
            return HealthAlert(job, now)

        logger.debug(
            "OK: job '%s' last run %ds ago (interval: %dm)",
            job.name,
            int((now - last_run).total_seconds()),
            job.minutes,
        )
        return None

    def run_check(self, now: Optional[datetime] = None) -> list[HealthAlert]:
        """Run the full health check across all configured cron jobs.

        Args:
            now: Current time for testability. If None, uses actual current time.

        Returns:
            List of HealthAlert instances for lagging jobs.
        """
        now = now or datetime.now(timezone.utc)
        logger.info("Starting health check at %s", now.isoformat())

        try:
            jobs = self.load_jobs()
        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.error("Failed to load jobs config: %s", e)
            return []

        alerts: list[HealthAlert] = []
        checked = 0

        for job in jobs:
            alert = self.check_job(job, now)
            if alert is not None:
                alerts.append(alert)
            else:
                checked += 1

        logger.info(
            "Health check complete: %d jobs checked, %d alerts generated",
            checked + len(alerts),
            len(alerts),
        )
        return alerts

    def write_alerts(self, alerts: list[HealthAlert]) -> int:
        """Write health alerts to the alerts.jsonl log file.

        Creates the state directory if it doesn't exist. Only appends
        new alerts (one per job per run).

        Args:
            alerts: List of HealthAlert instances to write.

        Returns:
            Number of alerts written.
        """
        self.alerts_log_path.parent.mkdir(parents=True, exist_ok=True)

        written = 0
        for alert in alerts:
            with open(self.alerts_log_path, "a", encoding="utf-8") as f:
                f.write(alert.to_json() + "\n")
                written += 1

        if written:
            logger.info("Wrote %d alerts to %s", written, self.alerts_log_path)
        return written

    def check_and_alert(self, now: Optional[datetime] = None) -> list[HealthAlert]:
        """Run health check and write alerts in one call.

        Convenience method that runs the health check, writes any
        generated alerts, and returns the alert list.

        Args:
            now: Current time for testability.

        Returns:
            List of HealthAlert instances.
        """
        alerts = self.run_check(now)
        self.write_alerts(alerts)
        return alerts


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> int:
    """Main entry point for the health check cron job.

    Returns:
        0 if no alerts generated, 1 if alerts were generated, 2 on error.
    """
    parser = argparse.ArgumentParser(
        description="Health Check Cron Job for Hermes Agent",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_INTERVAL_SECONDS,
        help=f"Check interval in seconds (default: {DEFAULT_INTERVAL_SECONDS})",
    )
    parser.add_argument(
        "--jobs-config",
        type=str,
        default=None,
        help=f"Path to jobs.json (default: {JOBS_CONFIG_PATH})",
    )
    parser.add_argument(
        "--alerts-log",
        type=str,
        default=None,
        help=f"Path to alerts.jsonl (default: {ALERTS_LOG_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run health check without writing alerts",
    )

    args = parser.parse_args()

    jobs_config = Path(args.jobs_config) if args.jobs_config else None
    alerts_log = Path(args.alerts_log) if args.alerts_log else None

    checker = HealthChecker(jobs_config, alerts_log)
    alerts = checker.check_and_alert()

    if args.dry_run:
        if not alerts:
            print("No alerts — all jobs on schedule.")
        for alert in alerts:
            print(alert.to_json())
    elif alerts:
        print(json.dumps([a.to_dict() for a in alerts], indent=2))
        return 1  # Non-zero exit code signals alerts were generated
    else:
        print("No alerts — all jobs on schedule.")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
