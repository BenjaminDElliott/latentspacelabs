"""Tests for the health_check.py cron job module.

Tests cover:
  - Alert threshold detection (AC4: alerts if job hasn't run in 2x expected interval)
  - Alert threshold boundary (just below 2x: no alert)
  - Jobs never run
  - Invalid timestamps
  - Jobs with no interval (cron-based)
  - Loading jobs from config
  - Alert serialization
  - Multiple jobs with mixed status

Usage:
    python -m pytest tests/test_health_check.py -v
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

# Import from the health check module in ~/.hermes/cron
import sys
# Add both paths: the ~/.hermes/cron/ copy and the repo source
sys.path.insert(0, str(Path.home() / ".hermes" / "cron"))
sys.path.insert(
    0,
    str(Path(__file__).resolve().parent.parent / "src" / "cron_tools"),
)

# Import from ~/.hermes/cron/ health_check.py (the canonical deployment copy)
from health_check import (
    ALERT_THRESHOLD_MULTIPLIER,
    CronJob,
    HealthAlert,
    HealthChecker,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_jobs_config(jobs_data: list[dict]) -> Path:
    """Create a temporary jobs.json file with given job data."""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, prefix="jobs_",
    )
    json.dump({"jobs": jobs_data}, tmp)
    tmp.close()
    return Path(tmp.name)


def _now() -> datetime:
    """Current UTC time for test consistency."""
    return datetime.now(timezone.utc)


def _make_job(
    name: str = "test-job",
    minutes: int = 5,
    last_run_offset_min: float = 0,
    last_run_at: str | None = None,
    cron_expr: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Build a raw job dict matching the jobs.json schema."""
    now = now or datetime.now(timezone.utc)

    if last_run_at:
        lra = last_run_at
    elif last_run_offset_min == 0:
        lra = now.isoformat()
    else:
        lra = (now - timedelta(minutes=last_run_offset_min)).isoformat()

    job: dict = {
        "id": f"id-{name}",
        "name": name,
        "enabled": True,
        "state": "scheduled",
        "last_run_at": lra,
        "last_status": "ok",
        "last_error": None,
    }

    if cron_expr:
        job["schedule"] = {
            "kind": "cron",
            "expr": cron_expr,
            "display": cron_expr,
        }
    else:
        job["schedule"] = {
            "kind": "interval",
            "minutes": minutes,
            "display": f"every {minutes}m",
        }

    return job


# ---------------------------------------------------------------------------
# Alert threshold detection (AC4)
# ---------------------------------------------------------------------------

