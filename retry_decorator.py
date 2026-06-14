"""Retry Decorator with Exponential Backoff for Hermes Agent Cron Jobs.

Provides a @retry decorator that:
- Retries transient errors with exponential backoff
- Immediately raises permanent errors without retry
- Classifies errors: network → transient, parse → permanent
- Logs each retry attempt for observability

Backoff schedule: base_delay * 2^(attempt-1)
  e.g. base_delay=1.0: 1s → 2s → 4s → 8s → 16s

Usage:
    @retry(max_attempts=5, base_delay=1.0)
    def my_cron_job():
        ...

No external dependencies — uses only Python stdlib.
"""

import functools
import logging
import time
import traceback
from typing import Callable, Type, Union

logger = logging.getLogger("retry_decorator")

# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------


class TransientError(Exception):
    """Error that is likely temporary and worth retrying."""


class PermanentError(Exception):
    """Error that is unlikely to succeed on retry."""


class NetworkError(TransientError):
    """Network-related transient failure (connection refused, timeout, etc.)."""


class ParseError(PermanentError):
    """Parse/serialization failure (invalid JSON, malformed response, etc.)."""


class RetryExhaustedError(Exception):
    """All retry attempts for a transient error have been exhausted."""

    def __init__(self, cause: Exception, max_attempts: int):
        self.cause = cause
        self.max_attempts = max_attempts
        super().__init__(
            f"Transient error exhausted all {max_attempts} attempts. "
            f"Last error: {cause}"
        )


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

# Exceptions that Linear considers transient (network / I/O)
TRANSIENT_EXCEPTIONS: tuple = (
    NetworkError,
    TransientError,
    ConnectionError,
    TimeoutError,
    OSError,
)

# Exceptions that Linear considers permanent
PERMANENT_EXCEPTIONS: tuple = (
    ParseError,
    PermanentError,
)


def classify_error(exc: Exception) -> str:
    """Classify an exception as 'transient' or 'permanent'.

    Args:
        exc: The exception to classify.

    Returns:
        'transient' — likely recoverable, worth retrying
        'permanent' — unlikely to recover, raise immediately
    """
    if isinstance(exc, PERMANENT_EXCEPTIONS):
        return "permanent"
    if isinstance(exc, TRANSIENT_EXCEPTIONS):
        return "transient"
    # Default to transient (conservative — retrying a few extra times is
    # safer than silently failing on unknown error types)
    return "transient"


# ---------------------------------------------------------------------------
# Retry decorator
# ---------------------------------------------------------------------------


def retry(
    max_attempts: int = 5,
    base_delay: float = 1.0,
) -> Callable:
    """Decorator that retries a function with exponential backoff.

    Args:
        max_attempts: Maximum number of times to try the function (default 5).
        base_delay: Base delay in seconds for backoff calculation.
            Actual delay = base_delay * 2^(attempt - 1).

    The decorator:
    1. Catches each exception from the wrapped function.
    2. Classifies it as transient or permanent via classify_error().
    3. For transient errors: sleeps (base_delay * 2^retry) and retries.
    4. For permanent errors: logs and re-raises immediately.
    5. Raises RetryExhaustedError if all transient retries are exhausted.

    Example:
        @retry(max_attempts=5, base_delay=1.0)
        def fetch_data():
            response = requests.get(url)
            return json.loads(response.text)

    Backoff timeline (base_delay=1.0, 3 attempts):
        Attempt 1: fail → sleep 1s
        Attempt 2: fail → sleep 2s
        Attempt 3: fail → RetryExhaustedError (no further sleep)
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception: Union[Exception, None] = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_exception = exc
                    classification = classify_error(exc)

                    if classification == "permanent":
                        logger.error(
                            "Permanent error in %s (attempt %d): %s — no retry. "
                            "Traceback:\n%s",
                            func.__qualname__,
                            attempt,
                            exc,
                            traceback.format_exc(),
                        )
                        raise  # re-raise permanent errors immediately

                    # Transient error — retry or give up
                    if attempt < max_attempts:
                        delay = base_delay * (2 ** (attempt - 1))
                        logger.warning(
                            "Transient error in %s (attempt %d/%d): %s. "
                            "Retrying in %.2fs. Traceback:\n%s",
                            func.__qualname__,
                            attempt,
                            max_attempts,
                            exc,
                            delay,
                            traceback.format_exc(),
                        )
                        time.sleep(delay)
                    else:
                        # Last attempt failed — raise RetryExhaustedError
                        logger.error(
                            "Transient error exhausted all %d attempts in %s. "
                            "Last error: %s. Traceback:\n%s",
                            max_attempts,
                            func.__qualname__,
                            exc,
                            traceback.format_exc(),
                        )
                        raise RetryExhaustedError(exc, max_attempts) from exc

            # Should not reach here, but just in case
            assert last_exception is not None
            raise RetryExhaustedError(last_exception, max_attempts) from last_exception

        return wrapper

    return decorator
