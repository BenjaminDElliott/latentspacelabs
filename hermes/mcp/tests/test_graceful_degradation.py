"""
Unit tests for MCP Graceful Degradation.

Tests:
- Circuit breaker state transitions (closed → open → half_open → closed)
- Cached response fallback
- Fallback handler execution
- Fail-open mode
- Cache TTL and expiry
- Cache stats
- DegradationResult serialization
"""

import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.graceful_degradation import (
    CachedResponse,
    CircuitState,
    DegradationResult,
    McpDegradedFallback,
)


class TestCircuitState(unittest.TestCase):
    """Tests for CircuitState values."""

    def test_all_states_defined(self):
        expected = {"closed", "open", "half_open"}
        actual = {s for s in dir(CircuitState) if not s.startswith("_")}
        # CircuitState is a class with attributes, check string values
        self.assertIn("CLOSED", dir(CircuitState))
        self.assertIn("OPEN", dir(CircuitState))
        self.assertIn("HALF_OPEN", dir(CircuitState))

    def test_state_values(self):
        self.assertEqual(CircuitState.CLOSED, "closed")
        self.assertEqual(CircuitState.OPEN, "open")
        self.assertEqual(CircuitState.HALF_OPEN, "half_open")


class TestDegradationResult(unittest.TestCase):
    """Tests for DegradationResult dataclass and serialization."""

    def test_create_result(self):
        result = DegradationResult(
            success=True,
            source="live",
            tool_name="search",
            server_name="github",
            response={"results": []},
            latency_ms=150.0,
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "live")
        self.assertEqual(result.tool_name, "search")
        self.assertEqual(result.server_name, "github")
        self.assertEqual(result.latency_ms, 150.0)

    def test_to_dict(self):
        result = DegradationResult(
            success=False,
            source="circuit_broken",
            tool_name="search",
            server_name="github",
            degradation_reason="circuit breaker open",
            error=None,
            latency_ms=5.0,
        )
        d = result.to_dict()
        self.assertEqual(d["success"], False)
        self.assertEqual(d["source"], "circuit_broken")
        self.assertEqual(d["tool_name"], "search")
        self.assertEqual(d["server_name"], "github")
        self.assertEqual(d["degradation_reason"], "circuit breaker open")
        self.assertEqual(d["error"], None)
        self.assertEqual(d["latency_ms"], 5.0)


class TestCachedResponse(unittest.TestCase):
    """Tests for CachedResponse TTL and expiry."""

    def test_fresh_cache_not_expired(self):
        """Recently cached response should not be expired."""
        resp = CachedResponse(
            tool_name="search",
            response={"data": "test"},
            cached_at=time.time(),
            ttl_seconds=300,
            server_name="test",
        )
        self.assertFalse(resp.is_expired)

    def test_expired_cache(self):
        """Response older than TTL should be expired."""
        resp = CachedResponse(
            tool_name="search",
            response={"data": "test"},
            cached_at=time.time() - 600,
            ttl_seconds=300,
            server_name="test",
        )
        self.assertTrue(resp.is_expired)

    def test_age_seconds(self):
        """age_seconds should return time since caching."""
        resp = CachedResponse(
            tool_name="search",
            response={"data": "test"},
            cached_at=time.time() - 100,
            ttl_seconds=300,
            server_name="test",
        )
        self.assertGreaterEqual(resp.age_seconds, 99.0)
        self.assertLess(resp.age_seconds, 105.0)


class TestMcpDegradedFallbackLiveCall(unittest.TestCase):
    """Tests for successful live tool calls."""

    def test_live_call_success(self):
        """Successful tool call should return live source."""
        fallback = McpDegradedFallback()
        result = fallback.call_tool(
            server_name="test-server",
            tool_name="search_repos",
            args={"q": "test"},
            tool_fn=lambda args: {"results": ["repo1", "repo2"]},
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "live")
        self.assertEqual(result.tool_name, "search_repos")
        self.assertEqual(result.server_name, "test-server")
        self.assertIsNotNone(result.response)

    def test_live_call_caches_response(self):
        """Successful call should cache the response."""
        fallback = McpDegradedFallback()
        fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"data": "live"},
        )

        stats = fallback.get_cache_stats()
        self.assertEqual(stats["active_entries"], 1)

    def test_live_call_no_fn(self):
        """Call without tool_fn should return error."""
        fallback = McpDegradedFallback()
        result = fallback.call_tool("test", "search")
        self.assertFalse(result.success)
        self.assertEqual(result.source, "error")
        self.assertIn("no tool_fn", result.error)


