"""
Unit tests for MCP Server Manager.

Tests:
- Config loading from .mcp.json files
- Environment variable substitution
- Server lifecycle (start, stop, restart, is_running)
- Health checking with retries and backoff
- Health cache persistence and TTL
- Status summary
- Config reload
"""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure the parent directory is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.server_manager import (
    McpServerConfig,
    McpServerManager,
    McpServerStatus,
    ServerProcess,
)


class TestMcpServerConfig(unittest.TestCase):
    """Tests for McpServerConfig dataclass."""

    def test_from_dict_minimal(self):
        """Config with only name should have defaults for optional fields."""
        config = McpServerConfig.from_dict("test-server", {})
        self.assertEqual(config.name, "test-server")
        self.assertIsNone(config.command)
        self.assertEqual(config.args, [])
        self.assertEqual(config.env, {})
        self.assertIsNone(config.url)
        self.assertIsNone(config.server_type)
        self.assertEqual(config.description, "")

    def test_from_dict_full(self):
        """Config with all fields should map correctly."""
        data = {
            "command": "npx",
            "args": ["-y", "@some/server"],
            "env": {"API_KEY": "secret123"},
            "url": "https://example.com/mcp",
            "type": "http",
            "description": "Test server",
            "health_endpoint": "https://example.com/health",
            "env_file": "/path/to/.env",
        }
        config = McpServerConfig.from_dict("my-server", data)
        self.assertEqual(config.name, "my-server")
        self.assertEqual(config.command, "npx")
        self.assertEqual(config.args, ["-y", "@some/server"])
        self.assertEqual(config.env, {"API_KEY": "secret123"})
        self.assertEqual(config.url, "https://example.com/mcp")
        self.assertEqual(config.server_type, "http")
        self.assertEqual(config.description, "Test server")
        self.assertEqual(config.health_endpoint, "https://example.com/health")
        self.assertEqual(config.env_file, "/path/to/.env")

    def test_from_dict_type_field(self):
        """The 'type' key should map to server_type."""
        config = McpServerConfig.from_dict("test", {"type": "http"})
        self.assertEqual(config.server_type, "http")

    def test_to_dict(self):
        """to_dict should serialize config fields."""
        config = McpServerConfig(
            name="test",
            command="echo",
            args=["hello"],
            env={"KEY": "val"},
            url="https://example.com",
            server_type="http",
            description="Test",
        )
        result = config.to_dict()
        self.assertEqual(result["description"], "Test")
        self.assertEqual(result["command"], "echo")
        self.assertEqual(result["args"], ["hello"])
        self.assertEqual(result["env"], {"KEY": "val"})
        self.assertEqual(result["url"], "https://example.com")
        self.assertEqual(result["type"], "http")

    def test_to_dict_minimal(self):
        """Minimal config should only have description."""
        config = McpServerConfig(name="minimal")
        result = config.to_dict()
        self.assertEqual(result, {"description": ""})


