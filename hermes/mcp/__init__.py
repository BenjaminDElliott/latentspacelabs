"""
MCP Server Management Module

Provides MCP server lifecycle management (start, stop, restart, health-check),
health checking with configurable timeout and retry, and graceful degradation
when servers are unavailable.

Adapted from ECC's MCP integration patterns (affaan-m/ECC).
"""

from .server_manager import (
    McpServerManager,
    McpServerStatus,
    McpServerConfig,
)
from .health_check import McpHealthChecker
from .graceful_degradation import McpDegradedFallback

__all__ = [
    "McpServerManager",
    "McpServerStatus",
    "McpServerConfig",
    "McpHealthChecker",
    "McpDegradedFallback",
]