class TestMcpDegradedFallbackCache(unittest.TestCase):
    """Tests for cached response fallback."""

    def test_cached_fallback_on_failure(self):
        """On tool failure, should try cached response."""
        fallback = McpDegradedFallback()

        # First, cache a response
        fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={"q": "test"},
            tool_fn=lambda args: {"results": ["cached"]},
        )

        # Now call with a failing function — should use cache
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={"q": "test"},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("server down")),
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "cache")
        self.assertTrue(result.cached)
        self.assertIn("cached response", result.degradation_reason)

    def test_cached_response_expired(self):
        """Expired cache should not be used."""
        fallback = McpDegradedFallback(cache_ttl=1)

        # Cache a response
        fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["old"]},
        )

        # Wait for TTL to expire
        time.sleep(1.5)

        # Now call with failing function
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("server down")),
        )
        self.assertFalse(result.success)
        self.assertEqual(result.source, "error")


class TestMcpDegradedFallbackCircuitBreaker(unittest.TestCase):
    """Tests for circuit breaker state transitions."""

    def test_circuit_opens_after_threshold(self):
        """Circuit should open after failure threshold."""
        fallback = McpDegradedFallback(
            circuit_failure_threshold=3,
            circuit_recovery_timeout=10,
        )

        # Simulate 3 failures
        for i in range(3):
            fallback.call_tool(
                server_name="test",
                tool_name="search",
                args={},
                tool_fn=lambda args: (_ for _ in ()).throw(Exception(f"fail {i}")),
            )

        # Next call should be circuit broken
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["live"]},
        )
        self.assertFalse(result.success)
        self.assertEqual(result.source, "circuit_broken")
        self.assertIn("circuit breaker open", result.degradation_reason)

    def test_circuit_half_open_recovery(self):
        """Circuit should transition to half_open after recovery timeout."""
        fallback = McpDegradedFallback(
            circuit_failure_threshold=2,
            circuit_recovery_timeout=0.5,
        )

        # Open the circuit
        for i in range(2):
            fallback.call_tool(
                server_name="test",
                tool_name="search",
                args={},
                tool_fn=lambda args: (_ for _ in ()).throw(Exception(f"fail {i}")),
            )

        # Wait for recovery timeout
        time.sleep(0.6)

        # Half-open call succeeds
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["recovered"]},
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "live")

    def test_circuit_closed_after_half_open_successes(self):
        """Circuit should close after half_open succeeds threshold times."""
        fallback = McpDegradedFallback(
            circuit_failure_threshold=2,
            circuit_recovery_timeout=0.1,
        )

        # Open circuit
        for i in range(2):
            fallback.call_tool(
                server_name="test",
                tool_name="search",
                args={},
                tool_fn=lambda args: (_ for _ in ()).throw(Exception(f"fail {i}")),
            )

        # Wait for recovery
        time.sleep(0.2)

        # Half-open phase — need 2 successes to close
        for i in range(2):
            result = fallback.call_tool(
                server_name="test",
                tool_name="search",
                args={},
                tool_fn=lambda args: {"results": [f"success {i}"]},
            )
            self.assertTrue(result.success)

        # Circuit should now be closed — live calls work
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["live"]},
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "live")


