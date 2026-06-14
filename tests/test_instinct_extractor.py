#!/usr/bin/env python3
"""
Tests for instinct_extractor.py — LAT-297 Instinct Extraction POC.

Covers:
1. Pattern detection accuracy
2. Confidence scoring correctness
3. Skill candidate generation
4. Review queue operations
5. End-to-end pipeline
"""

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from unittest import TestCase, main

# Add parent dir to path so we can import instinct_extractor
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import instinct_extractor
from instinct_extractor import (
    Pattern,
    SkillCandidate,
    ReviewItem,
    PatternExtractor,
    SkillCandidateGenerator,
    ReviewQueue,
    run_extraction,
    load_sessions,
    save_extracted_instincts,
    _make_id,
    _slugify,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(job_name, content):
    """Create a minimal session dict for testing."""
    return {
        "job_id": "test-job",
        "filename": "2026-06-14_00-00-00.md",
        "run_time": "2026-06-14 00:00:00",
        "content": content,
        "job_name": job_name,
    }


def _session_dir_with_content(texts: list[tuple[str, str]]) -> Path:
    """Create a temp directory with session subdirs and files."""
    d = Path(tempfile.mkdtemp())
    job_ids_seen = set()
    for job_name, content in texts:
        job_id = job_name[:8].replace(" ", "")
        if job_id in job_ids_seen:
            job_id = f"{job_id}_{len(job_ids_seen)}"
        job_ids_seen.add(job_id)
        run_dir = d / job_id
        run_dir.mkdir(parents=True, exist_ok=True)
        md_file = run_dir / f"2026-06-14_00-00-00.md"
        md_file.write_text(content)
    return d


# ---------------------------------------------------------------------------
# AC 1: Pattern detection accuracy
# ---------------------------------------------------------------------------

class TestPatternDetection(TestCase):
    """Test that patterns are correctly detected from sessions."""

    def test_detect_cron_job_pattern(self):
        """Each session should yield a cron-job pattern."""
        sessions = [
            _make_session("linear-reconcile", "# Cron Job: linear-reconcile\n\n=== linear-reconcile APPLY ===\n"),
            _make_session("linear-reconcile", "# Cron Job: linear-reconcile\n\n=== linear-reconcile APPLY ===\n"),
            _make_session("session-health", "# Cron Job: session-health\n\n=== session-health APPLY ===\n"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        cron_patterns = [p for p in patterns if p.category == "cron-job"]
        # Should have at least the "linear-reconcile" pattern with 2 occurrences
        lr_patterns = [p for p in cron_patterns if "linear-reconcile" in p.description.lower()]
        self.assertGreaterEqual(len(lr_patterns), 1)
        self.assertEqual(lr_patterns[0].occurrences, 2)

    def test_detect_tool_use_pattern(self):
        """Tool usage patterns should be detected."""
        sessions = [
            _make_session("test", "Called mcp_linear_list_issues and mcp_linear_get_issue"),
            _make_session("test", "Called mcp_linear_list_issues and mcp_linear_save_issue"),
            _make_session("test", "Used mcp_linear_list_issues to find issues"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        tool_patterns = [p for p in patterns if p.category == "tool-use"]
        list_issues_patterns = [p for p in tool_patterns if "mcp_linear_list_issues" in p.description.lower()]
        self.assertGreaterEqual(len(list_issues_patterns), 1)
        self.assertEqual(list_issues_patterns[0].occurrences, 3)

    def test_detect_pitfall_pattern(self):
        """Pitfall patterns should be detected."""
        sessions = [
            _make_session("test", "Always call list_issue_labels before applying labels"),
            _make_session("test", "Must call list_teams first when creating issues"),
            _make_session("test", "Do NOT retry within the cooldown window"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        pitfall_patterns = [p for p in patterns if p.category == "pitfall"]
        self.assertGreater(len(pitfall_patterns), 0)

    def test_detect_linear_state_correction(self):
        """Linear state corrections should be detected."""
        sessions = [
            _make_session("test", "STATE LAT-289  Backlog -> In Progress"),
            _make_session("test", "Linear state corrections (1) -- STATE LAT-100  In Progress -> In Review"),
            _make_session("test", "Linear state corrections (2) -- STATE LAT-200  Backlog -> In Progress"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        state_patterns = [p for p in patterns if p.category == "linear-state-correction"]
        self.assertGreater(len(state_patterns), 0)
        # Combined occurrences should be >= 3
        total = sum(p.occurrences for p in state_patterns)
        self.assertGreaterEqual(total, 3)

    def test_detect_agent_dispatch_pattern(self):
        """Agent dispatch patterns should be detected."""
        sessions = [
            _make_session("test", "4 agents dispatched (LAT-308, LAT-289, LAT-296, LAT-291)"),
            _make_session("test", "3 agents dispatched (LAT-100, LAT-101, LAT-102)"),
            _make_session("test", "Dispatch Report: 4 agents dispatched"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        dispatch_patterns = [p for p in patterns if p.category == "agent-dispatch"]
        self.assertGreater(len(dispatch_patterns), 0)

    def test_no_false_positives_empty_sessions(self):
        """Empty sessions should produce no patterns above threshold."""
        sessions = [
            _make_session("empty", "# Cron Job: empty\n\nNo content here.\n"),
            _make_session("empty2", "# Cron Job: empty\n\nNothing to see.\n"),
        ]
        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        # With only 2 sessions and no repetition, nothing should hit threshold=3
        above_threshold = [p for p in patterns if p.passes_threshold]
        self.assertEqual(len(above_threshold), 0)


# ---------------------------------------------------------------------------
# AC 2: Confidence scoring
# ---------------------------------------------------------------------------

class TestConfidenceScoring(TestCase):
    """Test confidence scoring follows the threshold >= 3 rule."""

    def test_single_occurrence_low_confidence(self):
        """1 occurrence should have confidence 0.15."""
        conf = PatternExtractor._compute_confidence(1)
        self.assertAlmostEqual(conf, 0.15, places=2)

    def test_threshold_occurrence(self):
        """3 occurrences should have confidence >= 0.5."""
        conf = PatternExtractor._compute_confidence(3)
        self.assertGreaterEqual(conf, 0.5)
        self.assertLessEqual(conf, 1.0)

    def test_high_occurrence_high_confidence(self):
        """10+ occurrences should have confidence >= 0.9."""
        conf = conf_high = PatternExtractor._compute_confidence(10)
        self.assertGreaterEqual(conf_high, 0.9)

    def test_max_confidence_capped(self):
        """Very high occurrences should cap at 1.0."""
        conf = PatternExtractor._compute_confidence(50)
        self.assertAlmostEqual(conf, 1.0, places=2)

    def test_zero_occurrences(self):
        """0 occurrences should have 0 confidence."""
        conf = PatternExtractor._compute_confidence(0)
        self.assertAlmostEqual(conf, 0.0, places=2)

    def test_threshold_property(self):
        """passes_threshold should return True for >= 3, False otherwise."""
        p_low = Pattern(
            pattern_id="test", category="test", description="low",
            occurrences=2, confidence=0.3, examples=["ex"],
        )
        self.assertFalse(p_low.passes_threshold)

        p_thresh = Pattern(
            pattern_id="test", category="test", description="thresh",
            occurrences=3, confidence=0.5, examples=["ex"],
        )
        self.assertTrue(p_thresh.passes_threshold)

        p_high = Pattern(
            pattern_id="test", category="test", description="high",
            occurrences=10, confidence=0.9, examples=["ex"],
        )
        self.assertTrue(p_high.passes_threshold)


# ---------------------------------------------------------------------------
# AC 3: Skill candidate generation
# ---------------------------------------------------------------------------

class TestSkillCandidateGeneration(TestCase):
    """Test that SKILL.md format candidates are generated correctly."""

    def _make_pattern(self, category, description, occurrences=5, examples=None):
        if examples is None:
            examples = ["test session example"]
        return Pattern(
            pattern_id=_make_id(f"{category}:{description}"),
            category=category,
            description=description,
            occurrences=occurrences,
            confidence=PatternExtractor._compute_confidence(occurrences),
            examples=examples,
        )

    def test_generates_valid_skill_md_format(self):
        """Generated skills should have proper YAML frontmatter and structure."""
        pattern = self._make_pattern("cron-job", "session-health Cron Handler")
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertEqual(len(candidates), 1)
        skill = candidates[0]
        lines = skill.content.split("\n")

        # YAML frontmatter
        self.assertEqual(lines[0], "---")
        self.assertTrue(any(line.startswith("name:") for line in lines[:15]))
        self.assertTrue(any(line.startswith("description:") for line in lines[:15]))
        self.assertTrue(any(line.startswith("version:") for line in lines[:15]))
        self.assertTrue(any(line.startswith("author:") for line in lines[:15]))
        # Find the closing --- of frontmatter (could be at different line depending on description length)
        frontmatter_end_found = False
        for i in range(1, len(lines)):
            if lines[i] == "---":
                frontmatter_end_found = True
                break
        self.assertTrue(frontmatter_end_found, "YAML frontmatter closing '---' not found")

        # Title present
        self.assertTrue(any(line.startswith("# ") for line in lines))

    def test_skill_has_overview_section(self):
        """Every skill should have an Overview section."""
        pattern = self._make_pattern("tool-use", "mcp_linear_list_issues Usage Pattern")
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertTrue("## Overview" in candidates[0].content)

    def test_skill_has_workflow_section(self):
        """Every skill should have a Workflow section."""
        pattern = self._make_pattern("tool-use", "mcp_linear_list_issues Usage Pattern")
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertTrue("## Workflow" in candidates[0].content)

    def test_skill_has_pitfalls_section(self):
        """Every skill should have a Pitfalls section."""
        pattern = self._make_pattern("tool-use", "mcp_linear_list_issues Usage Pattern")
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertTrue("## Pitfalls" in candidates[0].content)

    def test_multiple_patterns_generate_multiple_candidates(self):
        """Different patterns should generate different skill candidates."""
        patterns = [
            self._make_pattern("cron-job", "session-health Cron Handler"),
            self._make_pattern("linear-state-correction", "Linear State Correction"),
            self._make_pattern("agent-dispatch", "Multi-Agent Dispatch"),
        ]
        generator = SkillCandidateGenerator(patterns)
        candidates = generator.generate_candidates()

        self.assertEqual(len(candidates), 3)
        names = [c.name for c in candidates]
        self.assertEqual(len(names), len(set(names)), "All skill names should be unique")

    def test_skill_status_default_pending_review(self):
        """New skill candidates should have pending_review status."""
        pattern = self._make_pattern("tool-use", "test")
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertEqual(candidates[0].status, "pending_review")

    def test_skill_content_includes_confidence(self):
        """Generated skills should include confidence in content."""
        pattern = self._make_pattern("tool-use", "test", occurrences=5)
        generator = SkillCandidateGenerator([pattern])
        candidates = generator.generate_candidates()

        self.assertIn("confidence", candidates[0].content.lower())
        self.assertIn(str(int(pattern.confidence * 100)), candidates[0].content)


# ---------------------------------------------------------------------------
# AC 4: Human review queue
# ---------------------------------------------------------------------------

class TestReviewQueue(TestCase):
    """Test the SQLite-backed review queue."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.db_path = self.tmpdir / "test_review_queue.db"
        self.queue = ReviewQueue(db_path=self.db_path)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_add_candidates_to_queue(self):
        """Candidates should be added to the review queue."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )
        items = self.queue.add_candidates([candidate])

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].skill_name, "test-skill")
        self.assertEqual(items[0].status, "pending")

    def test_get_pending_returns_pending_items(self):
        """get_pending should only return pending items."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )
        self.queue.add_candidates([candidate])

        pending = self.queue.get_pending()
        self.assertEqual(len(pending), 1)

    def test_approve_item(self):
        """Approving an item should change its status."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )
        items = self.queue.add_candidates([candidate])
        item = items[0]

        result = self.queue.approve(item.id, reviewer="herman", notes="Looks good")

        self.assertTrue(result)
        pending = self.queue.get_pending()
        self.assertEqual(len(pending), 0)

        all_items = self.queue.get_all()
        self.assertEqual(all_items[0].status, "approved")

    def test_reject_item(self):
        """Rejecting an item should change its status."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )
        items = self.queue.add_candidates([candidate])
        item = items[0]

        result = self.queue.reject(item.id, reviewer="herman", notes="Not useful")

        self.assertTrue(result)
        pending = self.queue.get_pending()
        self.assertEqual(len(pending), 0)

        all_items = self.queue.get_all()
        self.assertEqual(all_items[0].status, "rejected")

    def test_review_history_recorded(self):
        """Approving/rejecting should record history."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )
        items = self.queue.add_candidates([candidate])
        item = items[0]

        self.queue.approve(item.id, reviewer="herman", notes="Approved")

        with sqlite3.connect(str(self.db_path)) as conn:
            rows = conn.execute(
                "SELECT action, reviewer, notes FROM review_history"
            ).fetchall()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "approved")
        self.assertEqual(rows[0][1], "herman")

    def test_review_queue_persists_across_instances(self):
        """Queue data should persist across ReviewQueue instances (same DB)."""
        pattern = Pattern(
            pattern_id="test-pid", category="test", description="test desc",
            occurrences=5, confidence=0.7, examples=["ex"],
        )
        candidate = SkillCandidate(
            title="Test Skill", name="test-skill", description="test desc",
            category="test", content="content", source_pattern=pattern,
            confidence=0.7, status="pending_review",
        )

        # Add via first instance
        queue1 = ReviewQueue(db_path=self.db_path)
        queue1.add_candidates([candidate])

        # Retrieve via second instance
        queue2 = ReviewQueue(db_path=self.db_path)
        pending = queue2.get_pending()
        self.assertEqual(len(pending), 1)


# ---------------------------------------------------------------------------
# AC 5: End-to-end pipeline
# ---------------------------------------------------------------------------

class TestEndToEnd(TestCase):
    """Test the full extraction pipeline."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.session_dir = self.tmpdir / "sessions"
        self.db_path = self.tmpdir / "review.db"
        self.log_path = self.tmpdir / "instincts.json"

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_pipeline(self):
        """End-to-end: sessions → patterns → candidates → review queue."""
        # Create 5 identical sessions to trigger threshold=3
        for i in range(5):
            run_dir = self.session_dir / f"job_{i:03d}"
            run_dir.mkdir(parents=True, exist_ok=True)
            run_dir.joinpath(f"2026-06-14_00-00-0{i}.md").write_text(
                "# Cron Job: linear-reconcile\n\n"
                "=== linear-reconcile APPLY ===\n"
                "STATE LAT-289  Backlog -> In Progress\n"
                "Worktrees cleaned (1) -- CLEAN worktree test\n"
                "Stalled In-Progress (3) -- LAT-152\n"
            )

        result = run_extraction(
            session_dir=self.session_dir,
            review_db=self.db_path,
            instinct_log=self.log_path,
        )

        # All ACs should be satisfied
        # AC 1: patterns detected
        self.assertGreater(len(result["patterns"]), 0)

        # AC 2: patterns scored with confidence
        for p in result["patterns"]:
            self.assertGreater(p.confidence, 0.0)

        # AC 3: skill candidates generated
        self.assertGreater(len(result["candidates"]), 0)
        for c in result["candidates"]:
            self.assertIn("---", c.content)  # YAML frontmatter
            self.assertIn("## Overview", c.content)
            self.assertIn("## Workflow", c.content)
            self.assertIn("## Pitfalls", c.content)

        # AC 4: review queue populated
        self.assertGreater(len(result["review_items"]), 0)
        for item in result["review_items"]:
            self.assertEqual(item.status, "pending")

        # AC 5: log saved
        self.assertTrue(self.log_path.exists())
        log_data = json.loads(self.log_path.read_text())
        self.assertIn("patterns", log_data)
        self.assertIn("extracted_at", log_data)

    def test_pipeline_filters_below_threshold(self):
        """Only patterns with >= 3 occurrences should be candidates."""
        # Create 2 sessions (below threshold)
        for i in range(2):
            run_dir = self.session_dir / f"job_{i:03d}"
            run_dir.mkdir(parents=True, exist_ok=True)
            run_dir.joinpath(f"2026-06-14_00-00-0{i}.md").write_text(
                "# Cron Job: test-job\n\n"
                "mcp_linear_list_issues was called\n"
            )

        result = run_extraction(
            session_dir=self.session_dir,
            review_db=self.db_path,
            instinct_log=self.log_path,
            min_occurrences=3,
        )

        for p in result["patterns"]:
            self.assertGreaterEqual(p.occurrences, 3)

    def test_load_sessions_from_real_dir(self):
        """load_sessions should load from actual session directory."""
        sessions = load_sessions(Path.home() / ".hermes" / "cron" / "output")
        self.assertGreater(len(sessions), 0)
        for s in sessions:
            self.assertIn("job_id", s)
            self.assertIn("filename", s)
            self.assertIn("content", s)
            self.assertIn("job_name", s)

    def test_save_and_load_instincts_log(self):
        """instincts_extracted.json should be valid JSON with expected structure."""
        patterns = [
            Pattern(
                pattern_id="test", category="test", description="test desc",
                occurrences=5, confidence=0.7, examples=["ex"],
            ),
        ]
        path = save_extracted_instincts(patterns, self.log_path)

        data = json.loads(path.read_text())
        self.assertIn("extracted_at", data)
        self.assertIn("total_patterns", data)
        self.assertIn("patterns", data)
        self.assertEqual(data["total_patterns"], 1)


# ---------------------------------------------------------------------------
# Utility function tests
# ---------------------------------------------------------------------------

class TestUtilityFunctions(TestCase):
    """Test helper functions."""

    def test_make_id_deterministic(self):
        """Same input should produce same ID."""
        id1 = _make_id("test-pattern")
        id2 = _make_id("test-pattern")
        self.assertEqual(id1, id2)

    def test_make_id_different_for_different_inputs(self):
        """Different inputs should produce different IDs."""
        id1 = _make_id("pattern-a")
        id2 = _make_id("pattern-b")
        self.assertNotEqual(id1, id2)

    def test_slugify_basic(self):
        """Slugify should produce lowercase, hyphenated strings."""
        self.assertEqual(_slugify("Test Pattern"), "test-pattern")
        self.assertEqual(_slugify("Some Long Name"), "some-long-name")

    def test_slugify_handles_special_chars(self):
        """Slugify should strip special characters."""
        self.assertEqual(_slugify("Test/Pattern!"), "test-pattern")
        self.assertEqual(_slugify("  spaced  "), "spaced")

    def test_session_summary_includes_job_name(self):
        """_session_summary should include job name and filename."""
        session = _make_session("test-job", "# Cron Job: test-job\n\nsome content")
        summary = PatternExtractor._session_summary(session)
        self.assertIn("test-job", summary)
        self.assertIn("2026-06-14_00-00-00.md", summary)


if __name__ == "__main__":
    main()
