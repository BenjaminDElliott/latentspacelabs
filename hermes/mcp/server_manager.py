"""
MCP Server Manager — lifecycle management for MCP servers.

Manages MCP server processes: start, stop, restart, and health-check.
Reads server configuration from a .mcp.json-style file.

Inspired by ECC's mcp-health-check hook and mcp-config.js patterns.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class McpServerStatus(Enum):
    """Possible status values for an MCP server."""

    UNKNOWN = "unknown"
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    STOPPED = "stopped"
    STARTING = "starting"
    STOPPING = "stopping"
    RESTARTING = "restarting"
    MISSING_CONFIG = "missing_config"


@dataclass
class McpServerConfig:
    """Configuration for a single MCP server.

    Mirrors the .mcp.json format used by Claude Code and other harnesses.
    """

    name: str
    command: Optional[str] = None
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    url: Optional[str] = None
    server_type: Optional[str] = None  # "http", "stdio", or auto-detect
    description: str = ""
    health_endpoint: Optional[str] = None
    env_file: Optional[str] = None  # Optional .env file path

    @classmethod
    def from_dict(cls, name: str, data: Dict[str, Any]) -> "McpServerConfig":
        """Create a McpServerConfig from a dict (e.g. parsed from .mcp.json)."""
        return cls(
            name=name,
            command=data.get("command"),
            args=data.get("args", []),
            env=data.get("env", {}),
            url=data.get("url"),
            server_type=data.get("type") or data.get("server_type"),
            description=data.get("description", ""),
            health_endpoint=data.get("health_endpoint"),
            env_file=data.get("env_file"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a dict suitable for .mcp.json output."""
        result: Dict[str, Any] = {"description": self.description}
        if self.command:
            result["command"] = self.command
        if self.args:
            result["args"] = self.args
        if self.env:
            result["env"] = self.env
        if self.url:
            result["url"] = self.url
        if self.server_type:
            result["type"] = self.server_type
        if self.health_endpoint:
            result["health_endpoint"] = self.health_endpoint
        if self.env_file:
            result["env_file"] = self.env_file
        return result


@dataclass
class ServerProcess:
    """A running MCP server process."""

    pid: int
    process: subprocess.Popen
    server_name: str
    started_at: float = field(default_factory=time.monotonic)