class TestMcpDegradedFallbackHandlers(unittest.TestCase):
    """Tests for fallback handler execution."""

    def test_register_fallback(self):
        """Should be able to register and invoke fallback handlers."""
        fallback = McpDegradedFallback()
        fallback.register_fallback("github", "search_repos", lambda args: {"fallback": True})

        result = fallback.call_tool(
            server_name="github",
            tool_name="search_repos",
            args={"q": "test"},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("down")),
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "fallback")
        self.assertIn("fallback", result.response)

    def test_unregistered_fallback_returns_none(self):
        """Unregistered fallback should return None."""
        fallback = McpDegradedFallback()

        result = fallback.call_tool(
            server_name="github",
            tool_name="search_repos",
            args={"q": "test"},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("down")),
        )
        self.assertFalse(result.success)
        self.assertEqual(result.source, "error")

    def test_fallback_handler_exception(self):
        """Fallback handler exception should be handled gracefully."""
        fallback = McpDegradedFallback()
        fallback.register_fallback("test", "tool", lambda args: (_ for _ in ()).throw(Exception("fallback error")))

        result = fallback.call_tool(
            server_name="test",
            tool_name="tool",
            args={},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("down")),
        )
        self.assertFalse(result.success)
        self.assertEqual(result.source, "error")


class TestMcpDegradedFallbackFailOpen(unittest.TestCase):
    """Tests for fail-open mode."""

    def test_fail_open_returns_success(self):
        """Fail-open mode should return success even when degraded."""
        fallback = McpDegradedFallback(fail_open=True)
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("server down")),
        )
        self.assertTrue(result.success)
        self.assertEqual(result.source, "error")
        self.assertEqual(result.degradation_reason, "fail-open mode")

    def test_fail_close_returns_failure(self):
        """Fail-close mode should return failure when all fallbacks exhausted."""
        fallback = McpDegradedFallback(fail_open=False)
        result = fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: (_ for _ in ()).throw(Exception("server down")),
        )
        self.assertFalse(result.success)
        self.assertEqual(result.source, "error")
        self.assertEqual(result.degradation_reason, "all fallbacks exhausted")


class TestMcpDegradedFallbackCacheStats(unittest.TestCase):
    """Tests for cache statistics."""

    def test_cache_stats_empty(self):
        """Empty cache should show zero entries."""
        fallback = McpDegradedFallback()
        stats = fallback.get_cache_stats()
        self.assertEqual(stats["total_entries"], 0)
        self.assertEqual(stats["active_entries"], 0)
        self.assertEqual(stats["expired_entries"], 0)
        self.assertEqual(stats["ttl_seconds"], 300)  # default
        self.assertFalse(stats["fail_open"])

    def test_cache_stats_with_entries(self):
        """Cache with entries should report accurate counts."""
        fallback = McpDegradedFallback()

        # Add a live entry
        fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["ok"]},
        )

        # Add an expired entry
        fallback._cache["test:old"] = CachedResponse(
            tool_name="search",
            response={"results": ["old"]},
            cached_at=time.time() - 600,
            ttl_seconds=300,
            server_name="test",
        )

        stats = fallback.get_cache_stats()
        self.assertEqual(stats["total_entries"], 2)
        self.assertEqual(stats["active_entries"], 1)
        self.assertEqual(stats["expired_entries"], 1)

    def test_clear_cache_persists(self):
        """clear_cache should clear in-memory cache and persist."""
        fallback = McpDegradedFallback()
        fallback.call_tool(
            server_name="test",
            tool_name="search",
            args={},
            tool_fn=lambda args: {"results": ["ok"]},
        )
        self.assertEqual(len(fallback._cache), 1)
        fallback.clear_cache()
        self.assertEqual(len(fallback._cache), 0)


class TestMcpDegradedFallbackDefaults(unittest.TestCase):
    """Tests for default parameter values."""

    def test_defaults(self):
        fallback = McpDegradedFallback()
        self.assertEqual(fallback.cache_ttl, 300)
        self.assertEqual(fallback.circuit_failure_threshold, 5)
        self.assertEqual(fallback.circuit_recovery_timeout, 60)
        self.assertFalse(fallback.fail_open)

    def test_custom_defaults(self):
        fallback = McpDegradedFallback(
            cache_ttl=60,
            circuit_failure_threshold=10,
            circuit_recovery_timeout=120,
            fail_open=True,
        )
        self.assertEqual(fallback.cache_ttl, 60)
        self.assertEqual(fallback.circuit_failure_threshold, 10)
        self.assertEqual(fallback.circuit_recovery_timeout, 120)
        self.assertTrue(fallback.fail_open)


if __name__ == "__main__":
    unittest.main()
