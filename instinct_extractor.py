#!/usr/bin/env python3
"""
Instinct Extraction POC (LAT-297)

Scans completed agent sessions for recurring patterns, scores their confidence,
generates SKILL.md candidates, and maintains a human review queue.

PRD Reference: ~/.hermes/vault/prds/agent-harness-ecosystem-ecc.md
Phase 4: Instinct Extraction (Week 4-5)
"""

import json
import os
import re
import sqlite3
import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HOME = Path.home()
SESSION_DIR = HOME / ".hermes" / "cron" / "output"
REVIEW_QUEUE_PATH = HOME / ".hermes" / "state" / "instinct_review_queue.db"
INSTINCT_LOG = HOME / ".hermes" / "state" / "instincts_extracted.json"


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Pattern:
    """A recurring pattern found across sessions."""
    pattern_id: str
    category: str           # e.g. "tool-use", "workflow", "pitfall", "cron-job"
    description: str
    occurrences: int
    confidence: float       # 0.0 – 1.0
    examples: list[str]     # session summaries where this pattern appeared
    metadata: dict = field(default_factory=dict)

    @property
    def passes_threshold(self) -> bool:
        return self.occurrences >= 3


def _make_id(text: str) -> str:
    """Generate a stable ID from text."""
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def _slugify(text: str) -> str:
    """Convert text to a URL-friendly slug."""
    slug = text.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unknown"


@dataclass
class SkillCandidate:
    """A SKILL.md generated from a high-confidence pattern."""
    title: str
    name: str               # slug for SKILL.md frontmatter
    description: str
    category: str
    content: str            # full SKILL.md markdown
    source_pattern: Pattern
    confidence: float
    status: str = "pending_review"  # pending_review | approved | rejected


@dataclass
class ReviewItem:
    """Entry in the human review queue."""
    id: int
    skill_name: str
    title: str
    description: str
    confidence: float
    source_pattern_id: str
    generated_at: str
    status: str = "pending"   # pending | approved | rejected
    reviewer_notes: str = ""


# ---------------------------------------------------------------------------
# Session data loader
# ---------------------------------------------------------------------------