class McpServerManager:
    """Manages the lifecycle of MCP servers.

    Supports:
    - Reading server configurations from a .mcp.json file
    - Starting, stopping, and restarting server processes
    - Health checking with configurable timeout and retries
    - Graceful degradation when servers are unavailable
    - Environment variable substitution (e.g. ${AUTH_TOKEN})
    - State persistence for server health cache

    Inspired by ECC's mcp-health-check hook:
      - Health state persistence to a JSON cache file
      - Exponential backoff on repeated failures
      - Environment-variable-based reconnect commands
      - Fail-open mode for graceful degradation
    """

    DEFAULT_HEALTH_CHECK_TIMEOUT: float = 30.0
    DEFAULT_RETRY_ATTEMPTS: int = 3
    DEFAULT_RETRY_DELAY: float = 2.0
    DEFAULT_TTL_SECONDS: int = 120  # Health check TTL (2 min, matches ECC default)
    DEFAULT_BACKOFF_BASE: float = 30.0  # seconds
    DEFAULT_BACKOFF_MAX: float = 600.0  # seconds (10 min)

    def __init__(
        self,
        config_path: Optional[str] = None,
        health_cache_path: Optional[str] = None,
        health_check_timeout: float = DEFAULT_HEALTH_CHECK_TIMEOUT,
        retry_attempts: int = DEFAULT_RETRY_ATTEMPTS,
        retry_delay: float = DEFAULT_RETRY_DELAY,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        backoff_max: float = DEFAULT_BACKOFF_MAX,
        fail_open: bool = False,
    ):
        """
        Args:
            config_path: Path to .mcp.json configuration file.
            health_cache_path: Path to persistent health state JSON.
            health_check_timeout: Seconds to wait for each health probe.
            retry_attempts: Number of retry attempts for health checks.
            retry_delay: Base delay between retries (exponential backoff).
            ttl_seconds: How long a healthy result is cached.
            backoff_base: Base backoff in seconds after first failure.
            backoff_max: Maximum backoff in seconds.
            fail_open: If True, allow tool execution even when server is down.
        """
        self.config_path = config_path or str(Path.home() / ".mcp.json")
        self.health_cache_path = health_cache_path or str(
            Path.home() / ".hermes" / "mcp-health-cache.json"
        )
        self.health_check_timeout = health_check_timeout
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay
        self.ttl_seconds = ttl_seconds
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self.fail_open = fail_open

        # In-memory server state
        self._servers: Dict[str, McpServerConfig] = {}
        self._processes: Dict[str, ServerProcess] = {}
        self._health_cache: Dict[str, Any] = {}

        self._load_config()
        self._load_health_cache()

    def _load_config(self) -> None:
        """Load MCP server configurations from the config file."""
        path = Path(self.config_path)
        if not path.exists():
            logger.warning("MCP config file not found: %s", self.config_path)
            return

        try:
            raw = path.read_text(encoding="utf-8")
            config = json.loads(raw)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to load MCP config: %s", exc)
            return

        mcp_servers = config.get("mcpServers", {})
        for name, server_data in mcp_servers.items():
            if isinstance(server_data, dict):
                self._servers[name] = McpServerConfig.from_dict(name, server_data)
                logger.info("Loaded MCP server config: %s", name)

    def _load_health_cache(self) -> None:
        """Load persistent health state."""
        path = Path(self.health_cache_path)
        if not path.exists():
            self._health_cache = {"version": 1, "servers": {}}
            return

        try:
            raw = path.read_text(encoding="utf-8")
            state = json.loads(raw)
            if isinstance(state, dict) and "servers" in state:
                self._health_cache = state
            else:
                self._health_cache = {"version": 1, "servers": {}}
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to load health cache: %s", exc)
            self._health_cache = {"version": 1, "servers": {}}

    def _save_health_cache(self) -> None:
        """Persist health state to disk."""
        try:
            path = Path(self.health_cache_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(self._health_cache, indent=2), encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to save health cache: %s", exc)

    @staticmethod
    def _substitute_env_vars(value: str) -> str:
        """Substitute ${VAR} references with environment values."""
        import re

        def replacer(match: re.Match) -> str:
            var_name = match.group(1)
            return os.environ.get(var_name, match.group(0))

        return re.sub(r"\$\{([^}]+)\}", replacer, value)

    def _substitute_config(self, config: McpServerConfig) -> McpServerConfig:
        """Substitute environment variable references in config."""
        substituted = McpServerConfig(
            name=config.name,
            command=config.command,
            args=[self._substitute_env_vars(a) for a in config.args],
            env={
                k: self._substitute_env_vars(v) for k, v in config.env.items()
            },
            url=self._substitute_env_vars(config.url) if config.url else None,
            server_type=config.server_type,
            description=config.description,
            health_endpoint=config.health_endpoint,
            env_file=config.env_file,
        )
        return substituted

    def list_servers(self) -> Dict[str, McpServerConfig]:
        """Return all configured MCP servers."""
        return dict(self._servers)

    def get_server(self, name: str) -> Optional[McpServerConfig]:
        """Get config for a specific MCP server by name."""
        return self._servers.get(name)

    # ------------------------------------------------------------------ #
    # Lifecycle methods
    # ------------------------------------------------------------------ #

    def start_server(self, name: str) -> dict:
        """Start an MCP server process.

        Args:
            name: Server name (key from .mcp.json).

        Returns:
            Status dict with 'ok', 'pid', 'error' fields.
        """
        config = self._servers.get(name)
        if not config:
            return {"ok": False, "error": f"Unknown server: {name}"}

        substituted = self._substitute_config(config)

        if substituted.command is None:
            return {"ok": False, "error": f"Server {name} has no command defined"}

        # Kill existing process if running
        self.stop_server(name)

        env = os.environ.copy()
        env.update(substituted.env)

        try:
            process = subprocess.Popen(
                [substituted.command] + substituted.args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            self._processes[name] = ServerProcess(
                pid=process.pid,
                process=process,
                server_name=name,
            )
            logger.info(
                "Started MCP server '%s' (PID %d)", name, process.pid
            )
            return {"ok": True, "pid": process.pid}
        except OSError as exc:
            logger.error("Failed to start server '%s': %s", name, exc)
            return {"ok": False, "error": str(exc)}

    def stop_server(self, name: str) -> dict:
        """Stop a running MCP server process.

        Args:
            name: Server name.

        Returns:
            Status dict with 'ok', 'was_running' fields.
        """
        proc = self._processes.get(name)
        if not proc:
            return {"ok": True, "was_running": False}

        try:
            proc.process.terminate()
            try:
                proc.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.process.kill()
                proc.process.wait(timeout=3)

            del self._processes[name]
            logger.info("Stopped MCP server '%s' (PID %d)", name, proc.pid)
            return {"ok": True, "was_running": True}
        except OSError as exc:
            logger.error("Error stopping server '%s': %s", name, exc)
            del self._processes[name]
            return {"ok": False, "was_running": True, "error": str(exc)}

    def restart_server(self, name: str) -> dict:
        """Restart an MCP server (stop then start).

        Args:
            name: Server name.

        Returns:
            Status dict with 'ok', 'pid', 'error' fields.
        """
        stop_result = self.stop_server(name)
        if not stop_result.get("ok"):
            return {"ok": False, "error": f"Stop failed: {stop_result.get('error')}"}

        start_result = self.start_server(name)
        start_result["stopped_first"] = True
        return start_result

    def is_running(self, name: str) -> bool:
        """Check if an MCP server process is currently running."""
        proc = self._processes.get(name)
        if not proc:
            return False
        return proc.process.poll() is None

    # ------------------------------------------------------------------ #
    # Health check methods
    # ------------------------------------------------------------------ #

    def check_health(
        self,
        name: str,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> dict:
        """Health check a specific MCP server.

        Performs an HTTP probe for http-type servers and a process
        liveness check for stdio servers.

        Args:
            name: Server name.
            timeout: Override default timeout in seconds.
            max_retries: Override default retry attempts.

        Returns:
            Status dict with keys: ok, status, reason, attempts, backoff.
        """
        timeout = timeout or self.health_check_timeout
        max_retries = max_retries or self.retry_attempts

        config = self._servers.get(name)
        if not config:
            return {
                "ok": False,
                "status": McpServerStatus.UNKNOWN.value,
                "reason": f"Unknown server: {name}",
                "attempts": 0,
                "backoff": None,
            }

        backoff = self._compute_backoff(name)

        for attempt in range(1, max_retries + 1):
            result = self._probe_server(name, config, timeout)
            if result["ok"]:
                self._mark_healthy(name)
                logger.info(
                    "MCP server '%s' is healthy (attempt %d/%d)",
                    name, attempt, max_retries,
                )
                return {
                    "ok": True,
                    "status": McpServerStatus.HEALTHY.value,
                    "reason": result.get("reason", "healthy"),
                    "attempts": attempt,
                    "backoff": backoff,
                }

            if attempt < max_retries:
                delay = min(
                    self.retry_delay * (2 ** (attempt - 1)),
                    self.backoff_max,
                )
                logger.info(
                    "MCP server '%s' probe attempt %d/%d failed, retrying in %.1fs: %s",
                    name, attempt, max_retries, delay, result.get("reason"),
                )
                time.sleep(delay)

        self._mark_unhealthy(name, max_retries, result.get("reason", "probe failed"))
        return {
            "ok": False,
            "status": McpServerStatus.UNHEALTHY.value,
            "reason": result.get("reason", "probe failed"),
            "attempts": max_retries,
            "backoff": backoff,
        }

    def check_all_health(
        self,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> Dict[str, dict]:
        """Health check all configured MCP servers.

        Returns:
            Dict mapping server name -> health check result dict.
        """
        results = {}
        for name in self._servers:
            results[name] = self.check_health(name, timeout, max_retries)
        return results

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _probe_server(
        self,
        name: str,
        config: McpServerConfig,
        timeout: float,
    ) -> dict:
        """Probe a single server for health.

        For HTTP servers: do an HTTP GET to the URL or health_endpoint.
        For stdio servers: check if the process is alive.
        """
        server_type = config.server_type or (
            "http" if config.url else "stdio"
        )

        try:
            if server_type == "http":
                return self._probe_http(name, config, timeout)
            elif server_type == "stdio":
                return self._probe_stdio(name, config)
            else:
                return {
                    "ok": False,
                    "reason": f"unsupported server type: {server_type}",
                }
        except Exception as exc:
            return {"ok": False, "reason": str(exc)}

    def _probe_http(self, name: str, config: McpServerConfig, timeout: float) -> dict:
        """HTTP server health probe."""
        import httpx

        target = config.health_endpoint or config.url
        if not target:
            return {
                "ok": False,
                "reason": "HTTP server has no URL or health_endpoint",
            }

        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.get(target)
                # ECC considers 2xx–3xx as healthy, plus common error codes
                # that still mean the endpoint is reachable
                if response.status_code < 500:
                    return {
                        "ok": True,
                        "reason": f"HTTP {response.status_code}",
                    }
                else:
                    return {
                        "ok": False,
                        "reason": f"HTTP {response.status_code}",
                    }
        except httpx.TimeoutException:
            return {"ok": False, "reason": "HTTP probe timed out"}
        except httpx.ConnectError as exc:
            return {"ok": False, "reason": f"Connection error: {exc}"}
        except Exception as exc:
            return {"ok": False, "reason": f"Probe error: {exc}"}

    def _probe_stdio(self, name: str, config: McpServerConfig) -> dict:
        """Stdio server health probe via process liveness."""
        proc = self._processes.get(name)
        if proc and proc.process.poll() is None:
            elapsed = time.monotonic() - proc.started_at
            return {
                "ok": True,
                "reason": f"process alive (PID {proc.pid}, {elapsed:.1f}s uptime)",
            }
        return {"ok": False, "reason": "process not running"}

    def _compute_backoff(self, name: str) -> Optional[float]:
        """Compute current backoff from failure count in health cache."""
        server_state = self._health_cache.get("servers", {}).get(name, {})
        failure_count = server_state.get("failure_count", 0)
        if failure_count == 0:
            return None
        backoff = self.backoff_base * (2 ** (failure_count - 1))
        return min(backoff, self.backoff_max)

    def _mark_healthy(self, name: str) -> None:
        """Mark a server as healthy and update the health cache."""
        now = time.time()
        self._health_cache.setdefault("servers", {})[name] = {
            "status": McpServerStatus.HEALTHY.value,
            "checked_at": now,
            "expires_at": now + self.ttl_seconds,
            "failure_count": 0,
            "last_error": None,
            "next_retry_at": now,
        }
        self._save_health_cache()

    def _mark_unhealthy(
        self, name: str, attempts: int, reason: str
    ) -> None:
        """Mark a server as unhealthy and persist state."""
        now = time.time()
        previous = self._health_cache.get("servers", {}).get(name, {})
        failure_count = previous.get("failure_count", 0) + 1
        backoff = min(
            self.backoff_base * (2 ** max(0, failure_count - 1)),
            self.backoff_max,
        )

        self._health_cache.setdefault("servers", {})[name] = {
            "status": McpServerStatus.UNHEALTHY.value,
            "checked_at": now,
            "expires_at": now + backoff,
            "failure_count": failure_count,
            "last_error": reason,
            "failure_attempts": attempts,
            "next_retry_at": now + backoff,
        }
        self._save_health_cache()

    def get_health_status(self, name: str) -> dict:
        """Get the current health status of a server from the cache."""
        server_state = self._health_cache.get("servers", {}).get(name, {})
        if not server_state:
            return {
                "status": McpServerStatus.UNKNOWN.value,
                "cached": False,
            }
        return {
            "status": server_state.get("status", McpServerStatus.UNKNOWN.value),
            "cached": True,
            "checked_at": server_state.get("checked_at"),
            "expires_at": server_state.get("expires_at"),
            "failure_count": server_state.get("failure_count", 0),
            "last_error": server_state.get("last_error"),
            "next_retry_at": server_state.get("next_retry_at"),
            "backoff": self._compute_backoff(name),
        }

    def clear_health_cache(self, name: Optional[str] = None) -> None:
        """Clear health cache entries. If name is None, clears all."""
        if name:
            self._health_cache.get("servers", {}).pop(name, None)
        else:
            self._health_cache = {"version": 1, "servers": {}}
        self._save_health_cache()

    def get_status_summary(self) -> Dict[str, dict]:
        """Get a summary of all server statuses."""
        summary = {}
        for name in self._servers:
            status = self.get_health_status(name)
            running = self.is_running(name)
            summary[name] = {
                "configured": True,
                "running": running,
                **status,
            }
        return summary

    def stop_all(self) -> Dict[str, dict]:
        """Stop all running MCP servers."""
        results = {}
        for name in list(self._servers.keys()):
            results[name] = self.stop_server(name)
        return results

    def start_all(self) -> Dict[str, dict]:
        """Start all configured MCP servers."""
        results = {}
        for name in self._servers:
            results[name] = self.start_server(name)
        return results

    def reload_config(self) -> None:
        """Re-read the MCP configuration file."""
        self._servers.clear()
        self._load_config()
        logger.info("Reloaded MCP config with %d servers", len(self._servers))
