"""
MCP Server Graceful Degradation

Provides fallback mechanisms when MCP servers are unavailable:
- Cached response fallback
- Alternative server routing
- Circuit breaker pattern
- Degraded mode flagging

Inspired by ECC's mcp-health-check hook fail-open behavior and
reconnect command pattern.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class CircuitState:
    """Circuit breaker states."""

    CLOSED = "closed"       # Normal operation
    OPEN = "open"           # Server is down, fail fast
    HALF_OPEN = "half_open" # Testing if server recovered


@dataclass
class CachedResponse:
    """A cached response from an MCP server."""

    tool_name: str
    response: Any
    cached_at: float
    ttl_seconds: int
    server_name: str

    @property
    def is_expired(self) -> bool:
        return time.time() > self.cached_at + self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        return time.time() - self.cached_at


@dataclass
class DegradationResult:
    """Result of a tool call with potential degradation."""

    success: bool
    source: str  # "live", "cache", "fallback", "circuit_broken", "error"
    tool_name: str
    server_name: str
    response: Any = None
    error: Optional[str] = None
    cached: bool = False
    latency_ms: float = 0.0
    degradation_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict for logging/reporting."""
        return {
            "success": self.success,
            "source": self.source,
            "tool_name": self.tool_name,
            "server_name": self.server_name,
            "cached": self.cached,
            "latency_ms": self.latency_ms,
            "degradation_reason": self.degradation_reason,
            "error": self.error,
        }