def load_sessions(session_dir: Path = SESSION_DIR) -> list[dict]:
    """
    Load all completed cron job session files.
    Returns a list of dicts with keys: job_id, filename, run_time, content, job_name.
    """
    sessions = []
    if not session_dir.exists():
        return sessions

    for run_dir in sorted(session_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        job_id = run_dir.name
        for md_file in sorted(run_dir.glob("*.md")):
            try:
                content = md_file.read_text(errors="replace")
            except OSError:
                continue

            # Extract run time from filename or header
            run_time = _extract_run_time(content, md_file.name)
            job_name = _extract_job_name(content)

            sessions.append({
                "job_id": job_id,
                "filename": md_file.name,
                "run_time": run_time,
                "content": content,
                "job_name": job_name,
            })

    return sessions


def _extract_run_time(content: str, filename: str) -> str:
    # Try header first
    m = re.search(r"\*\*Run Time:\*\*\s*(.+)", content)
    if m:
        return m.group(1).strip()
    # Fallback to filename
    return filename.replace(".md", "")


def _extract_job_name(content: str) -> str:
    m = re.search(r"# Cron Job:\s*(.+)", content)
    if m:
        return m.group(1).strip()
    return "unknown"


# ---------------------------------------------------------------------------
# AC 1: Session pattern extractor
# ---------------------------------------------------------------------------

PATTERN_CATEGORIES = {
    "cron-job": re.compile(
        r"# Cron Job:\s*(.+)", re.IGNORECASE
    ),
    "skill-invocation": re.compile(
        r'name:\s*([\w-]+)',
    ),
    "tool-use": re.compile(
        r"(mcp_linear_\w+|terminal|read_file|write_file|patch|process\(|search_files|get_diff|get_issue|list_issues|save_issue|create_issue|list_comments|save_comment|get_project|save_project|list_projects|list_teams|get_team|list_users|get_user|save_document|get_document|list_documents|save_milestone|get_milestone|list_milestones|list_diffs|get_diff|get_diff_threads|extract_images|save_issue_label|delete_comment|delete_attachment|get_attachment|prepare_attachment_upload|create_attachment_from_upload|create_attachment|save_cycle|get_milestone|list_milestones|list_cycles)",
    ),
    "workflow-step": re.compile(
        r"(### Step \d+|## Phase \d+|Step \d+:|Phase \d+:)",
    ),
    "pitfall": re.compile(
        r"Pitfall|pitfall|PITFALL|\*\*\w+\*\*:|Common mistake|Always call|Must call|Do NOT|Never|Check.*before|verify.*before",
    ),
    "deadline-pattern": re.compile(
        r"Run every\s+(\d+[mhs])|Schedule:\s*(.+\d+[mhs])",
    ),
    "path-pattern": re.compile(
        r"(~/.hermes/\S+|/workspace/\S+|\.hermes/\S+)",
    ),
    "delegation-pattern": re.compile(
        r"delegate_task\(|delegate to|Delegat",
    ),
    "linear-state-correction": re.compile(
        r"Linear state corrections|STATE\s+LAT-\d+|Backlog -> In Progress|In Progress -> In Review|In Review -> Done",
    ),
    "worktree-cleanup": re.compile(
        r"Worktrees cleaned|CLEAN worktree|worktree.*Done|orphan.*branch",
    ),
    "stalled-assign": re.compile(
        r"Stalled In-Progress|Stalled.*assigned|review manually",
    ),
    "agent-dispatch": re.compile(
        r"agents?\s+dispatched?\s*(\d+)|Dispatch Report|LAT-\d+.*(?:timeout|completed|PR created)",
    ),
    "mcp-unreachability": re.compile(
        r"MCP server.*unreachable|Auto-retry|cooldown",
    ),
    "label-creation": re.compile(
        r"list_issue_labels.*before|create_issue_label|Labels may not exist|label.*not exist",
    ),
    "note-enrichment": re.compile(
        r"enrichment|enriched note|placeholder|Thin placeholder|Phase 4b|Two-Stage",
    ),
    "github-search": re.compile(
        r"api\.github\.com/search",
    ),
    "hn-rss": re.compile(
        r"hnrss\.org",
    ),
    "arxiv-search": re.compile(
        r"export\.arxiv\.org",
    ),
    "parallel-execution": re.compile(
        r"parallel|concurrent|simultaneously|multiple agents?\s+working",
    ),
    "error-handling": re.compile(
        r"HTTP \d+|400|404|502|retry|Retry|fallback|Fallback|recovered",
    ),
    "self-improvement-loop": re.compile(
        r"self-improvement|improvement-audit|signal.?quality|delta.?measurement|deliverable.validation",
    ),
    "flywheel-phase": re.compile(
        r"intake|planning|dispatch|implement|PR|MQA|merge|review",
    ),
}


class PatternExtractor:
    """Scans sessions to discover recurring patterns."""

    def __init__(self, sessions: list[dict] | None = None, session_dir: Path = SESSION_DIR):
        self.sessions = sessions or load_sessions(session_dir)
        self.patterns: list[Pattern] = []

    def extract_all(self) -> list[Pattern]:
        """Run all pattern detection passes and return scored patterns."""
        # Group patterns by category
        all_raw = defaultdict(list)  # pattern_key -> [(session, match_text), ...]

        for session in self.sessions:
            text = session["content"]
            summary = self._session_summary(session)

            for cat_name, regex in PATTERN_CATEGORIES.items():
                matches = regex.findall(text)
                for match in matches:
                    match_str = match if isinstance(match, str) else match[0]
                    key = f"{cat_name}:{match_str[:120]}"
                    all_raw[key].append((summary, match_str))

        # Build Pattern objects with occurrence counts
        self.patterns = []
        for key, occurrences in all_raw.items():
            cat, desc = key.split(":", 1)
            occurrences_count = len(occurrences)
            confidence = self._compute_confidence(occurrences_count)
            examples = [occ[0] for occ in occurrences[:5]]  # top 5 examples

            # Deduplicate examples
            examples = list(dict.fromkeys(examples))

            pattern = Pattern(
                pattern_id=_make_id(key),
                category=cat,
                description=desc,
                occurrences=occurrences_count,
                confidence=confidence,
                examples=examples,
                metadata={"regex_source": cat},
            )
            self.patterns.append(pattern)

        # Sort by confidence desc, then occurrences desc
        self.patterns.sort(key=lambda p: (p.confidence, p.occurrences), reverse=True)
        return self.patterns

    @staticmethod
    def _session_summary(session: dict) -> str:
        """Create a concise summary of a session for pattern examples."""
        parts = [
            f"[{session['job_name']}] {session['filename']}",
            f"run_time={session['run_time']}",
        ]
        # Include the first section after the header
        lines = session["content"].split("\n")
        # Find first meaningful section
        in_section = False
        section_lines = []
        for line in lines:
            if line.startswith("# Cron Job:"):
                continue
            if line.startswith("**Job ID:") or line.startswith("**Run Time:") or line.startswith("**Mode:"):
                continue
            if line.startswith("## Prompt") or line.startswith("---"):
                in_section = True
                continue
            if in_section and len(section_lines) < 3:
                section_lines.append(line.strip()[:100])
        if section_lines:
            parts.append(" | ".join(section_lines))
        return " | ".join(parts)

    @staticmethod
    def _compute_confidence(occurrences: int) -> float:
        """
        AC 2: Confidence scoring.
        confidence = min(1.0, occurrences / threshold * some_factor)
        threshold >= 3 occurrences is the minimum for a skill candidate.
        """
        if occurrences < 1:
            return 0.0
        # Scale: 1 occurrence = 0.15, 3 = 0.5, 10 = 0.9, 30+ = 1.0
        if occurrences < 3:
            return min(0.5, occurrences * 0.15)
        elif occurrences < 10:
            return 0.5 + (occurrences - 3) / 7 * 0.4
        else:
            return min(1.0, 0.9 + (occurrences - 10) / 20 * 0.1)


# ---------------------------------------------------------------------------
# AC 3: Skill candidate generator
# ---------------------------------------------------------------------------

class SkillCandidateGenerator:
    """Convert high-confidence patterns into SKILL.md format."""

    # Templates per category
    TEMPLATES = {
        "cron-job": {
            "name_prefix": "cron-{category}",
            "skill_title_tmpl": "{description} Cron Handler",
            "sections": [
                "## Overview",
                "Automated handler for recurring cron job pattern: {description}",
                "",
                "## Trigger",
                "Runs on schedule (see original pattern: {description})",
                "",
                "## Workflow",
                "1. Load context and identify scope",
                "2. Execute primary operation",
                "3. Log results and update state",
                "",
                "## Pitfalls",
                "- Handle errors gracefully and log to session output",
                "- Check prerequisites before executing",
            ],
        },
        "tool-use": {
            "name_prefix": "tool-{category}",
            "skill_title_tmpl": "{description} Usage Pattern",
            "sections": [
                "## Overview",
                "Best practice for using the {description} tool.",
                "",
                "## When to Use",
                "When this tool appears frequently in agent sessions.",
                "",
                "## Workflow",
                "1. Call `{description}` with validated parameters",
                "2. Check for errors (HTTP status, empty results)",
                "3. Handle edge cases and retry if transient",
                "",
                "## Pitfalls",
                "- Verify identifiers before calling (list first, then act)",
                "- Rate limits may apply — batch operations when possible",
                "- Cache results for repeated queries",
            ],
        },
        "pitfall": {
            "name_prefix": "pitfall-{category}",
            "skill_title_tmpl": "{description}",
            "sections": [
                "## Overview",
                "Common pitfall pattern: {description}",
                "",
                "## When to Watch For",
                "This pitfall appears when working with {category} tasks.",
                "",
                "## Prevention",
                f"- Remember: {{description}}",
                "- Always verify before acting",
                "- Log the pitfall if it occurs",
                "",
                "## Resolution",
                "When encountered: identify the cause, apply fix, log for pattern tracking.",
            ],
        },
        "linear-state-correction": {
            "name_prefix": "linear-state",
            "skill_title_tmpl": "Linear State Correction Pattern",
            "sections": [
                "## Overview",
                "Pattern for detecting and correcting Linear state mismatches.",
                "",
                "## When to Run",
                "- Periodic reconciliation (linear-reconcile cron)",
                "- After PR merges or issue updates",
                "",
                "## Workflow",
                "1. List all issues with `mcp_linear_list_issues`",
                "2. Compare states with actual progress (branches, PRs)",
                "3. Apply corrections: Backlog -> In Progress, In Progress -> In Review, etc.",
                "4. Flag stalled items for manual review",
                "",
                "## Pitfalls",
                "- Linear status often lags behind GitHub PR state",
                "- Empty Linear workspace can have committed branches — check directly",
                "- PRs can be no-ops while real work lives on a separate branch",
            ],
        },
        "agent-dispatch": {
            "name_prefix": "agent-dispatch",
            "skill_title_tmpl": "Multi-Agent Dispatch Pattern",
            "sections": [
                "## Overview",
                "Pattern for dispatching multiple agents to parallel tasks.",
                "",
                "## Workflow",
                "1. Find all dispatchable tasks from all projects",
                "2. Prioritize: Flywheel > Loops > BXNG > Self-Improvement",
                "3. Create worktrees and branches",
                "4. Delegate up to 4 agents per run using delegate_task()",
                "5. Track completion status for each task",
                "",
                "## Rules",
                "- MUST dispatch 4 agents per run (or fewer if <4 tasks)",
                "- Each agent works on a DIFFERENT task",
                "- NO duplicate dispatches",
                "- Verify PRs linked to Linear issues",
                "",
                "## Pitfalls",
                "- Timeout → work recovered, committed, PR created",
                "- Some tasks complete with test failures — verify test results",
            ],
        },
        "mcp-unreachability": {
            "name_prefix": "mcp-recovery",
            "skill_title_tmpl": "MCP Server Recovery Pattern",
            "sections": [
                "## Overview",
                "Pattern for handling MCP server unreachability and auto-recovery.",
                "",
                "## Workflow",
                "1. Detect unreachability (3 consecutive failures)",
                "2. Note the cooldown message (e.g., 'Auto-retry available in ~40-45s')",
                "3. Wait full cooldown + 5s buffer",
                "4. Retry the operation",
                "",
                "## Pitfalls",
                "- Do NOT retry within the cooldown window",
                "- Exact cooldown: measure, not guess",
                "- Server auto-recovers — no manual restart needed",
            ],
        },
        "label-creation": {
            "name_prefix": "label-management",
            "skill_title_tmpl": "Linear Label Management Pattern",
            "sections": [
                "## Overview",
                "Pattern for managing Linear issue labels safely.",
                "",
                "## Workflow",
                "1. Call `mcp_linear_list_issue_labels` before applying labels",
                "2. Create missing labels with `mcp_linear_create_issue_label`",
                "3. Apply labels with EXACT casing from list output",
                "",
                "## Pitfalls",
                "- Labels may not exist — call list first",
                "- `save_issue` with missing labels succeeds silently",
                "- Case-sensitive: use EXACT casing from output",
            ],
        },
        "note-enrichment": {
            "name_prefix": "note-enrichment",
            "skill_title_tmpl": "Note Enrichment Pattern",
            "sections": [
                "## Overview",
                "Two-stage note creation: create placeholder, then enrich with real content.",
                "",
                "## Workflow",
                "1. run.py creates thin placeholder notes (~20 words)",
                "2. Cron handler does enrichment pass:",
                "   a. Read each new note's topic",
                "   b. Quick web search for that topic",
                "   c. Rewrite with specific facts, numbers, URLs",
                "   d. Update SQLite DB summary and word_count",
                "",
                "## Quality Gate",
                "Enriched notes should be ≥150 words. Notes under 100 words are placeholders.",
                "",
                "## Pitfalls",
                "- Without enrichment, vault notes are useless",
                "- Check HN RSS reliability — fall back to GitHub API",
                "- HN RSS search endpoint returns 404/502 — use frontpage instead",
            ],
        },
        "flywheel-phase": {
            "name_prefix": "flywheel",
            "skill_title_tmpl": "Agentic Dev Flywheel Pattern",
            "sections": [
                "## Overview",
                "Full pipeline: intake → planning → dispatch → implement → PR → MQA review → merge.",
                "",
                "## Pipeline Stages",
                "1. **Intake**: Self-improvement discovers topics, creates Linear tasks",
                "2. **Planning**: PM Lead Agent triages, creates Epics/Features/Tasks",
                "3. **Dispatch**: Dev Lead Agent finds tasks, creates worktrees, delegates to agents",
                "4. **Implement**: Agents implement tasks, commit code, create PRs",
                "5. **Review**: MQA (Multi-Axis) reviews architecture, tests, quality, correctness",
                "6. **Merge**: Approved PRs merged, Linear issues updated to Done",
                "",
                "## Key Pitfalls",
                "- Empty Linear with committed branches — always verify by scanning branches",
                "- No-ops PRs — real work may live on a separate branch",
                "- Linear status lags behind GitHub — cross-reference",
            ],
        },
        "self-improvement-loop": {
            "name_prefix": "self-improvement",
            "skill_title_tmpl": "Self-Improvement Loop Pattern",
            "sections": [
                "## Overview",
                "Continuous improvement cycle: discover → build → review → measure → feed back.",
                "",
                "## Stages",
                "1. **Discover**: Scan HN, GitHub, arXiv, DDG for topics; check failed jobs",
                "2. **Analyze**: Deep-dive on selected topics, extract facts",
                "3. **Distill**: Create vault notes and Linear tasks",
                "4. **Build**: Implement skills, code, or processes",
                "5. **Review**: MQA evaluates deliverables",
                "6. **Measure**: Delta measurement — before vs after metrics",
                "7. **Feed Back**: Adjust signal weights, prioritize topics",
                "",
                "## Measurement Layers",
                "Layer 1: Deliverable validation (does it work?)",
                "Layer 2: Delta measurement (did it improve metrics?)",
                "Layer 3: Research prioritization (what's worth researching?)",
                "",
                "## Pitfalls",
                "- Check SQLite index before researching same topic",
                "- Notes 500-1000 words max; prune >90 days if vault >500",
                "- GitHub API 60 req/hr unauth; HN RSS ~1 req/sec",
            ],
        },
    }

    def __init__(self, patterns: list[Pattern]):
        self.patterns = [p for p in patterns if p.passes_threshold]

    def generate_candidates(self) -> list[SkillCandidate]:
        """Generate SKILL.md candidates from high-confidence patterns."""
        candidates = []
        for pattern in self.patterns:
            template = self.TEMPLATES.get(pattern.category)
            if not template:
                # Fallback generic template
                template = self._generic_template(pattern)

            content = self._build_skill_md(pattern, template)
            candidate = SkillCandidate(
                title=template["skill_title_tmpl"].format(description=pattern.description),
                name=template["name_prefix"].format(category=pattern.category),
                description=pattern.description,
                category=pattern.category,
                content=content,
                source_pattern=pattern,
                confidence=pattern.confidence,
                status="pending_review",
            )
            candidates.append(candidate)

        return candidates

    def _generic_template(self, pattern: Pattern) -> dict:
        """Generate a generic template when no specific template exists."""
        return {
            "name_prefix": f"{pattern.category}-{_slugify(pattern.description)}",
            "skill_title_tmpl": f"{pattern.description.title()} Pattern",
            "sections": [
                "## Overview",
                f"Pattern extracted from {pattern.occurrences} session occurrences.",
                f"Category: {pattern.category}",
                "",
                "## Description",
                pattern.description,
                "",
                "## When to Use",
                "When this pattern appears in agent sessions.",
                "",
                "## Workflow",
                "1. Identify the pattern context",
                "2. Apply the appropriate action",
                "3. Log results",
                "",
                "## Examples",
                "\n".join(f"- {ex[:80]}" for ex in pattern.examples[:5]),
                "",
                "## Pitfalls",
                f"- Remember: {pattern.description}",
                "- Verify before acting",
                "- Log the pattern if it occurs unexpectedly",
                "",
                "## Confidence",
                f"Pattern confidence: {pattern.confidence:.1%} across {pattern.occurrences} occurrences.",
            ],
        }

    def _build_skill_md(self, pattern: Pattern, template: dict) -> str:
        """Build the full SKILL.md markdown content."""
        lines = []

        # YAML frontmatter
        lines.append("---")
        lines.append(f"name: {template['name_prefix'].format(category=pattern.category)}")
        lines.append(f"description: {pattern.description}")
        lines.append("version: 0.1.0")
        lines.append(f"author: hermes")
        lines.append(f"category: {pattern.category}")
        lines.append(f"confidence: {pattern.confidence:.1%}")
        lines.append(f"source_occurrences: {pattern.occurrences}")
        lines.append("---")
        lines.append("")

        # Title
        title = template["skill_title_tmpl"].format(description=pattern.description)
        lines.append(f"# {title}")
        lines.append("")

        # Sections
        for section in template["sections"]:
            lines.append(section)
            lines.append("")

        # Confidence and metadata section
        lines.append("---")
        lines.append(f"*Auto-generated from {pattern.occurrences} session occurrences. Confidence: {pattern.confidence:.1%}*")
        lines.append(f"*Pattern ID: {pattern.pattern_id}*")
        lines.append(f"*Status: Pending human review*")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# AC 4: Human review queue (SQLite-based)
# ---------------------------------------------------------------------------

class ReviewQueue:
    """SQLite-backed human review queue for skill candidates."""

    def __init__(self, db_path: Path = REVIEW_QUEUE_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Create review queue tables if they don't exist."""
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS review_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    skill_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    confidence REAL NOT NULL,
                    source_pattern_id TEXT,
                    generated_at TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    reviewer_notes TEXT DEFAULT '',
                    skill_content TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS review_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id INTEGER REFERENCES review_queue(id),
                    action TEXT NOT NULL,  -- 'approved', 'rejected', 'notes_updated'
                    reviewer TEXT,
                    notes TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

    def add_candidates(self, candidates: list[SkillCandidate]) -> list[ReviewItem]:
        """Add skill candidates to the review queue. Returns ReviewItems."""
        items = []
        now = datetime.now(timezone.utc).isoformat()

        with sqlite3.connect(str(self.db_path)) as conn:
            for cand in candidates:
                conn.execute(
                    """INSERT INTO review_queue
                       (skill_name, title, description, confidence, source_pattern_id, generated_at, status, skill_content)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        cand.name,
                        cand.title,
                        cand.description,
                        cand.confidence,
                        cand.source_pattern.pattern_id,
                        now,
                        "pending",
                        cand.content,
                    ),
                )
                row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                items.append(ReviewItem(
                    id=row_id,
                    skill_name=cand.name,
                    title=cand.title,
                    description=cand.description,
                    confidence=cand.confidence,
                    source_pattern_id=cand.source_pattern.pattern_id,
                    generated_at=now,
                    status="pending",
                ))
            conn.commit()

        return items

    def get_pending(self) -> list[ReviewItem]:
        """Get all pending review items."""
        with sqlite3.connect(str(self.db_path)) as conn:
            rows = conn.execute(
                "SELECT id, skill_name, title, description, confidence, source_pattern_id, generated_at, status, reviewer_notes FROM review_queue WHERE status = 'pending' ORDER BY confidence DESC"
            ).fetchall()
        return [ReviewItem(*row) for row in rows]

    def get_all(self) -> list[ReviewItem]:
        """Get all review items."""
        with sqlite3.connect(str(self.db_path)) as conn:
            rows = conn.execute(
                "SELECT id, skill_name, title, description, confidence, source_pattern_id, generated_at, status, reviewer_notes FROM review_queue ORDER BY generated_at DESC"
            ).fetchall()
        return [ReviewItem(*row) for row in rows]

    def approve(self, item_id: int, reviewer: str = "herman", notes: str = "") -> bool:
        """Approve a skill candidate."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.execute(
                "UPDATE review_queue SET status = 'approved', reviewer_notes = ? WHERE id = ?",
                (notes, item_id),
            )
            conn.execute(
                "INSERT INTO review_history (item_id, action, reviewer, notes) VALUES (?, 'approved', ?, ?)",
                (item_id, reviewer, notes),
            )
            conn.commit()
            return cursor.rowcount > 0

    def reject(self, item_id: int, reviewer: str = "herman", notes: str = "") -> bool:
        """Reject a skill candidate."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.execute(
                "UPDATE review_queue SET status = 'rejected', reviewer_notes = ? WHERE id = ?",
                (notes, item_id),
            )
            conn.execute(
                "INSERT INTO review_history (item_id, action, reviewer, notes) VALUES (?, 'rejected', ?, ?)",
                (item_id, reviewer, notes),
            )
            conn.commit()
            return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Persistence: log extracted instincts
# ---------------------------------------------------------------------------

def save_extracted_instincts(patterns: list[Pattern], output_path: Path = INSTINCT_LOG):
    """Save extracted patterns to a JSON log for tracking."""
    data = {
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "total_patterns": len(patterns),
        "patterns_above_threshold": sum(1 for p in patterns if p.passes_threshold),
        "patterns": [asdict(p) for p in patterns],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2))
    return output_path


# ---------------------------------------------------------------------------
# Convenience: full pipeline
# ---------------------------------------------------------------------------

def run_extraction(
    session_dir: Path = SESSION_DIR,
    review_db: Path = REVIEW_QUEUE_PATH,
    instinct_log: Path = INSTINCT_LOG,
    min_occurrences: int = 3,
) -> dict:
    """
    Run the full instinct extraction pipeline.

    Returns a dict with keys: patterns, candidates, review_items, log_path.
    """
    # Step 1: Extract patterns
    extractor = PatternExtractor(session_dir=session_dir)
    patterns = extractor.extract_all()

    # Filter by minimum occurrences
    patterns = [p for p in patterns if p.occurrences >= min_occurrences]

    # Step 2: Generate skill candidates
    generator = SkillCandidateGenerator(patterns)
    candidates = generator.generate_candidates()

    # Step 3: Add to review queue
    queue = ReviewQueue(db_path=review_db)
    review_items = queue.add_candidates(candidates)

    # Step 4: Save instincts log
    log_path = save_extracted_instincts(patterns, instinct_log)

    return {
        "patterns": patterns,
        "candidates": candidates,
        "review_items": review_items,
        "log_path": log_path,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    """Run instinct extraction and print summary."""
    print("=" * 60)
    print("Instinct Extraction POC (LAT-297)")
    print("=" * 60)

    result = run_extraction()

    print(f"\nSessions scanned: {len(load_sessions())}")
    print(f"Patterns found (above threshold): {len(result['patterns'])}")
    print(f"Skill candidates generated: {len(result['candidates'])}")
    print(f"Review queue entries: {len(result['review_items'])}")

    if result["patterns"]:
        print("\n--- Top Patterns by Confidence ---")
        for p in result["patterns"][:10]:
            print(f"  [{p.category}] {p.description[:80]}")
            print(f"    occurrences={p.occurrences}, confidence={p.confidence:.1%}")

    if result["candidates"]:
        print("\n--- Skill Candidates ---")
        for c in result["candidates"][:10]:
            print(f"  {c.name}: {c.title}")
            print(f"    confidence={c.confidence:.1%}, status={c.status}")

    if result["review_items"]:
        print(f"\nReview queue ({len(result['review_items'])} pending):")
        for item in result["review_items"]:
            print(f"  [{item.id}] {item.title} (confidence={item.confidence:.1%})")

    print(f"\nInstincts log saved to: {result['log_path']}")
    print(f"Review queue DB: {REVIEW_QUEUE_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