class TestMcpServerManagerConfigLoading(unittest.TestCase):
    """Tests for config loading from .mcp.json files."""

    def _create_mcp_json(self, servers: dict) -> str:
        """Helper to create a temporary .mcp.json file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump({"mcpServers": servers}, f)
            return f.name

    def test_load_config_single_server(self):
        """Loading a config with one server should work."""
        servers = {
            "test-server": {
                "command": "echo",
                "args": ["hello"],
                "description": "Test",
            }
        }
        config_path = self._create_mcp_json(servers)
        try:
            manager = McpServerManager(config_path=config_path)
            configs = manager.list_servers()
            self.assertIn("test-server", configs)
            self.assertEqual(configs["test-server"].command, "echo")
            self.assertEqual(configs["test-server"].description, "Test")
        finally:
            os.unlink(config_path)

    def test_load_config_multiple_servers(self):
        """Loading a config with multiple servers should load all."""
        servers = {
            "server-a": {"command": "echo", "args": ["a"]},
            "server-b": {"command": "echo", "args": ["b"]},
            "server-c": {"command": "echo", "args": ["c"]},
        }
        config_path = self._create_mcp_json(servers)
        try:
            manager = McpServerManager(config_path=config_path)
            configs = manager.list_servers()
            self.assertEqual(len(configs), 3)
            for name in ["server-a", "server-b", "server-c"]:
                self.assertIn(name, configs)
        finally:
            os.unlink(config_path)

    def test_load_config_missing_file(self):
        """Loading a non-existent config should not raise."""
        manager = McpServerManager(config_path="/tmp/nonexistent-mcp.json")
        self.assertEqual(len(manager.list_servers()), 0)

    def test_load_config_invalid_json(self):
        """Loading invalid JSON should log error but not crash."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            f.write("not valid json {{{")
            config_path = f.name
        try:
            manager = McpServerManager(config_path=config_path)
            self.assertEqual(len(manager.list_servers()), 0)
        finally:
            os.unlink(config_path)

    def test_get_server(self):
        """get_server should return a specific server config."""
        servers = {"my-server": {"command": "echo", "args": ["hi"]}}
        config_path = self._create_mcp_json(servers)
        try:
            manager = McpServerManager(config_path=config_path)
            config = manager.get_server("my-server")
            self.assertIsNotNone(config)
            self.assertEqual(config.command, "echo")
            self.assertIsNone(manager.get_server("nonexistent"))
        finally:
            os.unlink(config_path)

    def test_load_ecc_style_http_server(self):
        """Should handle HTTP-type servers (no command, has url)."""
        servers = {
            "vercel": {
                "type": "http",
                "url": "https://mcp.vercel.com",
                "description": "Vercel deployments",
            }
        }
        config_path = self._create_mcp_json(servers)
        try:
            manager = McpServerManager(config_path=config_path)
            config = manager.get_server("vercel")
            self.assertIsNotNone(config)
            self.assertEqual(config.server_type, "http")
            self.assertEqual(config.url, "https://mcp.vercel.com")
            self.assertIsNone(config.command)
        finally:
            os.unlink(config_path)

    def test_load_ecc_style_env_vars(self):
        """Should handle servers with environment variable placeholders."""
        servers = {
            "github": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {
                    "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
                },
                "description": "GitHub operations",
            }
        }
        config_path = self._create_mcp_json(servers)
        try:
            manager = McpServerManager(config_path=config_path)
            config = manager.get_server("github")
            self.assertEqual(config.env["GITHUB_PERSONAL_ACCESS_TOKEN"], "${GITHUB_TOKEN}")
        finally:
            os.unlink(config_path)


class TestMcpServerManagerEnvSubstitution(unittest.TestCase):
    """Tests for environment variable substitution."""

    def setUp(self):
        """Set up env vars for testing."""
        self._orig_environ = dict(os.environ)
        os.environ["TEST_AUTH_TOKEN"] = "secret-token-123"
        os.environ["TEST_DB_URL"] = "postgresql://localhost:5432/test"

    def tearDown(self):
        """Restore original environment."""
        os.environ.clear()
        os.environ.update(self._orig_environ)

    def test_substitute_simple_var(self):
        """${VAR} should be replaced with env value."""
        manager = McpServerManager()
        result = manager._substitute_env_vars("${TEST_AUTH_TOKEN}")
        self.assertEqual(result, "secret-token-123")

    def test_substitute_missing_var(self):
        """Missing var should keep the original placeholder."""
        mgr = McpServerManager()
        result = mgr._substitute_env_vars("${NONEXISTENT_VAR}")
        self.assertEqual(result, "${NONEXISTENT_VAR}")

    def test_substitute_no_vars(self):
        """String without placeholders should pass through."""
        mgr = McpServerManager()
        result = mgr._substitute_env_vars("no-variables-here")
        self.assertEqual(result, "no-variables-here")

    def test_substitute_multiple_vars(self):
        """Multiple ${VAR} should all be replaced."""
        mgr = McpServerManager()
        text = "key=${TEST_AUTH_TOKEN}&url=${TEST_DB_URL}"
        result = mgr._substitute_env_vars(text)
        self.assertEqual(
            result,
            "key=secret-token-123&url=postgresql://localhost:5432/test",
        )

    def test_substitute_config_args(self):
        """Config args should have vars substituted."""
        config = McpServerConfig(
            name="test",
            command="echo",
            args=["${TEST_AUTH_TOKEN}", "--url", "${TEST_DB_URL}"],
        )
        manager = McpServerManager()
        substituted = manager._substitute_config(config)
        self.assertEqual(
            substituted.args,
            ["secret-token-123", "--url", "postgresql://localhost:5432/test"],
        )

    def test_substitute_config_env(self):
        """Config env values should have vars substituted."""
        config = McpServerConfig(
            name="test",
            command="echo",
            env={"TOKEN": "${TEST_AUTH_TOKEN}"},
        )
        manager = McpServerManager()
        substituted = manager._substitute_config(config)
        self.assertEqual(substituted.env["TOKEN"], "secret-token-123")


class TestMcpServerManagerLifecycle(unittest.TestCase):
    """Tests for server lifecycle operations."""

    def test_start_unknown_server(self):
        """Starting an unknown server should return error."""
        manager = McpServerManager()
        result = manager.start_server("nonexistent")
        self.assertFalse(result["ok"])
        self.assertIn("Unknown server", result["error"])

    def test_start_server_no_command(self):
        """Starting a server without command should return error."""
        servers = {"http-only": {"type": "http", "url": "https://example.com"}}
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            result = manager.start_server("http-only")
            self.assertFalse(result["ok"])
            self.assertIn("no command", result["error"])
        finally:
            os.unlink(config_path)

    @patch("mcp.server_manager.subprocess.Popen")
    def test_start_server_success(self, mock_popen):
        """Starting a server with valid command should succeed."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc

        servers = {"test-server": {"command": "echo", "args": ["hello"]}}
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            result = manager.start_server("test-server")
            self.assertTrue(result["ok"])
            self.assertEqual(result["pid"], 12345)
        finally:
            os.unlink(config_path)

    def test_stop_server_not_running(self):
        """Stopping a non-running server should succeed with was_running=False."""
        manager = McpServerManager()
        result = manager.stop_server("test-server")
        self.assertTrue(result["ok"])
        self.assertFalse(result["was_running"])

    @patch("mcp.server_manager.subprocess.Popen")
    def test_stop_running_server(self, mock_popen):
        """Stopping a running server should terminate it."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc

        servers = {"test-server": {"command": "echo", "args": ["hello"]}}
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            manager.start_server("test-server")
            self.assertTrue(manager.is_running("test-server"))

            result = manager.stop_server("test-server")
            self.assertTrue(result["ok"])
            self.assertTrue(result["was_running"])
            self.assertFalse(manager.is_running("test-server"))
        finally:
            os.unlink(config_path)

    @patch("mcp.server_manager.subprocess.Popen")
    def test_restart_server(self, mock_popen):
        """Restart should stop then start."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc

        servers = {"test-server": {"command": "echo", "args": ["hello"]}}
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            manager.start_server("test-server")

            result = manager.restart_server("test-server")
            self.assertTrue(result["ok"])
            self.assertTrue(result.get("stopped_first"))
        finally:
            os.unlink(config_path)

    @patch("mcp.server_manager.subprocess.Popen")
    def test_is_running_false_for_stopped(self, mock_popen):
        """is_running should return False for non-running server."""
        manager = McpServerManager()
        self.assertFalse(manager.is_running("test-server"))

    def test_start_all(self):
        """start_all should start all configured servers."""
        servers = {
            "server-a": {"command": "echo", "args": ["a"]},
            "server-b": {"command": "echo", "args": ["b"]},
        }
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            with patch("mcp.server_manager.subprocess.Popen") as mock_popen:
                mock_proc = MagicMock()
                mock_proc.pid = 100
                mock_proc.poll.return_value = None
                mock_popen.return_value = mock_proc

                results = manager.start_all()
                self.assertIn("server-a", results)
                self.assertIn("server-b", results)
                self.assertEqual(len(results), 2)
        finally:
            os.unlink(config_path)

    def test_stop_all(self):
        """stop_all should stop all configured servers."""
        servers = {
            "server-a": {"command": "echo", "args": ["a"]},
            "server-b": {"command": "echo", "args": ["b"]},
        }
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            with patch("mcp.server_manager.subprocess.Popen") as mock_popen:
                mock_proc = MagicMock()
                mock_proc.pid = 100
                mock_proc.poll.return_value = None
                mock_popen.return_value = mock_proc
                manager.start_all()

            results = manager.stop_all()
            self.assertIn("server-a", results)
            self.assertIn("server-b", results)
        finally:
            os.unlink(config_path)

    def test_reload_config(self):
        """reload_config should clear and re-read servers."""
        servers1 = {"server-1": {"command": "echo"}}
        config_path = tempfile.mktemp(suffix=".json")
        json.dump({"mcpServers": servers1}, open(config_path, "w"))
        try:
            manager = McpServerManager(config_path=config_path)
            self.assertEqual(len(manager.list_servers()), 1)

            # Replace config file
            servers2 = {"server-2": {"command": "echo"}}
            json.dump({"mcpServers": servers2}, open(config_path, "w"))
            manager.reload_config()
            self.assertEqual(len(manager.list_servers()), 1)
            self.assertIn("server-2", manager.list_servers())
        finally:
            os.unlink(config_path)


class TestMcpServerManagerHealthCache(unittest.TestCase):
    """Tests for health cache persistence and TTL."""

    def setUp(self):
        self.cache_path = tempfile.mktemp(suffix="-health-cache.json")

    def tearDown(self):
        if os.path.exists(self.cache_path):
            os.unlink(self.cache_path)

    def test_health_cache_initial(self):
        """Initial health cache should have default structure."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        self.assertEqual(manager._health_cache, {"version": 1, "servers": {}})

    def test_mark_healthy(self):
        """mark_healthy should set status and persist."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["test"] = McpServerConfig(name="test", command="echo")
        manager._mark_healthy("test")

        status = manager.get_health_status("test")
        self.assertEqual(status["status"], "healthy")
        self.assertTrue(status["cached"])
        self.assertEqual(status["failure_count"], 0)

    def test_mark_unhealthy(self):
        """mark_unhealthy should set status with failure count."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["test"] = McpServerConfig(name="test", command="echo")
        manager._mark_unhealthy("test", attempts=3, reason="connection refused")

        status = manager.get_health_status("test")
        self.assertEqual(status["status"], "unhealthy")
        self.assertEqual(status["failure_count"], 1)
        self.assertEqual(status["last_error"], "connection refused")

    def test_mark_unhealthy_incremental(self):
        """Repeated failures should increment failure_count."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["test"] = McpServerConfig(name="test", command="echo")

        for i in range(3):
            manager._mark_unhealthy("test", attempts=1, reason=f"attempt {i}")

        status = manager.get_health_status("test")
        self.assertEqual(status["failure_count"], 3)

    def test_backoff_calculation(self):
        """Backoff should increase with failure count."""
        manager = McpServerManager(
            health_cache_path=self.cache_path,
            backoff_base=10.0,
            backoff_max=600.0,
        )
        manager._servers["test"] = McpServerConfig(name="test", command="echo")

        # 0 failures = no backoff
        manager._health_cache.setdefault("servers", {})["test"] = {
            "failure_count": 0,
        }
        self.assertIsNone(manager._compute_backoff("test"))

        # 1 failure = base backoff
        manager._health_cache["servers"]["test"]["failure_count"] = 1
        self.assertEqual(manager._compute_backoff("test"), 10.0)

        # 2 failures = base * 2
        manager._health_cache["servers"]["test"]["failure_count"] = 2
        self.assertEqual(manager._compute_backoff("test"), 20.0)

        # 3 failures = base * 4
        manager._health_cache["servers"]["test"]["failure_count"] = 3
        self.assertEqual(manager._compute_backoff("test"), 40.0)

    def test_backoff_capped_at_max(self):
        """Backoff should be capped at backoff_max."""
        manager = McpServerManager(
            health_cache_path=self.cache_path,
            backoff_base=10.0,
            backoff_max=30.0,
        )
        manager._servers["test"] = McpServerConfig(name="test", command="echo")
        manager._health_cache.setdefault("servers", {})["test"] = {
            "failure_count": 10,
        }
        backoff = manager._compute_backoff("test")
        self.assertEqual(backoff, 30.0)

    def test_clear_health_cache_single(self):
        """clear_health_cache with name should remove only that server."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["a"] = McpServerConfig(name="a")
        manager._servers["b"] = McpServerConfig(name="b")
        manager._health_cache.setdefault("servers", {})["a"] = {"status": "healthy"}
        manager._health_cache.setdefault("servers", {})["b"] = {"status": "healthy"}

        manager.clear_health_cache("a")
        self.assertNotIn("a", manager._health_cache.get("servers", {}))
        self.assertIn("b", manager._health_cache.get("servers", {}))

    def test_clear_health_cache_all(self):
        """clear_health_cache with no name should clear all."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._health_cache = {"version": 1, "servers": {"a": {}, "b": {}}}
        manager.clear_health_cache()
        self.assertEqual(manager._health_cache, {"version": 1, "servers": {}})

    def test_save_and_reload_health_cache(self):
        """Health cache should persist to disk and reload."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["test"] = McpServerConfig(name="test", command="echo")
        manager._mark_healthy("test")

        # Create a new manager instance and reload
        manager2 = McpServerManager(health_cache_path=self.cache_path)
        status = manager2.get_health_status("test")
        self.assertEqual(status["status"], "healthy")

    def test_get_status_summary(self):
        """get_status_summary should include all servers."""
        manager = McpServerManager(health_cache_path=self.cache_path)
        manager._servers["a"] = McpServerConfig(name="a", command="echo")
        manager._servers["b"] = McpServerConfig(name="b", command="echo")

        summary = manager.get_status_summary()
        self.assertIn("a", summary)
        self.assertIn("b", summary)
        self.assertTrue(summary["a"]["configured"])
        self.assertFalse(summary["a"]["running"])


class TestMcpServerStatusEnum(unittest.TestCase):
    """Tests for McpServerStatus enum values."""

    def test_all_statuses_defined(self):
        """All expected status values should be defined."""
        expected = {
            "unknown", "healthy", "unhealthy", "stopped",
            "starting", "stopping", "restarting", "missing_config",
        }
        actual = {s.value for s in McpServerStatus}
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