class McpDegradedFallback:
    """Manages graceful degradation for MCP server failures.

    Features:
    - Response caching with configurable TTL
    - Circuit breaker pattern (closed → open → half_open → closed)
    - Fallback tool handlers
    - Degradation logging
    - Automatic cache warming on recovery

    Usage:
        fallback = McpDegradedFallback(cache_dir="~/.hermes/mcp-cache")

        # Wrap a tool call
        result = fallback.call_tool(
            "github",
            "search_repos",
            args={"q": "hermes"},
            tool_fn=lambda args: call_github_api(args),
        )

        if result.source == "cache":
            print(f"Returned cached result ({result.age_seconds}s old)")
        elif not result.success:
            print(f"Tool call failed: {result.error}")
    """

    DEFAULT_CACHE_TTL: int = 300  # 5 minutes
    DEFAULT_CACHE_DIR: str = "~/.hermes/mcp-cache"
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD: int = 5
    DEFAULT_CIRCUIT_RECOVERY_TIMEOUT: int = 60  # seconds
    DEFAULT_CIRCUIT_HALF_OPEN_MAX: int = 3

    def __init__(
        self,
        cache_ttl: int = DEFAULT_CACHE_TTL,
        cache_dir: Optional[str] = None,
        circuit_failure_threshold: int = DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
        circuit_recovery_timeout: int = DEFAULT_CIRCUIT_RECOVERY_TIMEOUT,
        fail_open: bool = False,
    ):
        """
        Args:
            cache_ttl: Seconds to keep cached responses.
            cache_dir: Directory for persistent cache.
            circuit_failure_threshold: Failures before circuit opens.
            circuit_recovery_timeout: Seconds before trying half_open.
            fail_open: If True, return success even when degraded.
        """
        self.cache_ttl = cache_ttl
        self.cache_dir = Path(cache_dir or self.DEFAULT_CACHE_DIR)
        self.fail_open = fail_open
        self.circuit_failure_threshold = circuit_failure_threshold
        self.circuit_recovery_timeout = circuit_recovery_timeout

        # In-memory state
        self._cache: Dict[str, CachedResponse] = {}
        self._circuit_breakers: Dict[str, Dict[str, Any]] = {}
        self._fallback_handlers: Dict[str, Dict[str, Callable]] = {}

        self._load_cache()

    def call_tool(
        self,
        server_name: str,
        tool_name: str,
        args: Any = None,
        tool_fn: Optional[Callable] = None,
        cache_key: Optional[str] = None,
    ) -> DegradationResult:
        """Call an MCP tool with graceful degradation.

        The call follows this priority:
        1. Check circuit breaker — if open, return cached or error
        2. Try live tool call
        3. On failure, try cached response
        4. On cache miss, apply fallback handler if available

        Args:
            server_name: MCP server name.
            tool_name: Tool name to call.
            args: Arguments for the tool.
            tool_fn: Callable that performs the actual tool call.
            cache_key: Override the cache key.

        Returns:
            DegradationResult with success status and source.
        """
        start = time.monotonic()
        key = cache_key or f"{server_name}:{tool_name}"

        # Step 1: Check circuit breaker
        circuit = self._get_circuit(server_name)
        if circuit["state"] == CircuitState.OPEN:
            if self._circuit_recovery_expired(server_name):
                self._transition_to_half_open(server_name)
            else:
                elapsed = (time.monotonic() - start) * 1000
                return DegradationResult(
                    success=False,
                    source="circuit_broken",
                    tool_name=tool_name,
                    server_name=server_name,
                    degradation_reason=f"circuit breaker open (failures={circuit['failures']})",
                    latency_ms=elapsed,
                )

        # Step 2: Try live call
        exc_info = None
        if tool_fn:
            try:
                result = tool_fn(args)
                elapsed = (time.monotonic() - start) * 1000

                # Success — record and cache
                self._record_success(server_name)
                self._cache_response(key, CachedResponse(
                    tool_name=tool_name,
                    response=result,
                    cached_at=time.time(),
                    ttl_seconds=self.cache_ttl,
                    server_name=server_name,
                ))

                return DegradationResult(
                    success=True,
                    source="live",
                    tool_name=tool_name,
                    server_name=server_name,
                    response=result,
                    latency_ms=elapsed,
                )

            except Exception as exc:
                exc_info = exc
                elapsed = (time.monotonic() - start) * 1000
                logger.warning(
                    "MCP tool call failed for %s/%s: %s",
                    server_name, tool_name, exc,
                )
                self._record_failure(server_name)

                # Step 3: Try cached response
                cached = self._get_cached(key, tool_name, server_name)
                if cached:
                    return DegradationResult(
                        success=True,
                        source="cache",
                        tool_name=tool_name,
                        server_name=server_name,
                        response=cached.response,
                        latency_ms=elapsed,
                        cached=True,
                        degradation_reason="server failed, using cached response",
                    )

                # Step 4: Try fallback handler
                fallback_result = self._try_fallback(server_name, tool_name, args)
                if fallback_result is not None:
                    elapsed = (time.monotonic() - start) * 1000
                    return DegradationResult(
                        success=True,
                        source="fallback",
                        tool_name=tool_name,
                        server_name=server_name,
                        response=fallback_result,
                        latency_ms=elapsed,
                        degradation_reason="server failed, using fallback handler",
                    )

        # All fallbacks exhausted
        elapsed = (time.monotonic() - start) * 1000
        error_msg = str(exc_info) if exc_info else ("no tool_fn provided" if not tool_fn else "all fallbacks exhausted")
        if self.fail_open:
            return DegradationResult(
                success=True,
                source="error",
                tool_name=tool_name,
                server_name=server_name,
                response=None,
                error=error_msg,
                latency_ms=elapsed,
                degradation_reason="fail-open mode",
            )
        else:
            return DegradationResult(
                success=False,
                source="error",
                tool_name=tool_name,
                server_name=server_name,
                response=None,
                error=error_msg,
                latency_ms=elapsed,
                degradation_reason="all fallbacks exhausted",
            )

    def register_fallback(
        self,
        server_name: str,
        tool_name: str,
        handler: Callable,
    ) -> None:
        """Register a fallback handler for a specific server/tool.

        The handler receives the same args the tool would receive.
        """
        if server_name not in self._fallback_handlers:
            self._fallback_handlers[server_name] = {}
        self._fallback_handlers[server_name][tool_name] = handler

    def set_cache_ttl(self, seconds: int) -> None:
        """Update the cache TTL."""
        self.cache_ttl = seconds

    def clear_cache(self) -> None:
        """Clear all cached responses."""
        self._cache.clear()
        self._save_cache()

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        now = time.time()
        active = sum(1 for r in self._cache.values() if not r.is_expired)
        expired = sum(1 for r in self._cache.values() if r.is_expired)

        return {
            "total_entries": len(self._cache),
            "active_entries": active,
            "expired_entries": expired,
            "ttl_seconds": self.cache_ttl,
            "fail_open": self.fail_open,
        }

    # ------------------------------------------------------------------ #
    # Cache methods
    # ------------------------------------------------------------------ #

    def _cache_response(self, key: str, response: CachedResponse) -> None:
        """Store a response in the cache."""
        self._cache[key] = response
        # Save periodically
        if len(self._cache) % 10 == 0:
            self._save_cache()

    def _get_cached(
        self,
        key: str,
        tool_name: str,
        server_name: str,
    ) -> Optional[CachedResponse]:
        """Get a cached response, if still valid."""
        cached = self._cache.get(key)
        if cached is None or cached.is_expired:
            return None
        return cached

    def _load_cache(self) -> None:
        """Load persistent cache from disk."""
        path = self.cache_dir / "responses.json"
        if not path.exists():
            return

        try:
            raw = path.read_text(encoding="utf-8")
            entries = json.loads(raw)
            for key, data in entries.items():
                self._cache[key] = CachedResponse(
                    tool_name=data["tool_name"],
                    response=data["response"],
                    cached_at=data["cached_at"],
                    ttl_seconds=data["ttl_seconds"],
                    server_name=data["server_name"],
                )
            logger.info("Loaded %d cached responses", len(self._cache))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load cache: %s", exc)

    def _save_cache(self) -> None:
        """Save cache to disk."""
        try:
            path = self.cache_dir
            path.mkdir(parents=True, exist_ok=True)
            data = {}
            for key, resp in self._cache.items():
                if not resp.is_expired:
                    data[key] = {
                        "tool_name": resp.tool_name,
                        "response": resp.response,
                        "cached_at": resp.cached_at,
                        "ttl_seconds": resp.ttl_seconds,
                        "server_name": resp.server_name,
                    }
            path.joinpath("responses.json").write_text(
                json.dumps(data, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            logger.warning("Failed to save cache: %s", exc)

    # ------------------------------------------------------------------ #
    # Circuit breaker methods
    # ------------------------------------------------------------------ #

    def _get_circuit(self, server_name: str) -> Dict[str, Any]:
        """Get or create circuit breaker state for a server."""
        if server_name not in self._circuit_breakers:
            self._circuit_breakers[server_name] = {
                "state": CircuitState.CLOSED,
                "failures": 0,
                "last_failure": None,
                "half_open_successes": 0,
            }
        return self._circuit_breakers[server_name]

    def _record_failure(self, server_name: str) -> None:
        """Record a failure for circuit breaker tracking."""
        circuit = self._get_circuit(server_name)
        circuit["failures"] += 1
        circuit["last_failure"] = time.time()

        if (
            circuit["state"] == CircuitState.CLOSED
            and circuit["failures"] >= self.circuit_failure_threshold
        ):
            circuit["state"] = CircuitState.OPEN
            logger.warning(
                "Circuit breaker OPEN for server '%s' (%d failures)",
                server_name, circuit["failures"],
            )

    def _record_success(self, server_name: str) -> None:
        """Record a success for circuit breaker tracking."""
        circuit = self._get_circuit(server_name)

        if circuit["state"] == CircuitState.HALF_OPEN:
            circuit["half_open_successes"] += 1
            if circuit["half_open_successes"] >= self.circuit_failure_threshold:
                circuit["state"] = CircuitState.CLOSED
                circuit["failures"] = 0
                circuit["half_open_successes"] = 0
                logger.info(
                    "Circuit breaker CLOSED for server '%s' — recovered",
                    server_name,
                )
        elif circuit["state"] == CircuitState.CLOSED:
            circuit["failures"] = 0

    def _circuit_recovery_expired(self, server_name: str) -> bool:
        """Check if enough time has passed to try recovery."""
        circuit = self._get_circuit(server_name)
        if circuit["last_failure"] is None:
            return False
        elapsed = time.time() - circuit["last_failure"]
        return elapsed >= self.circuit_recovery_timeout

    def _transition_to_half_open(self, server_name: str) -> None:
        """Transition circuit breaker to half-open state."""
        circuit = self._get_circuit(server_name)
        circuit["state"] = CircuitState.HALF_OPEN
        circuit["half_open_successes"] = 0
        logger.info(
            "Circuit breaker HALF_OPEN for server '%s' — testing recovery",
            server_name,
        )

    # ------------------------------------------------------------------ #
    # Fallback handler methods
    # ------------------------------------------------------------------ #

    def _try_fallback(
        self,
        server_name: str,
        tool_name: str,
        args: Any,
    ) -> Optional[Any]:
        """Try a registered fallback handler."""
        handlers = self._fallback_handlers.get(server_name, {})
        handler = handlers.get(tool_name)
        if handler is None:
            return None

        try:
            result = handler(args)
            logger.info(
                "Fallback handler invoked for %s/%s", server_name, tool_name
            )
            return result
        except Exception as exc:
            logger.warning(
                "Fallback handler failed for %s/%s: %s",
                server_name, tool_name, exc,
            )
            return None
