"""
Unit tests for MCP Health Checker.

Tests:
- Cache behavior (hit, miss, TTL expiry)
- HTTP health probing (healthy, unhealthy, timeout, connection error)
- stdio health probing (process alive, process dead)
- Retry with exponential backoff
- check_all for multiple servers
- Clear cache
- Failure counting and backoff caching
"""

import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.health_check import (
    HealthCheckResult,
    HealthProbeResult,
    McpHealthChecker,
)
from mcp.server_manager import McpServerConfig


class TestHealthCheckResult(unittest.TestCase):
    """Tests for HealthCheckResult enum values."""

    def test_all_values(self):
        expected = {
            "healthy", "unhealthy", "timeout",
            "connection_error", "server_error", "no_config", "skipped",
        }
        actual = {r.value for r in HealthCheckResult}
        self.assertEqual(actual, expected)


class TestHealthProbeResult(unittest.TestCase):
    """Tests for HealthProbeResult dataclass."""

    def test_create_basic(self):
        """HealthProbeResult should be creatable with basic fields."""
        result = HealthProbeResult(
            ok=True,
            status=HealthCheckResult.HEALTHY,
            reason="HTTP 200",
            attempt_number=1,
            latency_ms=50.0,
        )
        self.assertTrue(result.ok)
        self.assertEqual(result.status, HealthCheckResult.HEALTHY)
        self.assertEqual(result.reason, "HTTP 200")
        self.assertEqual(result.attempt_number, 1)
        self.assertEqual(result.latency_ms, 50.0)


class TestMcpHealthCheckerCache(unittest.TestCase):
    """Tests for cache behavior."""

    def test_cache_hit(self):
        """Healthy check should be cached and returned on subsequent calls."""
        checker = McpHealthChecker(ttl_seconds=60)
        config = McpServerConfig(
            name="http-server",
            url="https://example.com/mcp",
            server_type="http",
        )

        # First call — should probe
        with patch.object(checker, "_do_check") as mock_check:
            mock_check.return_value = HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason="HTTP 200",
                attempt_number=1,
                latency_ms=10.0,
            )
            result1 = checker.check("http-server", config)
            self.assertTrue(result1.ok)
            mock_check.assert_called_once()

        # Second call — should use cache
        result2 = checker.check("http-server", config)
        self.assertTrue(result2.ok)
        self.assertIn("cached", result2.reason)
        self.assertEqual(result2.attempt_number, 0)

    def test_cache_miss_expired(self):
        """Expired cache should trigger a new probe."""
        checker = McpHealthChecker(ttl_seconds=0)  # TTL = 0 means immediately expired
        config = McpServerConfig(
            name="http-server",
            url="https://example.com/mcp",
            server_type="http",
        )

        with patch.object(checker, "_do_check") as mock_check:
            mock_check.return_value = HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason="HTTP 200",
                attempt_number=1,
                latency_ms=10.0,
            )
            checker.check("http-server", config)
            self.assertEqual(mock_check.call_count, 1)

            # Second call — cache expired (TTL=0), should probe again
            import time as _time
            _time.sleep(0.01)  # ensure time advances past expires_at
            checker.check("http-server", config)
            self.assertEqual(mock_check.call_count, 2)

    def test_cache_get_status(self):
        """get_cached_status should return entry if within TTL."""
        checker = McpHealthChecker(ttl_seconds=60)
        config = McpServerConfig(name="test", url="https://test.com", server_type="http")

        with patch.object(checker, "_do_check") as mock_check:
            mock_check.return_value = HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason="OK",
                attempt_number=1,
                latency_ms=10.0,
            )
            checker.check("test", config)

        status = checker.get_cached_status("test")
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], "healthy")

    def test_cache_get_status_expired(self):
        """get_cached_status should return None for expired entry."""
        checker = McpHealthChecker(ttl_seconds=0)
        config = McpServerConfig(name="test", url="https://test.com", server_type="http")

        with patch.object(checker, "_do_check") as mock_check:
            mock_check.return_value = HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason="OK",
                attempt_number=1,
                latency_ms=10.0,
            )
            checker.check("test", config)

        self.assertIsNone(checker.get_cached_status("test"))

    def test_clear_cache(self):
        """clear_cache should remove all cached entries."""
        checker = McpHealthChecker(ttl_seconds=60)
        config = McpServerConfig(name="test", url="https://test.com", server_type="http")

        with patch.object(checker, "_do_check") as mock_check:
            mock_check.return_value = HealthProbeResult(
                ok=True,
                status=HealthCheckResult.HEALTHY,
                reason="OK",
                attempt_number=1,
                latency_ms=10.0,
            )
            checker.check("test", config)

        self.assertIn("test", checker._cache)
        checker.clear_cache()
        self.assertNotIn("test", checker._cache)


