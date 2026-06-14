"""
Backward-Scan Pruner: Compress consecutive similar tool outputs.

After tool calls, scans backwards and compresses consecutive similar outputs
(e.g., multiple browser snapshots of the same page, repeated file listings).
Uses structural hashing and similarity detection to identify compressible sequences.

Design decisions:
- Structural hash (not content hash) for similarity detection
- Group consecutive similar items, not scattered duplicates
- Preserves first and last items in a group for temporal context
- Configurable similarity threshold and group size limits
- Fast O(n) single-pass scan over recent history
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class PrunedGroup:
    """A group of similar items that were compressed."""
    representative: dict  # The key content of the group
    count: int            # Number of items compressed
    first_seen: int       # Index of first item
    last_seen: int        # Index of last item
    structure_hash: str   # Hash of structural pattern
    compressed: bool      # Whether this group was compressed


@dataclass
class PruneResult:
    """Result of a pruning operation."""
    pruned_items: List[dict]  # Items after pruning
    groups_compressed: int     # Number of groups that were compressed
    items_removed: int         # Number of items removed
    original_count: int        # Original item count


class BackwardPruner:
    """
    Compresses consecutive similar tool outputs in context history.

    Usage:
        pruner = BackwardPruner(similarity_threshold=0.85, max_group_size=3)
        result = pruner.prune(context_history)
        # result.pruned_items contains the optimized history
    """

    def __init__(
        self,
        similarity_threshold: float = 0.85,
        max_group_size: int = 3,
        min_group_size: int = 2,
        window_size: int = 50,
    ):
        self.similarity_threshold = similarity_threshold
        self.max_group_size = max_group_size
        self.min_group_size = min_group_size
        self.window_size = window_size

    def prune(self, items: List[dict]) -> PruneResult:
        """
        Prune a list of context items by compressing consecutive similar outputs.

        Scans backwards through the last `window_size` items, identifying and
        compressing groups of similar tool outputs.

        Args:
            items: List of context items (each a dict with at least 'role' and 'content').

        Returns:
            PruneResult with the pruned item list and statistics.
        """
        if len(items) <= self.max_group_size:
            return PruneResult(
                pruned_items=list(items),
                groups_compressed=0,
                items_removed=0,
                original_count=len(items),
            )

        # Work on the last window_size items
        window_start = max(0, len(items) - self.window_size)
        prefix = list(items[:window_start])
        window = list(items[window_start:])

        pruned_window = self._prune_window(window)
        remaining = prefix + pruned_window

        total_removed = len(items) - len(remaining)

        return PruneResult(
            pruned_items=remaining,
            groups_compressed=sum(1 for g in self._scan_groups(window) if g.count > 1),
            items_removed=total_removed,
            original_count=len(items),
        )

    def _prune_window(self, items: List[dict]) -> List[dict]:
        """Prune a window of items by compressing similar groups."""
        groups = self._scan_groups(items)
        result = []
        seen_indices = set()

        for group in groups:
            if group.count >= self.min_group_size and group.count <= self.max_group_size:
                # Compress this group: keep first and last, add summary
                first = items[group.first_seen]
                last = items[group.last_seen]
                result.append({
                    **first,
                    "content": self._merge_group_content(first, last, group.count),
                    "metadata": {
                        **first.get("metadata", {}),
                        "pruned_group": True,
                        "group_size": group.count,
                        "structure_hash": group.structure_hash,
                    },
                })
                for i in range(group.first_seen, group.last_seen + 1):
                    seen_indices.add(i)
            elif group.count > self.max_group_size:
                # Large group: keep representative, note compression
                rep = items[group.first_seen]
                result.append({
                    **rep,
                    "content": self._compress_large_group(rep, group.count),
                    "metadata": {
                        **rep.get("metadata", {}),
                        "pruned_group": True,
                        "group_size": group.count,
                        "structure_hash": group.structure_hash,
                    },
                })
                for i in range(group.first_seen, group.last_seen + 1):
                    seen_indices.add(i)

        # Add items not in any group
        for i, item in enumerate(items):
            if i not in seen_indices:
                result.append(dict(item))

        return result

    def _scan_groups(self, items: List[dict]) -> List[PrunedGroup]:
        """Scan items for groups of similar tool outputs."""
        groups = []
        i = 0

        while i < len(items):
            item = items[i]
            if self._is_tool_output(item):
                # Start potential group
                group_start = i
                structure_hash = self._structural_hash(item)

                j = i + 1
                while j < len(items) and j - group_start < self.max_group_size:
                    next_item = items[j]
                    if self._is_tool_output(next_item) and self._is_similar(
                        item, next_item, structure_hash
                    ):
                        j += 1
                    else:
                        break

                if j - group_start >= self.min_group_size:
                    groups.append(PrunedGroup(
                        representative=item,
                        count=j - group_start,
                        first_seen=group_start,
                        last_seen=j - 1,
                        structure_hash=structure_hash,
                        compressed=True,
                    ))
                    i = j
                else:
                    i += 1
            else:
                i += 1

        return groups

    def _is_tool_output(self, item: dict) -> bool:
        """Check if an item is a tool output (tool or assistant role with tool result)."""
        role = item.get("role", "")
        metadata = item.get("metadata", {})
        return role in ("tool",) or metadata.get("is_tool_output", False)

    def _structural_hash(self, item: dict) -> str:
        """Compute a structural hash of an item, ignoring content details."""
        # Extract structural features
        content = item.get("content", "")
        role = item.get("role", "")
        tool_name = item.get("metadata", {}).get("tool_name", "") or item.get("tool_name", "")

        # Structural features: role, tool name, first/last few words, length class
        lines = content.split("\n")
        structural = f"{role}|{tool_name}|{len(lines)}|{len(content)}|{content[:30].strip()}|{content[-30:].strip() if len(content) > 60 else ''}"

        return hashlib.md5(structural.encode()).hexdigest()[:12]

    def _is_similar(
        self,
        item1: dict,
        item2: dict,
        expected_hash: str,
    ) -> bool:
        """Check if two items are structurally similar."""
        # Same structure hash is strong signal
        hash2 = self._structural_hash(item2)
        if hash2 != expected_hash:
            return False

        # Same tool name
        tool1 = item1.get("metadata", {}).get("tool_name", "") or item1.get("tool_name", "")
        tool2 = item2.get("metadata", {}).get("tool_name", "") or item2.get("tool_name", "")
        if tool1 and tool2 and tool1 != tool2:
            return False

        # Same role
        role1 = item1.get("role", "")
        role2 = item2.get("role", "")
        if role1 and role2 and role1 != role2:
            return False

        return True

    def _merge_group_content(self, first: dict, last: dict, count: int) -> str:
        """Merge a small group of similar items into a summary."""
        content1 = first.get("content", "")
        content2 = last.get("content", "")

        lines1 = content1.split("\n")
        lines2 = content2.split("\n")

        result = []
        result.append(f"[{count} consecutive similar outputs]")

        # Keep first 2 lines
        for line in lines1[:2]:
            result.append(line)

        result.append(f"... ({count - 2} similar outputs omitted)")

        # Keep last 2 lines
        for line in lines2[-2:]:
            result.append(line)

        return "\n".join(result)

    def _compress_large_group(self, item: dict, count: int) -> str:
        """Compress a large group of similar items."""
        content = item.get("content", "")
        tool_name = item.get("metadata", {}).get("tool_name", "") or item.get("tool_name", "")

        # Keep key structural info + first and last snippet
        first_lines = content.split("\n")[:3]
        last_lines = content.split("\n")[-3:] if len(content.split("\n")) > 6 else first_lines

        result = [
            f"[{count} consecutive outputs from tool: {tool_name}]",
            "\n".join(first_lines),
            f"... ({count - 2} outputs with identical structure omitted)",
            "\n".join(last_lines),
        ]

        return "\n".join(result)
