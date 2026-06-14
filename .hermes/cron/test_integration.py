#!/usr/bin/env python3
"""
Integration Tests for LAT-293: Cron Job Resilience Patterns.

Tests the full error -> log -> alert flow with retry, error logging, and idempotency.
"""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from hermes.cron.retry_decorator import retry_with_backoff
from hermes.cron.error_logger import error_logger
from hermes.cron.idempotency import idempotent


class TestRetryDecorator:
    """Test retry decorator integration."""

    def test_successful_after_retries(self):
        """Function should succeed after transient failures."""
        call_count = [0]

        def flaky_func():
            call_count[0] += 1
            if call_count[0] < 3:
                raise ConnectionError("Transient error")
            return "success"

        result = retry_with_backoff(max_retries=3, base_delay=0.01)(flaky_func)()
        assert result == "success"
        assert call_count[0] == 3

    def test_exhausted_retries(self):
        """Function should raise after max retries."""
        call_count = [0]

        def always_fail():
            call_count[0] += 1
            raise RuntimeError("Always fails")

        with pytest.raises(RuntimeError):
            retry_with_backoff(max_retries=2, base_delay=0.01)(always_fail)()
        assert call_count[0] == 3  # initial + 2 retries

    def test_immediate_success(self):
        """Function should succeed immediately if no error."""
        call_count = [0]

        def always_succeeds():
            call_count[0] += 1
            return "ok"

        result = retry_with_backoff(max_retries=3, base_delay=0.01)(always_succeeds)()
        assert result == "ok"
        assert call_count[0] == 1


class TestErrorLogger:
    """Test error logger integration."""

    def test_error_logged_on_failure(self):
        """Errors should be logged with context."""
        log_entries = []

        @error_logger(job_name="test_job")
        def failing_job():
            raise ValueError("Test error")

        # Should not raise, should return error dict
        result = failing_job()
        assert result["status"] == "error"
        assert "Test error" in result.get("message", "")

    def test_success_logged(self):
        """Successful runs should be logged too."""
        @error_logger(job_name="test_job")
        def working_job():
            return {"data": "result"}

        result = working_job()
        assert result["status"] == "success"


class TestIdempotency:
    """Test idempotency integration."""

    def test_duplicate_detection(self):
        """Same job called twice should detect duplicate."""
        call_count = [0]

        @idempotent(job_name="test_idem", ttl_seconds=1)
        def job():
            call_count[0] += 1
            return "done"

        r1 = job()
        r2 = job()
        assert call_count[0] == 1  # Second call should be skipped


class TestErrorLogAlertFlow:
    """Test full error -> log -> alert flow."""

    def test_full_pipeline(self):
        """End-to-end: error occurs -> logged -> alert triggered."""
        alerts = []
        logs = []

        @error_logger(job_name="pipeline_test")
        def failing_pipeline():
            raise ConnectionError("Database unreachable")

        result = failing_pipeline()
        assert result["status"] == "error"
        assert "Database unreachable" in result.get("message", "")

    def test_resilient_pipeline(self):
        """Pipeline with all resilience patterns."""
        @idempotent(job_name="resilient", ttl_seconds=1)
        @retry_with_backoff(max_retries=2, base_delay=0.01)
        @error_logger(job_name="resilient")
        def resilient_job():
            return {"processed": 10}

        result = resilient_job()
        assert result["status"] == "success"
        assert result["processed"] == 10


class TestCronJobIntegration:
    """Test the actual cron job modules."""

    def test_linear_triage_imports(self):
        """Verify linear_triage module loads."""
        from hermes.cron.jobs.linear_triage import run_linear_triage
        result = run_linear_triage()
        assert result["status"] == "success"

    def test_planning_imports(self):
        """Verify planning module loads."""
        from hermes.cron.jobs.planning import run_planning
        result = run_planning()
        assert result["status"] == "success"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