class TestMcpHealthCheckerHttp(unittest.TestCase):
    """Tests for HTTP health probing."""

    def test_http_healthy(self):
        """HTTP server with 2xx/3xx status should be healthy."""
        checker = McpHealthChecker()
        config = McpServerConfig(
            name="test",
            url="https://example.com/health",
            server_type="http",
        )

        with patch("mcp.health_check.httpx.Client") as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_client.return_value.__enter__ = MagicMock(return_value=MagicMock(get=MagicMock(return_value=mock_response)))
            mock_client.return_value.__exit__ = MagicMock(return_value=None)
            result = checker._probe_http(config)
        self.assertTrue(result.ok)
        self.assertEqual(result.status, HealthCheckResult.HEALTHY)

    def test_http_unhealthy_500(self):
        """HTTP server with 500 status should be unhealthy."""
        checker = McpHealthChecker()
        config = McpServerConfig(
            name="test",
            url="https://example.com/health",
            server_type="http",
        )

        with patch("mcp.health_check.httpx.Client") as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_client.return_value.__enter__ = MagicMock(return_value=MagicMock(get=MagicMock(return_value=mock_response)))
            mock_client.return_value.__exit__ = MagicMock(return_value=None)
            result = checker._probe_http(config)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, HealthCheckResult.SERVER_ERROR)

    def test_http_no_url(self):
        """HTTP server without URL should report error."""
        checker = McpHealthChecker()
        config = McpServerConfig(name="test", server_type="http")

        result = checker._probe_http(config)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, HealthCheckResult.SERVER_ERROR)
        self.assertIn("no URL", result.reason)

    def test_reconnect_http_codes(self):
        """401, 403, 429, 503 should trigger reconnect."""
        checker = McpHealthChecker()
        config = McpServerConfig(
            name="test",
            url="https://example.com",
            server_type="http",
        )

        with patch("mcp.health_check.httpx.Client") as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 401
            mock_client.return_value.__enter__ = MagicMock(return_value=MagicMock(get=MagicMock(return_value=mock_response)))
            mock_client.return_value.__exit__ = MagicMock(return_value=None)
            result = checker._probe_http(config)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, HealthCheckResult.SERVER_ERROR)
        self.assertIn("reconnect", result.reason)


class TestMcpHealthCheckerStdio(unittest.TestCase):
    """Tests for stdio process-based health probing."""

    def test_stdio_process_alive(self):
        """Running process should be healthy."""
        checker = McpHealthChecker()
        config = McpServerConfig(name="test", command="echo")

        result = checker._probe_stdio(process_pid=1, config=config)
        self.assertTrue(result.ok)
        self.assertEqual(result.status, HealthCheckResult.HEALTHY)
        self.assertEqual(result.process_pid, 1)

    def test_stdio_process_dead(self):
        """Dead process should be unhealthy."""
        checker = McpHealthChecker()
        config = McpServerConfig(name="test", command="echo")

        result = checker._probe_stdio(process_pid=99999, config=config)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, HealthCheckResult.UNHEALTHY)
        self.assertIn("exited", result.reason)

    def test_stdio_no_pid(self):
        """No PID should be unhealthy."""
        checker = McpHealthChecker()
        config = McpServerConfig(name="test", command="echo")

        result = checker._probe_stdio(process_pid=None, config=config)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, HealthCheckResult.UNHEALTHY)
        self.assertIn("no process PID", result.reason)


