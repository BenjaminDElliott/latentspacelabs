"""Pattern Mining — extract recurring tool call sequences and error handling from logs.

Analyzes Hermes agent interaction logs (``~/.hermes/logs/agent.log*``) to discover:
1. Recurring tool call sequences that indicate reusable skill patterns
2. Error handling idioms (e.g. retry-after-timeout, approval-then-execute)
3. Planning heuristics (read-before-write, validate-before-apply)

Outputs structured pattern records suitable for feeding into the skill synthesis
engine. Designed to process logs in <5 seconds per candidate pattern.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Log format detection
# ---------------------------------------------------------------------------

# Matches lines like:
# 2026-06-14 06:27:35,976 INFO [20260614_062618_81c571] agent.tool_executor: tool terminal completed (0.18s, 1009 chars)
TOOL_COMPLETED_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2},\d{3})\s+\S+\s+\[([^\]]+)\]\s+"
    r"agent\.tool_executor:\s+tool\s+(\S+)\s+completed\s+"
    r"\(([\d.]+)s,\s*(\d+)\s+chars\)",
)

TOOL_ERROR_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2},\d{3})\s+\S+\s+\[([^\]]+)\]\s+"
    r"agent\.tool_executor:\s+Tool\s+(\S+)\s+returned error\s+"
    r"\(([\d.]+)s\):\s+(.+)",
    re.DOTALL,
)

SESSION_RE = re.compile(r"\[([^\]]+)\]")

API_CALL_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2},\d{3})\s+\S+\s+\[([^\]]+)\]\s+"
    r"agent\.conversation_loop:\s+API call #(\d+):",
)


@dataclass
class ToolEvent:
    """Represents a single tool execution event from logs."""
    timestamp: str
    session_id: str
    tool_name: str
    duration_sec: float
    output_chars: int
    success: bool = True
    error_detail: Optional[str] = None


@dataclass
class ToolSequence:
    """A sequence of tool calls within a single session."""
    session_id: str
    events: List[ToolEvent] = field(default_factory=list)
    tool_names: List[str] = field(default_factory=list)

    def add_event(self, event: ToolEvent) -> None:
        self.events.append(event)
        self.tool_names.append(event.tool_name)


@dataclass
class PatternCandidate:
    """A discovered pattern candidate ready for synthesis."""
    pattern_type: str  # 'tool_sequence' | 'error_handling' | 'planning_heuristic'
    tool_sequence: List[str]
    context: Dict[str, object] = field(default_factory=dict)
    occurrence_count: int = 1
    error_patterns: List[str] = field(default_factory=list)
    avg_duration: float = 0.0
    source_logs: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "pattern_type": self.pattern_type,
            "tool_sequence": self.tool_sequence,
            "context": self.context,
            "occurrence_count": self.occurrence_count,
            "error_patterns": self.error_patterns,
            "avg_duration": self.avg_duration,
            "source_logs": self.source_logs,
        }


class PatternMiner:
    """Extracts recurring tool call patterns from Hermes agent logs."""

    DEFAULT_LOG_DIR = Path.home() / ".hermes" / "logs"

    def __init__(self, log_dir: Optional[str] = None):
        """
        Args:
            log_dir: Directory containing agent log files. Defaults to
                     ``~/.hermes/logs/``.
        """
        self.log_dir = Path(log_dir) if log_dir else self.DEFAULT_LOG_DIR

    def mine(self, max_sessions: int = 200) -> List[PatternCandidate]:
        """
        Run the full pattern mining pipeline.

        Args:
            max_sessions: Maximum number of sessions to process.

        Returns:
            List of PatternCandidate objects, sorted by occurrence_count descending.
        """
        log_files = self._discover_log_files()
        logger.info("Found %d log files in %s", len(log_files), self.log_dir)

        all_events: List[ToolEvent] = []
        session_ids_seen: set = set()
        session_id_to_logs: Dict[str, str] = {}

        for log_file in log_files:
            events = self._parse_log_file(log_file)
            for event in events:
                all_events.append(event)
                if event.session_id not in session_ids_seen:
                    session_ids_seen.add(event.session_id)
                    session_id_to_logs[event.session_id] = str(log_file)
                else:
                    if session_id_to_logs.get(event.session_id) != str(log_file):
                        # Same session spans multiple files
                        existing = session_id_to_logs[event.session_id]
                        if str(log_file) not in existing:
                            session_id_to_logs[event.session_id] = f"{existing},{str(log_file)}"

            if len(session_ids_seen) >= max_sessions:
                logger.info("Reached max_sessions limit (%d)", max_sessions)
                break

        logger.info("Parsed %d tool events across %d sessions", len(all_events), len(session_ids_seen))

        # Group by session
        sessions: Dict[str, ToolSequence] = defaultdict(lambda: ToolSequence(session_id=""))
        for event in all_events:
            seq = sessions[event.session_id]
            seq.session_id = event.session_id
            seq.add_event(event)

        # Filter to meaningful sessions (at least 2 tool calls)
        meaningful_sessions = {
            sid: seq for sid, seq in sessions.items() if len(seq.tool_names) >= 2
        }

        logger.info("%d sessions with >= 2 tool calls", len(meaningful_sessions))

        # Extract patterns
        candidates = self._extract_sequence_patterns(meaningful_sessions)
        candidates.extend(self._extract_error_patterns(meaningful_sessions))
        candidates.extend(self._extract_planning_heuristics(meaningful_sessions))

        # Sort by occurrence
        candidates.sort(key=lambda c: c.occurrence_count, reverse=True)

        logger.info("Discovered %d pattern candidates", len(candidates))
        return candidates

    # ------------------------------------------------------------------
    # Log parsing
    # ------------------------------------------------------------------

    def _discover_log_files(self) -> List[Path]:
        """Find all agent log files, newest first."""
        if not self.log_dir.exists():
            logger.warning("Log directory %s does not exist", self.log_dir)
            return []

        log_files = sorted(
            self.log_dir.glob("agent.log*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        return log_files

    def _parse_log_file(self, log_file: Path) -> List[ToolEvent]:
        """Parse a single log file and extract tool events."""
        events: List[ToolEvent] = []

        try:
            content = log_file.read_text(errors="replace")
        except Exception as exc:
            logger.warning("Failed to read %s: %s", log_file, exc)
            return events

        lines = content.splitlines()

        # Build a session-indexed list of events
        session_events: Dict[str, List[ToolEvent]] = defaultdict(list)

        for line in lines:
            # Try tool completed
            m = TOOL_COMPLETED_RE.search(line)
            if m:
                ts, session_id, tool_name, duration, output_chars = m.groups()
                event = ToolEvent(
                    timestamp=ts,
                    session_id=session_id,
                    tool_name=tool_name,
                    duration_sec=float(duration),
                    output_chars=int(output_chars),
                    success=True,
                )
                session_events[session_id].append(event)
                continue

            # Try tool error
            m = TOOL_ERROR_RE.search(line)
            if m:
                ts, session_id, tool_name, duration, error_detail = m.groups()
                event = ToolEvent(
                    timestamp=ts,
                    session_id=session_id,
                    tool_name=tool_name,
                    duration_sec=float(duration),
                    output_chars=0,
                    success=False,
                    error_detail=error_detail.strip(),
                )
                session_events[session_id].append(event)
                continue

        # Sort events within each session by timestamp
        for session_id, events_list in session_events.items():
            events_list.sort(key=lambda e: e.timestamp)
            events.extend(events_list)

        return events

    # ------------------------------------------------------------------
    # Pattern extraction
    # ------------------------------------------------------------------

    def _extract_sequence_patterns(
        self, sessions: Dict[str, ToolSequence]
    ) -> List[PatternCandidate]:
        """Find recurring tool call sequences (N-grams)."""
        # Count all sequential tool pairs and triples
        pair_counter: Counter = Counter()
        triple_counter: Counter = Counter()
        quad_counter: Counter = Counter()
        session_map: Dict[tuple, str] = {}

        for session_id, seq in sessions.items():
            names = seq.tool_names
            if len(names) < 2:
                continue

            for i in range(len(names) - 1):
                pair = (names[i], names[i + 1])
                pair_counter[pair] += 1

            for i in range(len(names) - 2):
                triple = (names[i], names[i + 1], names[i + 2])
                triple_counter[triple] += 1

            for i in range(len(names) - 3):
                quad = (names[i], names[i + 1], names[i + 2], names[i + 3])
                quad_counter[quad] += 1

        candidates: List[PatternCandidate] = []
        seen_sequences: set = set()

        # Collect significant pairs (>= 3 occurrences)
        for seq, count in pair_counter.most_common(50):
            if count < 3:
                continue
            if tuple(seq) in seen_sequences:
                continue
            seen_sequences.add(tuple(seq))
            candidates.append(PatternCandidate(
                pattern_type="tool_sequence",
                tool_sequence=list(seq),
                occurrence_count=count,
                context={"granularity": "pair"},
            ))

        # Collect significant triples (>= 2 occurrences)
        for seq, count in triple_counter.most_common(50):
            if count < 2:
                continue
            if tuple(seq) in seen_sequences:
                continue
            seen_sequences.add(tuple(seq))
            candidates.append(PatternCandidate(
                pattern_type="tool_sequence",
                tool_sequence=list(seq),
                occurrence_count=count,
                context={"granularity": "triple"},
            ))

        # Collect significant quads (>= 2 occurrences)
        for seq, count in quad_counter.most_common(30):
            if count < 2:
                continue
            if tuple(seq) in seen_sequences:
                continue
            seen_sequences.add(tuple(seq))
            candidates.append(PatternCandidate(
                pattern_type="tool_sequence",
                tool_sequence=list(seq),
                occurrence_count=count,
                context={"granularity": "quad"},
            ))

        return candidates

    def _extract_error_patterns(
        self, sessions: Dict[str, ToolSequence]
    ) -> List[PatternCandidate]:
        """Find recurring error sequences (tool + error + recovery)."""
        error_sequences: Dict[tuple, int] = defaultdict(int)

        for session_id, seq in sessions.items():
            for i, event in enumerate(seq.events):
                if not event.success and event.error_detail:
                    # Look at the tool call after the error (recovery pattern)
                    recovery: List[str] = [event.tool_name]
                    if i + 1 < len(seq.events):
                        recovery.append(seq.events[i + 1].tool_name)
                    if i + 2 < len(seq.events):
                        recovery.append(seq.events[i + 2].tool_name)

                    error_type = self._classify_error(event.error_detail)
                    key = (tuple(recovery), error_type)
                    error_sequences[key] += 1

        candidates: List[PatternCandidate] = []
        for (recovery_seq, error_type), count in error_sequences.items():
            if count < 2:
                continue
            candidates.append(PatternCandidate(
                pattern_type="error_handling",
                tool_sequence=list(recovery_seq),
                occurrence_count=count,
                error_patterns=[error_type],
                context={"error_type": error_type},
            ))

        return candidates

    @staticmethod
    def _classify_error(error_detail: str) -> str:
        """Classify an error message into a canonical error type."""
        error_lower = error_detail.lower()

        if "approval_pending" in error_lower:
            return "pending_approval"
        if "timeout" in error_lower:
            return "timeout"
        if "not_found" in error_lower:
            return "resource_not_found"
        if "rate_limit" in error_lower or "429" in error_lower:
            return "rate_limit"
        if "permission" in error_lower or "denied" in error_lower:
            return "permission_denied"
        if "connection" in error_lower or "refused" in error_lower:
            return "connection_error"
        if "format" in error_lower or "syntax" in error_lower or "schema" in error_lower:
            return "format_error"
        if "memory" in error_lower or "context" in error_lower and "exceeded" in error_lower:
            return "context_overflow"
        if "repeated" in error_lower or "identical" in error_lower:
            return "repeated_exact_failure"

        return "other"

    def _extract_planning_heuristics(
        self, sessions: Dict[str, ToolSequence]
    ) -> List[PatternCandidate]:
        """Discover planning heuristics like read-before-write patterns."""
        heuristics: Dict[str, int] = defaultdict(int)

        # Tool name patterns for each heuristic
        heuristic_tool_patterns: Dict[str, List[str]] = {
            "read_before_write": ["get_", "list_", "read_file", "search_files"],
            "validate_before_apply": ["check", "lint", "compile", "test"],
            "iterate_on_failure": ["retry", "fix"],
            "context_gathering": ["ls", "find", "grep", "head"],
            "atomic_edit": ["write_file", "patch"],
        }

        for session_id, seq in sessions.items():
            names = set(seq.tool_names)

            # read_before_write: get/list/read exists before write/patch
            read_tools = heuristic_tool_patterns["read_before_write"]
            write_tools = heuristic_tool_patterns["atomic_edit"]
            has_reads = any(rt in names for rt in read_tools)
            has_writes = any(wt in names for wt in write_tools)
            if has_reads and has_writes:
                heuristics["read_before_write"] += 1

            # validate_before_apply: check/lint/test after edits
            validation_tools = heuristic_tool_patterns["validate_before_apply"]
            has_edits = any(wt in names for wt in write_tools)
            has_validation = any(vt in names for vt in validation_tools)
            if has_edits and has_validation:
                heuristics["validate_before_apply"] += 1

            # context_gathering at start of sessions
            if seq.events:
                first_tools = seq.events[:2]
                context_tools = heuristic_tool_patterns["context_gathering"]
                for evt in first_tools:
                    if evt.tool_name in context_tools:
                        heuristics["context_gathering"] += 1
                        break

        candidates: List[PatternCandidate] = []
        for heuristic_name, count in heuristics.items():
            if count < 2:
                continue
            tool_list = heuristic_tool_patterns.get(heuristic_name, [heuristic_name])
            candidates.append(PatternCandidate(
                pattern_type="planning_heuristic",
                tool_sequence=tool_list[:3],
                occurrence_count=count,
                context={"heuristic": heuristic_name},
            ))

        return candidates

    def export_patterns(self, candidates: List[PatternCandidate]) -> List[Dict[str, object]]:
        """Export patterns as a flat list of dicts for the synthesis engine."""
        return [c.to_dict() for c in candidates]