class TestAlertThresholdDetection:
    """Verify alert threshold detection: alerts if job hasn't run in 2x expected interval."""

    def test_alert_when_behind_2x_threshold(self):
        """A job that last ran 3x its interval ago should generate an alert.

        With a 5-minute interval and 2x threshold (10 min),
        a last_run 15 minutes ago triggers an alert.
        """
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(minutes=5, last_run_offset_min=15)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None, "Expected alert for job behind 2x threshold"
        assert alert.job_name == "test-job"
        assert alert.threshold_minutes == 10  # 5 * 2

    def test_no_alert_when_within_2x_threshold(self):
        """A job that last ran 1.5x its interval ago should NOT generate an alert.

        With a 5-minute interval and 2x threshold (10 min),
        a last_run 7 minutes ago should be OK.
        """
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(minutes=5, last_run_offset_min=7, now=now)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is None, "Expected no alert for job within 2x threshold"

    def test_alert_at_exact_2x_boundary(self):
        """A job exactly at 2x threshold should generate an alert (last_run < expected_run)."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        last_run = now - timedelta(minutes=10)  # exactly 2 * 5 minutes
        job_data = _make_job(minutes=5, last_run_at=last_run.isoformat())

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None, "Expected alert at exact 2x boundary"

    def test_alert_for_hourly_job_missing_3_hours(self):
        """An hourly job (60 min interval) missing for 3 hours should alert."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(name="hourly-job", minutes=60, last_run_offset_min=180)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None
        assert alert.job_name == "hourly-job"
        assert alert.threshold_minutes == 120  # 60 * 2

    def test_alert_for_15min_job_missing_35_min(self):
        """A 15-minute job missing for 35 minutes should alert (threshold is 30 min)."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(name="pm-sequencing", minutes=15, last_run_offset_min=35)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None
        assert alert.threshold_minutes == 30  # 15 * 2


class TestJobNeverRun:
    """Tests for jobs that have never been run."""

    def test_alert_when_job_never_ran(self):
        """A job with no last_run_at should always generate an alert."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(name="new-job", last_run_at=None, now=now)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None
        assert alert.job_name == "new-job"
        assert alert.threshold_minutes == 10  # 5 * 2

    def test_seconds_since_last_run_none_when_never_ran(self):
        """seconds_since_last_run should be None when job never ran."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        job_data = _make_job(name="new-job", last_run_at=None, now=now)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None
        assert alert.seconds_since_last_run is None


class TestInvalidTimestamps:
    """Tests for jobs with invalid last_run_at timestamps."""

    def test_alert_for_invalid_timestamp(self):
        """A job with an unparseable last_run_at should generate an alert."""
        job_data = _make_job(name="bad-timestamp", last_run_at="not-a-timestamp")

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None


class TestCronBasedJobs:
    """Tests for jobs using cron expressions instead of interval schedules."""

    def test_cron_10min_job(self):
        """A cron job with */10 should infer 10 minute interval."""
        job_data = _make_job(
            name="self-improvement",
            cron_expr="*/10 * * * *",
            last_run_offset_min=25,
        )
        checker = HealthChecker()
        job = CronJob(job_data)

        assert job.minutes == 10  # inferred from */10

        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        alert = checker.check_job(job, now)
        assert alert is not None  # 25 min > 2 * 10 min

    def test_cron_hourly_job(self):
        """A cron job with 0 * * * * should infer 60 minute interval."""
        job_data = _make_job(
            name="hourly-cron",
            cron_expr="0 * * * *",
            last_run_offset_min=90,
        )
        checker = HealthChecker()
        job = CronJob(job_data)

        assert job.minutes == 60  # inferred from 0 * * * *

        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        alert = checker.check_job(job, now)
        assert alert is not None  # 90 min > 2 * 60 min

    def test_cron_daily_job(self):
        """A cron job with 0 3 * * * should infer 1440 minute (daily) interval."""
        job_data = _make_job(
            name="daily-cron",
            cron_expr="0 3 * * *",
            last_run_offset_min=2000,
        )
        checker = HealthChecker()
        job = CronJob(job_data)

        assert job.minutes == 1440  # daily


class TestAlertSerialization:
    """Tests for HealthAlert serialization to JSONL format."""

    def test_alert_to_dict(self):
        """Alert.to_dict() should produce a serializable dict with expected fields."""
        job_data = _make_job(minutes=5, last_run_offset_min=15)
        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None
        d = alert.to_dict()

        assert "timestamp" in d
        assert d["job_name"] == "test-job"
        assert d["job_id"] == "id-test-job"
        assert d["expected_interval_minutes"] == 5
        assert d["threshold_minutes"] == 10
        assert d["alert_type"] == "job_behind_schedule"
        assert isinstance(d["seconds_since_last_run"], int)

    def test_alert_to_json(self):
        """Alert.to_json() should produce valid JSON."""
        job_data = _make_job(minutes=5, last_run_offset_min=15)
        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None
        json_str = alert.to_json()
        parsed = json.loads(json_str)  # Should not raise

        assert parsed["job_name"] == "test-job"


class TestLoadJobsFromConfig:
    """Tests for loading jobs from the configuration file."""

    def test_load_jobs_success(self):
        """Should load all jobs from a valid config file."""
        jobs_data = [
            _make_job(name="job-a", minutes=5),
            _make_job(name="job-b", minutes=10),
            _make_job(name="job-c", minutes=15),
        ]
        config_path = _make_jobs_config(jobs_data)

        try:
            checker = HealthChecker(jobs_config_path=config_path)
            jobs = checker.load_jobs()

            assert len(jobs) == 3
            assert jobs[0].name == "job-a"
            assert jobs[1].name == "job-b"
            assert jobs[2].name == "job-c"
        finally:
            config_path.unlink()

    def test_load_jobs_empty_config(self):
        """Should return empty list when config has no jobs."""
        config_path = _make_jobs_config([])

        try:
            checker = HealthChecker(jobs_config_path=config_path)
            jobs = checker.load_jobs()
            assert len(jobs) == 0
        finally:
            config_path.unlink()

    def test_load_jobs_missing_file(self):
        """Should raise FileNotFoundError for missing config."""
        checker = HealthChecker(jobs_config_path=Path("/tmp/nonexistent-jobs.json"))

        with pytest.raises(FileNotFoundError):
            checker.load_jobs()

    def test_load_jobs_invalid_json(self):
        """Should raise json.JSONDecodeError for invalid JSON."""
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, prefix="jobs_",
        )
        tmp.write("not valid json {{{")
        tmp.close()

        try:
            checker = HealthChecker(jobs_config_path=Path(tmp.name))
            with pytest.raises(json.JSONDecodeError):
                checker.load_jobs()
        finally:
            Path(tmp.name).unlink()


class TestHealthCheckIntegration:
    """Integration tests for full health check runs."""

    def test_mixed_status_multiple_jobs(self):
        """Full check should alert only on lagging jobs, not healthy ones."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)

        jobs_data = [
            # Healthy: ran 3 minutes ago (interval 5 min, threshold 10 min)
            _make_job(name="healthy-job", minutes=5, last_run_offset_min=3, now=now),
            # Lagging: ran 20 minutes ago (interval 5 min, threshold 10 min)
            _make_job(name="lagging-job", minutes=5, last_run_offset_min=20, now=now),
            # Healthy: ran 20 minutes ago (interval 15 min, threshold 30 min)
            _make_job(name="healthy-15min", minutes=15, last_run_offset_min=20, now=now),
        ]
        config_path = _make_jobs_config(jobs_data)
        alerts_path = tempfile.NamedTemporaryFile(
            suffix=".jsonl", delete=False, prefix="alerts_",
        ).name

        try:
            checker = HealthChecker(
                jobs_config_path=config_path,
                alerts_log_path=Path(alerts_path),
            )
            alerts = checker.run_check(now)

            # Only "lagging-job" should trigger alert
            assert len(alerts) == 1
            assert alerts[0].job_name == "lagging-job"

            # Write alerts to file
            written = checker.write_alerts(alerts)
            assert written == 1

            # Verify alert was written to file
            with open(alerts_path, "r") as f:
                lines = [l.strip() for l in f if l.strip()]
            assert len(lines) == 1
            parsed = json.loads(lines[0])
            assert parsed["job_name"] == "lagging-job"
            assert parsed["alert_type"] == "job_behind_schedule"
        finally:
            config_path.unlink()
            Path(alerts_path).unlink(missing_ok=True)

    def test_all_jobs_healthy(self):
        """When all jobs are on schedule, no alerts should be generated."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)

        jobs_data = [
            _make_job(name="fast-job", minutes=5, last_run_offset_min=2),
            _make_job(name="slow-job", minutes=15, last_run_offset_min=10),
        ]
        config_path = _make_jobs_config(jobs_data)
        alerts_path = tempfile.NamedTemporaryFile(
            suffix=".jsonl", delete=False, prefix="alerts_",
        ).name

        try:
            checker = HealthChecker(
                jobs_config_path=config_path,
                alerts_log_path=Path(alerts_path),
            )
            alerts = checker.run_check(now)

            assert len(alerts) == 0
        finally:
            config_path.unlink()
            Path(alerts_path).unlink(missing_ok=True)

    def test_run_check_all_never_ran(self):
        """When all jobs have never run, all should alert."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)

        jobs_data = [
            _make_job(name="never-1", minutes=5, last_run_at=None),
            _make_job(name="never-2", minutes=10, last_run_at=None),
        ]
        config_path = _make_jobs_config(jobs_data)

        try:
            checker = HealthChecker(jobs_config_path=config_path)
            alerts = checker.run_check(now)

            assert len(alerts) == 2
        finally:
            config_path.unlink()


