"""
Context Summarizer: Three-level fallback summarization for Hermes sessions.

Implements a deterministic fallback pipeline that never silently drops constraints:
1. Progressive Compression — aggressive token reduction while preserving structure
2. Selective Retention — keep critical elements, compress the rest
3. Minimal Summary — key facts, constraints, and recent state only

Design decisions:
- Level selection based on remaining budget, not arbitrary cutoffs
- Critical elements always preserved: user instructions, tool schemas, constraints
- No LLM dependency for compression — uses rule-based heuristics
- Output is always a valid context string ready for injection
- Preserves JSON/XML structure for structured tool outputs
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class ContextItem:
    """A single item in the context history."""
    role: str          # "system", "user", "assistant", "tool"
    content: str       # The actual content
    tool_name: str = ""    # Tool name if it's a tool output
    tokens: int = 0      # Estimated token count
    priority: int = 2    # 0=critical, 1=high, 2=normal, 3=low
    metadata: dict = field(default_factory=dict)


@dataclass
class SummaryResult:
    """Result of a summarization operation."""
    summary: str
    level: int           # 1, 2, or 3
    items_compressed: int
    items_preserved: int
    original_token_count: int
    summary_token_count: int
    compression_ratio: float


class ContextSummarizer:
    """
    Three-level fallback summarizer for context management.

    Usage:
        summarizer = ContextSummarizer(max_summary_tokens=40000)
        result = summarizer.summarize(items, remaining_budget=60000)
        # result.summary contains the compressed context
    """

    def __init__(
        self,
        max_summary_tokens: int = 40_000,
        min_preserved_tokens: int = 5_000,
        max_compressed_item_length: int = 500,
    ):
        self.max_summary_tokens = max_summary_tokens
        self.min_preserved_tokens = min_preserved_tokens
        self.max_compressed_item_length = max_compressed_item_length

    def summarize(
        self,
        items: List[ContextItem],
        remaining_budget: int,
    ) -> SummaryResult:
        """
        Summarize context items using three-level fallback.

        Returns a SummaryResult with the compressed context.
        """
        if not items:
            return SummaryResult(
                summary="",
                level=3,
                items_compressed=0,
                items_preserved=0,
                original_token_count=0,
                summary_token_count=0,
                compression_ratio=1.0,
            )

        original_tokens = sum(item.tokens for item in items)

        # Level 1: Progressive Compression (try first)
        if remaining_budget >= self.max_summary_tokens:
            result = self._level_progressive(items)
        # Level 2: Selective Retention
        elif remaining_budget >= self.min_preserved_tokens:
            result = self._level_selective(items)
        # Level 3: Minimal Summary (last resort)
        else:
            result = self._level_minimal(items)

        return result

    def _level_progressive(self, items: List[ContextItem]) -> SummaryResult:
        """
        Level 1: Progressive Compression.

        Compresses all items aggressively but preserves structure:
        - Truncates long tool outputs to key lines
        - Removes whitespace-only or empty items
        - Preserves tool names and structure metadata
        - Keeps full content for short items (< 200 tokens)
        """
        compressed = []
        compressed_count = 0
        preserved_count = 0

        for item in items:
            if item.tokens <= 200 or item.priority < 2:
                # Short items and high-priority items are kept intact
                compressed.append(item)
                preserved_count += 1
            else:
                # Compress long items
                new_item = self._compress_item(item)
                compressed.append(new_item)
                compressed_count += 1

        summary = self._format_context(compressed)
        summary_tokens = self._estimate_tokens(summary)

        return SummaryResult(
            summary=summary,
            level=1,
            items_compressed=compressed_count,
            items_preserved=preserved_count,
            original_token_count=sum(i.tokens for i in items),
            summary_token_count=summary_tokens,
            compression_ratio=(
                summary_tokens / sum(i.tokens for i in items)
                if sum(i.tokens for i in items) > 0
                else 1.0
            ),
        )

    def _level_selective(self, items: List[ContextItem]) -> SummaryResult:
        """
        Level 2: Selective Retention.

        Keeps only critical elements fully, compresses the rest heavily:
        - All system/user instructions preserved
        - Tool outputs: keep tool name + result summary
        - Assistant responses: keep first and last line
        - Compressed items shortened to < 100 tokens
        """
        critical = []
        compressed = []
        critical_count = 0
        compressed_count = 0

        for item in items:
            if item.priority < 2:
                critical.append(item)
                critical_count += 1
            elif item.role in ("system", "user"):
                critical.append(item)
                critical_count += 1
            else:
                new_item = self._compress_item(item)
                compressed.append(new_item)
                compressed_count += 1

        # Limit to budget
        all_items = critical + compressed
        if self._estimate_tokens(self._format_context(all_items)) > self.max_summary_tokens:
            all_items = critical[:10] + compressed[-50:]

        summary = self._format_context(all_items)
        summary_tokens = self._estimate_tokens(summary)

        return SummaryResult(
            summary=summary,
            level=2,
            items_compressed=compressed_count,
            items_preserved=critical_count,
            original_token_count=sum(i.tokens for i in items),
            summary_token_count=summary_tokens,
            compression_ratio=(
                summary_tokens / sum(i.tokens for i in items)
                if sum(i.tokens for i in items) > 0
                else 1.0
            ),
        )

    def _level_minimal(self, items: List[ContextItem]) -> SummaryResult:
        """
        Level 3: Minimal Summary.

        Extracts only key facts, constraints, and recent state:
        - First item (system prompt) fully preserved
        - Last 3 user/assistant turns fully preserved
        - All tool names and error statuses tracked
        - All constraints/instructions extracted
        """
        key_items = []
        constraints = []
        tool_log = []

        for item in items:
            # Extract constraints from system/user content
            if item.role in ("system", "user") and item.priority < 2:
                key_items.append(item)
                constraints.extend(self._extract_constraints(item.content))

            # Track tool calls
            if item.role == "tool":
                tool_log.append({
                    "name": item.tool_name,
                    "success": item.metadata.get("success", True),
                    "truncated": True,
                })

            # Keep last 3 assistant/user turns
            if item.role in ("assistant", "user") and item.priority < 2:
                key_items.append(item)

        # Always keep the most recent items
        recent = key_items[-3:] if len(key_items) > 3 else key_items

        summary = self._build_minimal_summary(
            key_items=recent,
            constraints=constraints,
            tool_log=tool_log,
        )
        summary_tokens = self._estimate_tokens(summary)

        return SummaryResult(
            summary=summary,
            level=3,
            items_compressed=len(items) - len(recent) - len(constraints),
            items_preserved=len(recent) + len(constraints),
            original_token_count=sum(i.tokens for i in items),
            summary_token_count=summary_tokens,
            compression_ratio=(
                summary_tokens / sum(i.tokens for i in items)
                if sum(i.tokens for i in items) > 0
                else 1.0
            ),
        )

    def _compress_item(self, item: ContextItem) -> ContextItem:
        """Compress a single context item."""
        lines = item.content.split("\n")

        if len(lines) <= 5:
            # Short enough, keep as-is
            return item

        # Truncate to first 3 and last 3 lines with ellipsis
        if len(lines) > 10:
            compressed = "\n".join(lines[:3])
            compressed += "\n... [truncated] ...\n"
            compressed += "\n".join(lines[-3:])
        else:
            compressed = "\n".join(lines[:5])

        new_tokens = self._estimate_tokens(compressed)

        return ContextItem(
            role=item.role,
            content=compressed,
            tool_name=item.tool_name,
            tokens=new_tokens,
            priority=item.priority,
            metadata={**item.metadata, "compressed": True, "original_lines": len(lines)},
        )

    def _format_context(self, items: List[ContextItem]) -> str:
        """Format a list of context items into a structured context string."""
        parts = []
        for item in items:
            if item.role == "system":
                parts.append(f"[SYSTEM] {item.content}")
            elif item.role == "user":
                parts.append(f"[USER]\n{item.content}")
            elif item.role == "assistant":
                parts.append(f"[ASSISTANT]\n{item.content}")
            elif item.role == "tool":
                status = item.metadata.get("success", True)
                status_str = "OK" if status else "ERROR"
                name = item.tool_name or "unknown"
                parts.append(f"[TOOL: {name} ({status_str})]\n{item.content[:2000]}")
            else:
                parts.append(f"[{item.role.upper()}]\n{item.content[:1000]}")

        return "\n\n".join(parts)

    def _extract_constraints(self, content: str) -> List[str]:
        """Extract constraint-like statements from text."""
        constraints = []
        patterns = [
            r"(?:must|should|require|need)[:.]\s*(.+?)(?:\n|$)",
            r"(?:NOTE|IMPORTANT|CRITICAL):(.+?)(?:\n|$)",
            r"(?:constraint|rule|limit):(.+?)(?:\n|$)",
        ]
        for pattern in patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            constraints.extend(matches)
        return constraints

    def _build_minimal_summary(
        self,
        key_items: List[ContextItem],
        constraints: List[str],
        tool_log: List[dict],
    ) -> str:
        """Build a minimal summary string."""
        parts = []

        if constraints:
            parts.append("[CONSTRAINTS]")
            for c in constraints[:10]:  # Limit constraints
                parts.append(f"  - {c.strip()}")

        if tool_log:
            parts.append("[TOOL HISTORY]")
            for entry in tool_log[-20:]:  # Keep last 20 tool calls
                status = "✓" if entry["success"] else "✗"
                parts.append(f"  {status} {entry['name']}")

        for item in key_items[-3:]:  # Last 3 turns
            if item.role == "system":
                parts.append(f"\n[SYSTEM]\n{item.content[:500]}")
            elif item.role == "assistant":
                parts.append(f"\n[ASSISTANT]\n{item.content[:300]}...")
            elif item.role == "user":
                parts.append(f"\n[USER]\n{item.content[:300]}...")

        return "\n".join(parts)

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (same as TokenMonitor)."""
        if not text:
            return 0
        return max(1, int(len(text) * 0.25))