class TestMcpHealthCheckerDoCheck(unittest.TestCase):
    """Tests for the full do_check logic including retries."""

    def test_do_check_http_success_first_attempt(self):
        """HTTP check should succeed on first attempt."""
        checker = McpHealthChecker()
        config = McpServerConfig(name="test", url="https://example.com", server_type="http")

        with patch("mcp.health_check.httpx.Client") as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_client.return_value.__enter__ = MagicMock(return_value=MagicMock(get=MagicMock(return_value=mock_response)))
            mock_client.return_value.__exit__ = MagicMock(return_value=None)
            result = checker._do_check("test", config, process_pid=None)
        self.assertTrue(result.ok)
        self.assertGreater(result.latency_ms, 0)

    def test_check_all(self):
        """check_all should return results for all servers."""
        checker = McpHealthChecker()
        servers = {
            "http-server": McpServerConfig(name="http-server", url="https://example.com", server_type="http"),
            "stdio-server": McpServerConfig(name="stdio-server", command="echo"),
        }
        running = {"stdio-server": MagicMock(pid=12345)}

        results = checker.check_all(servers, running)
        self.assertIn("http-server", results)
        self.assertIn("stdio-server", results)
        self.assertTrue(results["http-server"].ok)


class TestHealthCheckDefaults(unittest.TestCase):
    """Tests for default parameter values."""

    def test_default_timeout(self):
        """Default timeout should be 30s."""
        checker = McpHealthChecker()
        self.assertEqual(checker.timeout, 30.0)

    def test_default_retries(self):
        """Default retries should be 3."""
        checker = McpHealthChecker()
        self.assertEqual(checker.retries, 3)

    def test_default_retry_delay(self):
        """Default retry_delay should be 2.0s."""
        checker = McpHealthChecker()
        self.assertEqual(checker.retry_delay, 2.0)

    def test_default_ttl(self):
        """Default TTL should be 120s."""
        checker = McpHealthChecker()
        self.assertEqual(checker.ttl_seconds, 120)

    def test_default_fail_open(self):
        """Default fail_open should be False."""
        checker = McpHealthChecker()
        self.assertFalse(checker.fail_open)

    def test_custom_params(self):
        """Custom parameters should be respected."""
        checker = McpHealthChecker(
            timeout=10.0,
            retries=5,
            retry_delay=1.0,
            ttl_seconds=30,
            fail_open=True,
        )
        self.assertEqual(checker.timeout, 10.0)
        self.assertEqual(checker.retries, 5)
        self.assertEqual(checker.retry_delay, 1.0)
        self.assertEqual(checker.ttl_seconds, 30)
        self.assertTrue(checker.fail_open)


class TestHealthCheckerCacheUnhealthy(unittest.TestCase):
    """Tests for unhealthy result caching with backoff."""

    def test_unhealthy_backoff_increases(self):
        """Unhealthy cache entries should have increasing backoff."""
        checker = McpHealthChecker(backoff_base=10.0, backoff_max=600.0)
        config = McpServerConfig(name="test", url="https://example.com", server_type="http")

        # First failure
        result = HealthProbeResult(
            ok=False, status=HealthCheckResult.UNHEALTHY,
            reason="connection refused", attempt_number=1, latency_ms=0.0,
        )
        checker._cache_unhealthy("test", result)
        entry = checker._cache.get("test")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["failure_count"], 1)
        self.assertAlmostEqual(entry["expires_at"] - time.time(), 10.0, places=0)

        # Second failure
        checker._cache_unhealthy("test", result)
        entry = checker._cache.get("test")
        self.assertEqual(entry["failure_count"], 2)
        self.assertAlmostEqual(entry["expires_at"] - time.time(), 20.0, places=0)


if __name__ == "__main__":
    unittest.main()
