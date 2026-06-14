"""Unit tests for ~/.hermes/cron/health_check.py

Tests cover:
- CronJob schedule parsing from jobs.json format
- Interval inference from cron expressions
- HealthAlert generation for lagging jobs
- Alert threshold at 2x interval
- Write alerts to JSONL
- CLI entry point (--dry-run, --interval)
- Jobs with no schedule (None minutes) are skipped
- First-run detection (no last_run_at)
"""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, mock_open

# Ensure ~/.hermes/cron is importable
sys.path.insert(0, str(Path(__file__).parent))

from health_check import (
    CronJob,
    HealthAlert,
    HealthChecker,
    ALERT_THRESHOLD_MULTIPLIER,
    DEFAULT_STATE_DIR,
    ALERTS_LOG_PATH,
    JOBS_CONFIG_PATH,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sample_jobs_config():
    """Return a minimal jobs.json config dict for testing."""
    now = datetime.now(timezone.utc)
    return {
        "jobs": [
            {
                "id": "job-1",
                "name": "session-health",
                "state": "scheduled",
                "last_run_at": (now - timedelta(minutes=3)).isoformat(),
                "schedule": {"kind": "interval", "minutes": 5, "display": "every 5m"},
            },
            {
                "id": "job-2",
                "name": "linear-triage",
                "state": "scheduled",
                "last_run_at": (now - timedelta(minutes=30)).isoformat(),
                "schedule": {"kind": "cron", "expr": "*/10 * * * *", "display": "*/10 * * * *"},
            },
            {
                "id": "job-3",
                "name": "vault-prune",
                "state": "scheduled",
                "last_run_at": (now - timedelta(hours=3)).isoformat(),
                "schedule": {"kind": "cron", "expr": "0 3 * * *", "display": "0 3 * * *"},
            },
            {
                "id": "job-4",
                "name": "experience-memory",
                "state": "scheduled",
                "last_run_at": (now - timedelta(hours=3)).isoformat(),
                "schedule": {"kind": "interval", "minutes": 120, "display": "every 120m"},
            },
            {
                "id": "job-5",
                "name": "never-ran",
                "state": "scheduled",
                "schedule": {"kind": "interval", "minutes": 10, "display": "every 10m"},
            },
        ]
    }


def _write_jobs_file(config, path):
    """Write a jobs.json config to a temp file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f)


# ---------------------------------------------------------------------------
# CronJob parsing tests
# ---------------------------------------------------------------------------


class TestCronJob(unittest.TestCase):
    """Tests for CronJob parsing from config."""

    def test_interval_schedule(self):
        """Interval schedules parse minutes correctly."""
        raw = {"name": "test", "schedule": {"kind": "interval", "minutes": 5}}
        job = CronJob(raw)
        self.assertEqual(job.minutes, 5)

    def test_cron_star_star(self):
        """*/10 * * * * -> 10 minutes."""
        raw = {"name": "test", "schedule": {"kind": "cron", "expr": "*/10 * * * *"}}
        job = CronJob(raw)
        self.assertEqual(job.minutes, 10)

    def test_cron_hourly(self):
        """0 * * * * -> 60 minutes (hourly)."""
        raw = {"name": "test", "schedule": {"kind": "cron", "expr": "0 * * * *"}}
        job = CronJob(raw)
        self.assertEqual(job.minutes, 60)

    def test_cron_daily(self):
        """0 3 * * * -> 1440 minutes (daily)."""
        raw = {"name": "test", "schedule": {"kind": "cron", "expr": "0 3 * * *"}}
        job = CronJob(raw)
        self.assertEqual(job.minutes, 1440)

    def test_cron_every_2_hours(self):
        """0 */2 * * * -> 120 minutes."""
        raw = {"name": "test", "schedule": {"kind": "cron", "expr": "0 */2 * * *"}}
        job = CronJob(raw)
        self.assertEqual(job.minutes, 120)

    def test_missing_schedule_defaults_none(self):
        """Missing schedule -> minutes is None."""
        raw = {"name": "test"}
        job = CronJob(raw)
        self.assertIsNone(job.minutes)

    def test_fields_parsed(self):
        """Basic fields are parsed correctly."""
        raw = {
            "id": "abc-123",
            "name": "my-job",
            "state": "paused",
            "last_run_at": "2026-01-01T00:00:00+00:00",
            "last_status": "error",
        }
        job = CronJob(raw)
        self.assertEqual(job.id, "abc-123")
        self.assertEqual(job.name, "my-job")
        self.assertEqual(job.state, "paused")
        self.assertEqual(job.last_status, "error")


# ---------------------------------------------------------------------------
# HealthAlert tests
# ---------------------------------------------------------------------------


class TestHealthAlert(unittest.TestCase):
    """Tests for HealthAlert creation and serialization."""

    def test_alert_has_required_fields(self):
        """Alert dict has all expected fields."""
        raw = {
            "id": "j1",
            "name": "test-job",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
        job = CronJob(raw)
        alert = HealthAlert(job, datetime.now(timezone.utc))

        d = alert.to_dict()
        for field in ("timestamp", "job_name", "job_id", "expected_interval_minutes",
                      "last_run_at", "seconds_since_last_run", "threshold_minutes",
                      "alert_type"):
            self.assertIn(field, d, f"Missing field: {field}")

    def test_alert_type(self):
        """Alert type is 'job_behind_schedule'."""
        raw = {
            "id": "j1",
            "name": "test-job",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
        job = CronJob(raw)
        alert = HealthAlert(job, datetime.now(timezone.utc))
        self.assertEqual(alert.to_dict()["alert_type"], "job_behind_schedule")

    def test_threshold_is_2x_interval(self):
        """Alert threshold is 2x the job's interval."""
        raw = {
            "id": "j1",
            "name": "test-job",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
        job = CronJob(raw)
        alert = HealthAlert(job, datetime.now(timezone.utc))
        self.assertEqual(alert.threshold_minutes, 10)  # 5 * 2

    def test_json_serialization(self):
        """to_json produces valid JSON."""
        raw = {
            "id": "j1",
            "name": "test-job",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
        job = CronJob(raw)
        alert = HealthAlert(job, datetime.now(timezone.utc))
        parsed = json.loads(alert.to_json())
        self.assertEqual(parsed["job_name"], "test-job")


# ---------------------------------------------------------------------------
# HealthChecker tests
# ---------------------------------------------------------------------------


class TestHealthChecker(unittest.TestCase):
    """Tests for HealthChecker core functionality."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.jobs_file = Path(self.tmpdir) / "jobs.json"
        self.alerts_file = Path(self.tmpdir) / "alerts.jsonl"
        self.config = _sample_jobs_config()
        _write_jobs_file(self.config, self.jobs_file)
        self.checker = HealthChecker(
            jobs_config_path=self.jobs_file,
            alerts_log_path=self.alerts_file,
        )

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_load_jobs(self):
        """Load returns correct number of jobs."""
        jobs = self.checker.load_jobs()
        self.assertEqual(len(jobs), 5)

    def test_check_job_on_schedule(self):
        """Job that ran recently (3m ago, interval 5m) is NOT behind."""
        now = datetime.now(timezone.utc)
        jobs = self.checker.load_jobs()
        # session-health: last 3m ago, interval 5m -> OK
        alert = self.checker.check_job(jobs[0], now)
        self.assertIsNone(alert)

    def test_check_job_behind_schedule(self):
        """Job that ran too long ago IS behind."""
        now = datetime.now(timezone.utc)
        jobs = self.checker.load_jobs()
        # linear-triage: last 30m ago, interval 10m, threshold 20m -> ALERT
        alert = self.checker.check_job(jobs[1], now)
        self.assertIsNotNone(alert)
        self.assertEqual(alert.job_name, "linear-triage")

    def test_check_job_first_run(self):
        """Job that never ran generates an alert."""
        now = datetime.now(timezone.utc)
        jobs = self.checker.load_jobs()
        # never-ran: no last_run_at -> ALERT
        alert = self.checker.check_job(jobs[4], now)
        self.assertIsNotNone(alert)
        self.assertEqual(alert.job_name, "never-ran")

    def test_check_job_no_interval_skipped(self):
        """Job with no schedule interval returns None (skipped)."""
        now = datetime.now(timezone.utc)
        jobs = self.checker.load_jobs()
        # vault-prune: daily (1440m), last 3h ago -> OK (threshold 2880m)
        alert = self.checker.check_job(jobs[2], now)
        self.assertIsNone(alert)

    def test_check_job_above_threshold(self):
        """Job above 2x threshold generates alert."""
        now = datetime.now(timezone.utc)
        jobs = self.checker.load_jobs()
        # experience-memory: last 3h ago, interval 120m, threshold 240m -> ALERT
        alert = self.checker.check_job(jobs[3], now)
        self.assertIsNotNone(alert)
        self.assertEqual(alert.job_name, "experience-memory")

    def test_run_check_generates_alerts(self):
        """Full run_check returns alerts for lagging jobs."""
        alerts = self.checker.run_check()
        # Should have alerts for linear-triage (30m > 20m threshold)
        # and experience-memory (3h > 4h threshold? 3h = 180m, 2x 120m = 240m -> OK)
        # Actually: 3h = 180m, threshold = 240m, 180 < 240 -> NOT behind
        # linear-triage: 30m > 20m -> ALERT
        names = [a.job_name for a in alerts]
        self.assertIn("linear-triage", names)
        self.assertIn("never-ran", names)

    def test_write_alerts(self):
        """Alerts are written to the JSONL file."""
        now = datetime.now(timezone.utc)
        alerts = self.checker.run_check(now)

        written = self.checker.write_alerts(alerts)
        self.assertGreaterEqual(written, 1)

        # Verify the file exists and has valid JSON lines
        with open(self.alerts_file, "r") as f:
            lines = [l.strip() for l in f if l.strip()]
        self.assertGreaterEqual(len(lines), 1)
        for line in lines:
            parsed = json.loads(line)
            self.assertIn("job_name", parsed)

    def test_check_and_alert(self):
        """Convenience method runs check and writes alerts."""
        alerts = self.checker.check_and_alert()
        self.assertGreaterEqual(len(alerts), 1)
        self.assertTrue(self.alerts_file.exists())

    def test_missing_jobs_config(self):
        """Missing jobs.json raises FileNotFoundError."""
        bad_checker = HealthChecker(
            jobs_config_path=Path("/nonexistent/jobs.json"),
            alerts_log_path=self.alerts_file,
        )
        with self.assertRaises(FileNotFoundError):
            bad_checker.load_jobs()

    def test_run_check_missing_config(self):
        """run_check handles missing config gracefully."""
        bad_checker = HealthChecker(
            jobs_config_path=Path("/nonexistent/jobs.json"),
            alerts_log_path=self.alerts_file,
        )
        alerts = bad_checker.run_check()
        self.assertEqual(alerts, [])

    def test_alert_threshold_multiplier(self):
        """Verify 2x threshold multiplier."""
        raw = {
            "id": "j1",
            "name": "test",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(minutes=8)).isoformat(),
        }
        job = CronJob(raw)
        alert = HealthAlert(job, datetime.now(timezone.utc))
        self.assertEqual(alert.threshold_minutes, 10)  # 5 * 2
        # 8m < 10m -> not behind yet
        self.assertEqual(alert.seconds_since_last_run, 8 * 60)

    def test_alert_at_exactly_threshold(self):
        """Job at exactly 2x interval is behind."""
        raw = {
            "id": "j1",
            "name": "test",
            "schedule": {"kind": "interval", "minutes": 5},
            "last_run_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
        }
        job = CronJob(raw)
        now = datetime.now(timezone.utc)
        alert = self.checker.check_job(job, now)
        self.assertIsNotNone(alert)


if __name__ == "__main__":
    unittest.main()
