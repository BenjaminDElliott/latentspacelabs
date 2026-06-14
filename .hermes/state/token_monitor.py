"""
Token Monitor: Real-time context usage tracking with configurable threshold triggering.

Monitors context token usage in real-time and triggers management actions at 70% budget
(by default). Uses a deterministic, model-agnostic approach — no LLM judgment needed.

Design decisions:
- Token estimation via character approximation (chars / 4 ≈ tokens for English text)
- Per-turn budget tracking with cumulative session totals
- Threshold configurable per-session via `token_budget` parameter
- Thread-safe counters using threading.Lock
- Fast (< 1ms) per-operation overhead via O(1) arithmetic
"""

import time
import threading
import logging
from dataclasses import dataclass
from typing import Optional, Callable

logger = logging.getLogger(__name__)

# Approximate tokens per character for English text.
# Conservative estimate: 1 token ≈ 4 characters.
TOKEN_CHAR_RATIO = 0.25


@dataclass
class TokenUsageSnapshot:
    """Immutable snapshot of token usage at a point in time."""
    total_tokens: int
    session_tokens: int
    budget_tokens: int
    usage_percent: float
    turn_count: int
    timestamp: float
    threshold_exceeded: bool

    @property
    def remaining_tokens(self) -> int:
        return max(0, self.budget_tokens - self.session_tokens)

    @property
    def remaining_percent(self) -> float:
        return max(0.0, 100.0 - self.usage_percent)


@dataclass
class TokenMonitorEvent:
    """Event fired when a token threshold is triggered."""
    event_type: str  # "threshold_warning", "threshold_critical", "budget_exceeded"
    usage_percent: float
    timestamp: float
    message: str


class TokenMonitor:
    """
    Real-time token usage tracker with threshold triggering.

    Tracks token counts per-turn and for the full session, triggering
    callbacks when usage crosses configured thresholds (default: 70%).

    Usage:
        monitor = TokenMonitor(token_budget=128_000, warning_threshold=0.70)
        tokens_used = monitor.estimate_tokens("Hello world")
        monitor.record_turn(tokens_used)
        if monitor.is_threshold_exceeded:
            trigger_summarization()
    """

    def __init__(
        self,
        token_budget: int = 128_000,
        warning_threshold: float = 0.70,
        critical_threshold: float = 0.90,
        on_warning: Optional[Callable[[TokenMonitorEvent], None]] = None,
        on_critical: Optional[Callable[[TokenMonitorEvent], None]] = None,
        on_exceeded: Optional[Callable[[TokenMonitorEvent], None]] = None,
    ):
        self.token_budget = token_budget
        # Store thresholds as fractions (0.0-1.0) but convert to percent for comparisons
        self.warning_threshold = warning_threshold
        self.critical_threshold = critical_threshold

        # Callbacks for threshold events
        self.on_warning = on_warning
        self.on_critical = on_critical
        self.on_exceeded = on_exceeded

        # State
        self._lock = threading.Lock()
        self._session_tokens = 0
        self._turn_tokens = 0
        self._turn_count = 0
        self._events_fired: dict[str, bool] = {
            "warning": False,
            "critical": False,
            "exceeded": False,
        }

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estimate token count from text length using character approximation.

        Uses a conservative ratio: ~4 characters per token for English text.
        For more precise counting, pass an explicit token count.
        """
        if not text:
            return 0
        return max(1, int(len(text) * TOKEN_CHAR_RATIO))

    def _usage_percent(self) -> float:
        """Calculate current usage percentage."""
        if self.token_budget <= 0:
            return 100.0
        return min(self._session_tokens / self.token_budget * 100, 100.0)

    def get_snapshot(self) -> TokenUsageSnapshot:
        """Get a thread-safe snapshot of current token usage."""
        with self._lock:
            usage_percent = self._usage_percent()
            threshold_exceeded = usage_percent >= self.warning_threshold * 100

            return TokenUsageSnapshot(
                total_tokens=self._session_tokens + self._turn_tokens,
                session_tokens=self._session_tokens,
                budget_tokens=self.token_budget,
                usage_percent=round(usage_percent, 2),
                turn_count=self._turn_count,
                timestamp=time.time(),
                threshold_exceeded=threshold_exceeded,
            )

    def record_turn(self, tokens: int) -> Optional[TokenMonitorEvent]:
        """Record tokens used in a single tool call turn.

        Returns a TokenMonitorEvent if a threshold was crossed, else None.
        """
        event = None
        with self._lock:
            self._session_tokens += tokens
            self._turn_tokens += tokens
            self._turn_count += 1

            usage_pct = self._usage_percent()

            # Check exceeded first (highest priority)
            if usage_pct >= 100.0 and not self._events_fired["exceeded"]:
                self._events_fired["exceeded"] = True
                event = TokenMonitorEvent(
                    event_type="budget_exceeded",
                    usage_percent=round(usage_pct, 2),
                    timestamp=time.time(),
                    message=f"Token budget exceeded: {self._session_tokens}/{self.token_budget}",
                )
                if self.on_exceeded:
                    self.on_exceeded(event)
            # Then check critical (fraction * 100 = percent threshold)
            elif usage_pct >= self.critical_threshold * 100 and not self._events_fired["critical"]:
                self._events_fired["critical"] = True
                event = TokenMonitorEvent(
                    event_type="threshold_critical",
                    usage_percent=round(usage_pct, 2),
                    timestamp=time.time(),
                    message=f"Token usage at {usage_pct:.1f}% (critical threshold: {self.critical_threshold * 100:.0f}%)",
                )
                if self.on_critical:
                    self.on_critical(event)
            # Then check warning
            elif usage_pct >= self.warning_threshold * 100 and not self._events_fired["warning"]:
                self._events_fired["warning"] = True
                event = TokenMonitorEvent(
                    event_type="threshold_warning",
                    usage_percent=round(usage_pct, 2),
                    timestamp=time.time(),
                    message=f"Token usage at {usage_pct:.1f}% (warning threshold: {self.warning_threshold * 100:.0f}%)",
                )
                if self.on_warning:
                    self.on_warning(event)

        return event

    def record_context(self, text: str) -> int:
        """Record tokens from a text block and return the count.

        Convenience method that estimates tokens and records them.
        """
        tokens = self.estimate_tokens(text)
        self.record_turn(tokens)
        return tokens

    def start_turn(self) -> None:
        """Signal the start of a new tool call turn."""
        with self._lock:
            self._turn_tokens = 0

    def end_turn(self) -> int:
        """Signal end of a turn, reset turn tokens, return count."""
        with self._lock:
            count = self._turn_tokens
            self._turn_tokens = 0
            return count

    def reset(self) -> None:
        """Reset all counters (e.g., for a new session)."""
        with self._lock:
            self._session_tokens = 0
            self._turn_tokens = 0
            self._turn_count = 0
            self._events_fired = {"warning": False, "critical": False, "exceeded": False}

    @property
    def is_threshold_exceeded(self) -> bool:
        """Whether the warning threshold has been exceeded."""
        snap = self.get_snapshot()
        return snap.threshold_exceeded

    @property
    def usage_percent(self) -> float:
        """Current usage as a percentage of budget."""
        return self.get_snapshot().usage_percent

    @property
    def tokens_remaining(self) -> int:
        """Tokens remaining in the budget."""
        return self.get_snapshot().remaining_tokens

    def __repr__(self) -> str:
        snap = self.get_snapshot()
        return (
            f"TokenMonitor(budget={self.token_budget}, "
            f"used={snap.total_tokens}, "
            f"usage={snap.usage_percent:.1f}%, "
            f"turns={snap.turn_count})"
        )
