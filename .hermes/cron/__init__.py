"""Hermes Agent Cron Job Recovery & Resilience System.

Modules:
    error_logger: Structured JSONL error logging with rotation.
    retry: Retry decorator with exponential backoff.
    idempotency: SQLite-backed idempotency key tracking.
    health_check: Schedule verification and alerting.

All modules use only Python stdlib — zero external dependencies.

Usage
-----
    from retry import retry
    from retry import NetworkError, ParseError, TransientError, PermanentError
    from idempotency import IdempotencyManager, make_key, make_key_from_dict, run_idempotently
    from error_logger import ErrorLogger, ErrorType, classify_error
    from health_check import HealthChecker

    # Retry a flaky function
    @retry(max_attempts=5, base_delay=1.0)
    def fetch_data():
        ...

    # Idempotent execution
    mgr = IdempotencyManager()
    key = make_key("linear-triage", "payload")
    if not mgr.is_duplicate(key):
        mgr.record(key, job_name="linear-triage")
        ...

    # Error logging
    logger = ErrorLogger()
    logger.log_error(job_name="my-job", error=ConnectionError("timeout"))

    # Health check
    checker = HealthChecker()
    alerts = checker.check_and_alert()

Packages exposed:
    error_logger
    retry
    idempotency
    health_check
"""

__all__ = [
    "error_logger",
    "retry",
    "idempotency",
    "health_check",
]

__version__ = "0.1.0"
