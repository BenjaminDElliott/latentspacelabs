"""Retry Decorator with Exponential Backoff for Hermes Agent Cron Jobs.

This is a thin re-export of retry_decorator for convenience.
See retry_decorator.py for the full implementation.

Usage:
    from retry import retry
    from retry import NetworkError, ParseError, TransientError, PermanentError

No external dependencies — uses only Python stdlib.
"""

from retry_decorator import (
    NetworkError,
    ParseError,
    PermanentError,
    TransientError,
    RetryExhaustedError,
    classify_error,
    retry,
)

__all__ = [
    "retry",
    "classify_error",
    "TransientError",
    "PermanentError",
    "NetworkError",
    "ParseError",
    "RetryExhaustedError",
]
