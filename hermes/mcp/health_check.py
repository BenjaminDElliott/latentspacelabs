"""
MCP Server Health Checker

Implements health check with configurable timeout and retry with
exponential backoff. Inspired by ECC's mcp-health-check hook.

Key features:
- Configurable timeout per probe (default 30s)
- Retry with exponential backoff (default 3 attempts)
- Health state caching with TTL
- Fail-open mode for graceful degradation
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx

from .server_manager import McpServerConfig, McpServerStatus

logger = logging.getLogger(__name__)


class HealthCheckResult(Enum):
    """Result of a health check."""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    TIMEOUT = "timeout"
    CONNECTION_ERROR = "connection_error"
    SERVER_ERROR = "server_error"
    NO_CONFIG = "no_config"
    SKIPPED = "skipped"


@dataclass
class HealthProbeResult:
    """Result of a single health probe attempt."""

    ok: bool
    status: HealthCheckResult
    reason: str
    attempt_number: int
    latency_ms: float
    http_status_code: Optional[int] = None
    process_pid: Optional[int] = None


class McpHealthChecker:
    """Health checker for MCP servers.

    Performs health probes on MCP servers with:
    - Configurable timeout per probe
    - Retry with exponential backoff
    - HTTP or process-based probing
    - State caching to avoid redundant probes

    Usage:
        checker = McpHealthChecker(timeout=30.0, retries=3)
        result = checker.check("github")
        if result.status == HealthCheckResult.HEALTHY:
            # Server is ready
        else:
            # Handle degradation
    """

    # HTTP status codes considered healthy (endpoint reachable)
    HEALTHY_HTTP_CODES = frozenset([200, 201, 202, 204, 301, 302, 303, 304, 307, 308])
    RECONNECT_HTTP_CODES = frozenset([401, 403, 429, 503])
    FAILURE_PATTERNS = [
        (401, r"\b401\b|unauthori[sz]ed|auth(?:entication)?\s+(?:failed|expired|invalid)", "auth"),
        (403, r"\b403\b|forbidden|permission denied", "permission"),
        (429, r"\b429\b|rate limit|too many requests", "rate_limited"),
        (503, r"\b503\b|service unavailable|overloaded|temporarily unavailable", "service_unavailable"),
    ]

    def __init__(
        self,
        timeout: float = 30.0,
        retries: int = 3,
        retry_delay: float = 2.0,
        backoff_base: float = 30.0,
        backoff_max: float = 600.0,
        ttl_seconds: int = 120,
        fail_open: bool = False,
    ):
        """
        Args:
            timeout: Seconds to wait for each health probe.
            retries: Number of retry attempts before declaring unhealthy.
            retry_delay: Base delay between retries (exponential backoff).
            backoff_base: Base backoff seconds after first failure.
            backoff_max: Maximum backoff seconds.
            ttl_seconds: How long a healthy cache entry lasts.
            fail_open: Allow execution even when server is down.
        """
        self.timeout = timeout
        self.retries = retries
        self.retry_delay = retry_delay
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self.ttl_seconds = ttl_seconds
        self.fail_open = fail_open

        self._cache: Dict[str, Any] = {}

    def check(
        self,
        name: str,
        config: McpServerConfig,
        process_pid: Optional[int] = None,
    ) -> HealthProbeResult:
        """Run a health check for a specific MCP server.

        Args:
            name: Server name (for caching).
            config: Server configuration.
            process_pid: PID of the running process (for stdio servers).

        Returns:
            HealthProbeResult with status, reason, and attempt count.
        """
        # Check cache first
        cached = self._get_cached_result(name)
        if cached:
            return HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason=f"cached (healthy, {cached['ttl_left']:.0f}s remaining)",
                attempt_number=0,
                latency_ms=0.0,
            )

        result = self._do_check(name, config, process_pid)

        if result.ok:
            self._cache_healthy(name, result)
        else:
            self._cache_unhealthy(name, result)

        return result

    def check_all(
        self,
        servers: Dict[str, McpServerConfig],
        running_processes: Dict[str, Any],
    ) -> Dict[str, HealthProbeResult]:
        """Health check all configured MCP servers.

        Args:
            servers: Dict of server name -> config.
            running_processes: Dict of server name -> process info.

        Returns:
            Dict mapping server name -> HealthProbeResult.
        """
        results = {}
        for name, config in servers.items():
            pid = (
                running_processes[name].pid
                if name in running_processes
                else None
            )
            results[name] = self.check(name, config, pid)
        return results

    def get_cached_status(self, name: str) -> Optional[dict]:
        """Get the cached health status for a server.

        Returns None if no cache entry exists or it has expired.
        """
        entry = self._cache.get(name)
        if not entry:
            return None
        if time.time() > entry.get("expires_at", 0):
            del self._cache[name]
            return None
        return entry

    # ------------------------------------------------------------------ #
    # Internal methods
    # ------------------------------------------------------------------ #

    def _get_cached_result(self, name: str) -> Optional[dict]:
        """Check if there's a valid cached result for this server."""
        entry = self._cache.get(name)
        if not entry:
            return None
        if time.time() > entry.get("expires_at", 0):
            del self._cache[name]
            return None
        return {
            "ttl_left": entry["expires_at"] - time.time(),
            **entry,
        }

    def _cache_healthy(self, name: str, result: HealthProbeResult) -> None:
        """Cache a healthy result."""
        self._cache[name] = {
            "status": "healthy",
            "checked_at": time.time(),
            "expires_at": time.time() + self.ttl_seconds,
            "reason": result.reason,
            "latency_ms": result.latency_ms,
        }

    def _cache_unhealthy(self, name: str, result: HealthProbeResult) -> None:
        """Cache an unhealthy result with backoff."""
        cache_entry = self._cache.get(name, {})
        failure_count = cache_entry.get("failure_count", 0) + 1
        backoff = min(
            self.backoff_base * (2 ** max(0, failure_count - 1)),
            self.backoff_max,
        )
        self._cache[name] = {
            "status": "unhealthy",
            "checked_at": time.time(),
            "expires_at": time.time() + backoff,
            "failure_count": failure_count,
            "reason": result.reason,
            "retry_after": time.time() + backoff,
        }

    def _do_check(
        self,
        name: str,
        config: McpServerConfig,
        process_pid: Optional[int],
    ) -> HealthProbeResult:
        """Perform the actual health check with retries."""
        server_type = config.server_type or (
            "http" if config.url else "stdio"
        )

        for attempt in range(1, self.retries + 1):
            start = time.monotonic()
            try:
                if server_type == "http":
                    result = self._probe_http(config)
                else:
                    result = self._probe_stdio(process_pid, config)

                latency = (time.monotonic() - start) * 1000
                result.latency_ms = latency

                if result.ok:
                    return result

            except httpx.TimeoutException:
                latency = (time.monotonic() - start) * 1000
                return HealthProbeResult(
                    ok=False,
                    status=HealthCheckResult.TIMEOUT,
                    reason=f"probe timed out after {self.timeout}s",
                    attempt_number=attempt,
                    latency_ms=latency,
                )
            except httpx.ConnectError as exc:
                latency = (time.monotonic() - start) * 1000
                return HealthProbeResult(
                    ok=False,
                    status=HealthCheckResult.CONNECTION_ERROR,
                    reason=f"connection error: {exc}",
                    attempt_number=attempt,
                    latency_ms=latency,
                )

            if attempt < self.retries:
                delay = min(
                    self.retry_delay * (2 ** (attempt - 1)),
                    self.backoff_max,
                )
                logger.debug(
                    "Server '%s' probe %d/%d failed, retrying in %.1fs: %s",
                    name, attempt, self.retries, delay, result.reason,
                )
                time.sleep(delay)

        # All retries exhausted
        return HealthProbeResult(
            ok=False,
            status=HealthCheckResult.UNHEALTHY,
            reason=result.reason,
            attempt_number=self.retries,
            latency_ms=0.0,
        )

    def _probe_http(self, config: McpServerConfig) -> HealthProbeResult:
        """Probe an HTTP-type MCP server."""
        target = config.health_endpoint or config.url
        if not target:
            return HealthProbeResult(
                ok=False,
                status=HealthCheckResult.SERVER_ERROR,
                reason="no URL or health_endpoint configured",
                attempt_number=0,
                latency_ms=0.0,
            )

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.get(target)
                code = response.status_code

                if code in self.HEALTHY_HTTP_CODES:
                    return HealthProbeResult(
                        ok=True,
                        status=HealthCheckResult.HEALTHY,
                        reason=f"HTTP {code}",
                        attempt_number=0,
                        latency_ms=0.0,
                        http_status_code=code,
                    )
                elif code in self.RECONNECT_HTTP_CODES:
                    return HealthProbeResult(
                        ok=False,
                        status=HealthCheckResult.SERVER_ERROR,
                        reason=f"HTTP {code} — may need reconnect",
                        attempt_number=0,
                        latency_ms=0.0,
                        http_status_code=code,
                    )
                else:
                    return HealthProbeResult(
                        ok=False,
                        status=HealthCheckResult.SERVER_ERROR,
                        reason=f"HTTP {code}",
                        attempt_number=0,
                        latency_ms=0.0,
                        http_status_code=code,
                    )
        except httpx.TimeoutException:
            raise
        except httpx.ConnectError as exc:
            raise
        except Exception as exc:
            return HealthProbeResult(
                ok=False,
                status=HealthCheckResult.SERVER_ERROR,
                reason=str(exc),
                attempt_number=0,
                latency_ms=0.0,
            )

    def _probe_stdio(
        self,
        process_pid: Optional[int],
        config: McpServerConfig,
    ) -> HealthProbeResult:
        """Probe a stdio-type MCP server via process liveness."""
        import subprocess

        if process_pid is None:
            return HealthProbeResult(
                ok=False,
                status=HealthCheckResult.UNHEALTHY,
                reason="no process PID available",
                attempt_number=0,
                latency_ms=0.0,
                process_pid=None,
            )

        try:
            # Check if process is running
            subprocess.check_call(
                ["kill", "-0", str(process_pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason=f"process alive (PID {process_pid})",
                attempt_number=0,
                latency_ms=0.0,
                process_pid=process_pid,
            )
        except subprocess.CalledProcessError:
            return HealthProbeResult(
                ok=False,
                status=HealthCheckResult.UNHEALTHY,
                reason=f"process exited (PID {process_pid})",
                attempt_number=0,
                latency_ms=0.0,
                process_pid=process_pid,
            )
        except Exception as exc:
            return HealthProbeResult(
                ok=False,
                status=HealthCheckResult.UNHEALTHY,
                reason=f"process check failed: {exc}",
                attempt_number=0,
                latency_ms=0.0,
                process_pid=process_pid,
            )

    def clear_cache(self) -> None:
        """Clear all cached health results."""
        self._cache.clear()