class TestInferredIntervals:
    """Tests for cron expression interval inference."""

    def test_infer_5min_cron(self):
        assert CronJob._infer_interval_from_cron("*/5 * * * *") == 5

    def test_infer_10min_cron(self):
        assert CronJob._infer_interval_from_cron("*/10 * * * *") == 10

    def test_infer_15min_cron(self):
        assert CronJob._infer_interval_from_cron("*/15 * * * *") == 15

    def test_infer_30min_cron(self):
        assert CronJob._infer_interval_from_cron("*/30 * * * *") == 30

    def test_infer_hourly_cron(self):
        assert CronJob._infer_interval_from_cron("0 * * * *") == 60

    def test_infer_daily_cron(self):
        assert CronJob._infer_interval_from_cron("0 3 * * *") == 1440

    def test_infer_2hourly_cron(self):
        assert CronJob._infer_interval_from_cron("0 */2 * * *") == 120

    def test_infer_complex_cron(self):
        """Complex cron expressions return None (can't infer)."""
        assert CronJob._infer_interval_from_cron("0 9,17 * * 1-5") is None


class TestSecondsSinceLastRun:
    """Tests for seconds_since_last_run calculation."""

    def test_seconds_since_last_run_calculated(self):
        """seconds_since_last_run should reflect actual elapsed time."""
        now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
        last_run = now - timedelta(minutes=7, seconds=30)
        job_data = _make_job(minutes=5, last_run_at=last_run.isoformat())

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, now)

        assert alert is not None
        expected_seconds = 7 * 60 + 30  # 450
        assert alert.seconds_since_last_run == expected_seconds

    def test_seconds_since_last_run_for_never_ran(self):
        """seconds_since_last_run should be None for jobs that never ran."""
        job_data = _make_job(name="never", last_run_at=None)

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None
        assert alert.seconds_since_last_run is None


class TestNoIntervalJobs:
    """Tests for jobs without interval schedules."""

    def test_skip_jobs_with_no_interval(self):
        """Jobs with no interval should be skipped (no alert)."""
        job_data = _make_job(name="complex-cron", cron_expr="0 9,17 * * 1-5")

        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is None  # Can't determine if behind schedule


class TestHealthAlertModel:
    """Tests for HealthAlert model fields."""

    def test_alert_contains_expected_interval(self):
        """Alert should contain the job's expected interval in minutes."""
        job_data = _make_job(name="5min-job", minutes=5)
        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None
        assert alert.expected_interval_minutes == 5

    def test_alert_contains_expected_interval_minutes(self):
        """Alert should store the expected_interval_minutes field."""
        job_data = _make_job(name="15min-job", minutes=15)
        checker = HealthChecker()
        job = CronJob(job_data)
        alert = checker.check_job(job, _now())

        assert alert is not None
        assert alert.expected_interval_minutes == 15
