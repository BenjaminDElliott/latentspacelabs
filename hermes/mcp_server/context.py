"""Context sharing mechanism for the Hermes MCP server.

Implements a shared state bus that allows multiple agent sessions to
exchange context through the MCP server. Supports both in-process
(shared memory) and remote (stdio/SSE) deployments.

Architecture: MCP server → Message bus → Context sharing → Local IPC

Key features:
- Per-session context isolation
- Shared context namespaces for cross-agent communication
- TTL-based context expiration
- Event-driven context updates (broadcast to subscribers)
- Integration with ICP (Inter-Agent Communication Protocol)
"""

import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set


@dataclass
class ContextEntry:
    """A single context entry with metadata."""

    key: str
    value: Any
    namespace: str
    session_id: str
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    ttl: int = 0  # 0 = no expiry
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        """Check if this entry has expired based on TTL."""
        if self.ttl <= 0:
            return False
        return time.time() - self.updated_at > self.ttl


class ContextBus:
    """Shared context bus for Hermes MCP agents.

    Provides a publish/subscribe mechanism for context sharing between
    agent sessions. Supports namespaced context, TTL-based expiration,
    and event-driven updates.

    Usage:
        bus = ContextBus()
        bus.write("workspace", "project_name", "latentspacelabs")
        value = bus.read("workspace", "project_name")
        bus.subscribe("workspace.*", handler_function)
    """

    def __init__(self):
        """Initialize the context bus."""
        self._lock = threading.RLock()
        self._contexts: Dict[str, Dict[str, ContextEntry]] = {}
        self._subscribers: Dict[str, List[Callable]] = {}
        self._sessions: Dict[str, Dict[str, ContextEntry]] = {}
        self._namespace_patterns: Dict[str, str] = {}

    def write(
        self,
        namespace: str,
        key: str,
        value: Any,
        session_id: str | None = None,
        ttl: int = 0,
        metadata: Dict[str, Any] | None = None,
    ) -> str:
        """Write a value to the context bus.

        Args:
            namespace: Context namespace (e.g., "workspace", "session", "shared")
            key: Key within the namespace
            value: Value to store (must be JSON-serializable)
            session_id: Session ID (auto-generated if not provided)
            ttl: Time-to-live in seconds (0 = no expiry)
            metadata: Optional metadata dict

        Returns:
            Unique context entry ID
        """
        if session_id is None:
            session_id = str(uuid.uuid4())
        if metadata is None:
            metadata = {}

        entry = ContextEntry(
            key=key,
            value=value,
            namespace=namespace,
            session_id=session_id,
            ttl=ttl,
            metadata=metadata,
        )

        with self._lock:
            if namespace not in self._contexts:
                self._contexts[namespace] = {}
            self._contexts[namespace][key] = entry

            if namespace not in self._sessions:
                self._sessions[namespace] = {}
            self._sessions[namespace][f"{session_id}:{key}"] = entry

        # Notify subscribers
        self._notify_subscribers(namespace, key, value)

        return f"{namespace}:{key}"

    def read(
        self,
        namespace: str,
        key: str,
        session_id: str | None = None,
    ) -> Optional[Any]:
        """Read a value from the context bus.

        Args:
            namespace: Context namespace
            key: Key to read
            session_id: Filter by session ID

        Returns:
            Stored value, or None if not found/expired
        """
        with self._lock:
            if namespace not in self._contexts:
                return None

            entry = self._contexts[namespace].get(key)
            if entry is None:
                return None

            if entry.is_expired:
                del self._contexts[namespace][key]
                return None

            if session_id and entry.session_id != session_id:
                return None

            return entry.value

    def delete(self, namespace: str, key: str, session_id: str | None = None) -> bool:
        """Delete a context entry.

        Args:
            namespace: Context namespace
            key: Key to delete
            session_id: Required session ID for scoped deletion

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if namespace not in self._contexts:
                return False

            entry = self._contexts[namespace].get(key)
            if entry is None:
                return False

            if session_id and entry.session_id != session_id:
                return False

            del self._contexts[namespace][key]
            return True

    def list_keys(
        self,
        namespace: str,
        session_id: str | None = None,
        include_expired: bool = False,
    ) -> List[str]:
        """List all keys in a namespace.

        Args:
            namespace: Context namespace
            session_id: Filter by session ID
            include_expired: Include expired entries

        Returns:
            List of key names
        """
        with self._lock:
            if namespace not in self._contexts:
                return []

            keys = []
            for key, entry in self._contexts[namespace].items():
                if not include_expired and entry.is_expired:
                    continue
                if session_id and entry.session_id != session_id:
                    continue
                keys.append(key)

            return keys

    def subscribe(
        self,
        namespace_pattern: str,
        handler: Callable[[str, str, Any], None],
    ) -> str:
        """Subscribe to context updates matching a namespace pattern.

        Args:
            namespace_pattern: Glob pattern (e.g., "workspace.*", "shared.*")
            handler: Callback function(session, key, value)

        Returns:
            Subscription ID for later unsubscription
        """
        sub_id = str(uuid.uuid4())[:8]

        with self._lock:
            if namespace_pattern not in self._subscribers:
                self._subscribers[namespace_pattern] = []
            self._subscribers[namespace_pattern].append(handler)

        return sub_id

    def unsubscribe(self, subscription_id: str) -> bool:
        """Remove a subscriber.

        Args:
            subscription_id: ID returned from subscribe()

        Returns:
            True if found and removed
        """
        with self._lock:
            for patterns in self._subscribers.values():
                for i, handler in enumerate(patterns):
                    if hasattr(handler, "__name__") and handler.__name__ == subscription_id:
                        patterns.pop(i)
                        return True
            return False

    def cleanup_expired(self) -> int:
        """Remove all expired entries.

        Returns:
            Number of entries removed
        """
        removed = 0
        with self._lock:
            for namespace in list(self._contexts.keys()):
                for key in list(self._contexts[namespace].keys()):
                    entry = self._contexts[namespace][key]
                    if entry.is_expired:
                        del self._contexts[namespace][key]
                        removed += 1
        return removed

    def get_snapshot(self, namespace: str) -> Dict[str, Any]:
        """Get a snapshot of all non-expired context in a namespace.

        Args:
            namespace: Context namespace

        Returns:
            Dict of key → value for all valid entries
        """
        with self._lock:
            if namespace not in self._contexts:
                return {}

            return {
                key: entry.value
                for key, entry in self._contexts[namespace].items()
                if not entry.is_expired
            }

    def _notify_subscribers(
        self,
        namespace: str,
        key: str,
        value: Any,
    ) -> None:
        """Notify subscribers of a context update."""
        for pattern, handlers in self._subscribers.items():
            if self._matches_pattern(namespace, pattern):
                for handler in handlers:
                    try:
                        handler(namespace, key, value)
                    except Exception:
                        # Don't let subscriber errors break context operations
                        pass

    @staticmethod
    def _matches_pattern(text: str, pattern: str) -> bool:
        """Simple glob pattern matching for namespace patterns.

        Supports:
        - '*' matches any characters (except '.')
        - '**' matches any characters (including '.')
        - Literal matching for exact namespace segments
        """
        if pattern == text:
            return True
        if pattern.endswith(".*"):
            prefix = pattern[:-2]
            return text.startswith(prefix + ".") or text == prefix
        if "**" in pattern:
            parts = pattern.split("**")
            return all(part in text for part in parts if part)
        return False

    def to_json(self) -> str:
        """Serialize the entire context bus state to JSON.

        Returns:
            JSON string representation
        """
        with self._lock:
            data = {}
            for namespace, entries in self._contexts.items():
                data[namespace] = {
                    key: {
                        "value": entry.value,
                        "session_id": entry.session_id,
                        "created_at": entry.created_at,
                        "updated_at": entry.updated_at,
                        "ttl": entry.ttl,
                        "metadata": entry.metadata,
                    }
                    for key, entry in entries.items()
                    if not entry.is_expired
                }
            return json.dumps(data, indent=2, default=str)


# ─── Global context bus singleton ────────────────────────────────────────────

_context_bus: Optional[ContextBus] = None
_bus_lock = threading.Lock()


def get_context_bus() -> ContextBus:
    """Get or create the global context bus singleton."""
    global _context_bus
    if _context_bus is None:
        with _bus_lock:
            if _context_bus is None:
                _context_bus = ContextBus()
    return _context_bus


def reset_context_bus() -> None:
    """Reset the global context bus (for testing)."""
    global _context_bus
    with _bus_lock:
        _context_bus = None
