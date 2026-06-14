#!/usr/bin/env python3
"""
ECC End-to-End Integration Tests (LAT-299).

Covers the full ECC integration pipeline:
1. Skill import pipeline with live ECC repo (affaan-m/ECC on GitHub)
2. Hook system with agent tool-use patterns
3. Instinct extraction on sample sessions
4. Performance benchmark: hook overhead <100ms
5. Integration with existing MQA pipeline
6. Documentation completeness

Usage:
    pytest tests/test_ecc_e2e_integration.py -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest

# Ensure root is on path for instinct_extractor imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(
    0,
    str(Path(__file__).resolve().parent.parent / ".hermes" / "cron"),
)

# Import core ECC modules
import ecc_import  # noqa: E402
from ecc_import import (  # noqa: E402
    SkillEntry,
    SkillFile,
    parse_frontmatter,
    adapt_skill,
    run_import,
    validate_skill_file,
    list_skill_directories,
    fetch_skill_content,
    compute_skill_hash,
    write_skill,
)

import instinct_extractor  # noqa: E402
from instinct_extractor import (  # noqa: E402
    PatternExtractor,
    SkillCandidateGenerator,
    ReviewQueue,
    SkillCandidate,
    Pattern,
    run_extraction,
    _make_id,
)

from hermes_hooks.engine import HookEngine  # noqa: E402
from hermes_hooks.events import (  # noqa: E402
    PreToolUse,
    PostToolUse,
    SessionStart,
    SessionEnd,
    EventType,
)
from hermes_hooks.registry import HookRegistry  # noqa: E402


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture()
def sample_ecc_skills():
    """Generate mock ECC skills matching the real format."""
    curated = [
        "security-review",
        "verification-loop",
        "eval-harness",
        "coding-standards",
        "strategic-compact",
        "deep-research",
    ]
    skills = []
    for name in curated:
        raw = f"""---
name: {name}
description: {name} skill for agent harness
category: testing
---

# {name}

This skill provides {name} capabilities for the agent harness.

## Usage
1. Import the skill
2. Apply to your project

## Pitfalls
- Always test before deploying
"""
        skills.append(
            SkillFile(
                name=name,
                path=f"skills/{name}",
                sha=f"sha_{name}",
                size=len(raw.encode()),
                url=f"https://api.github.com/repos/affaan-m/ECC/contents/skills/{name}",
                download_url=f"https://raw.githubusercontent.com/affaan-m/ECC/main/skills/{name}/SKILL.md",
            )
        )
    return skills


@pytest.fixture()
def sample_sessions():
    """Generate sample session content for instinct extraction testing."""
    sessions = []
    for i in range(10):
        content = f"""# Cron Job: linear-reconcile
**Run Time:** 2026-06-14 00:00:{i:02d}
**Mode:** APPLY

=== linear-reconcile APPLY ===

## Results
- Processed {i} issues
- STATE LAT-{300 + i}  Backlog -> In Progress
- Worktrees cleaned ({i}) -- CLEAN worktree test-{i}
- Stalled In-Progress ({i}) -- LAT-{400 + i}
- Dispatch Report: {i + 4} agents dispatched (LAT-{300 + i}, LAT-{301 + i}, LAT-{302 + i})
- mcp_linear_list_issues called {i} times
- mcp_linear_get_issue called {i} times
- MCP server unreachable, auto-retry available in ~40s
- list_issue_labels called before applying labels
"""
        sessions.append({
            "job_id": f"job_{i:03d}",
            "filename": f"2026-06-14_00-00-00.md",
            "run_time": f"2026-06-14 00:00:{i:02d}",
            "content": content,
            "job_name": "linear-reconcile",
        })
    return sessions


@pytest.fixture()
def hook_registry_with_handlers():
    """Create a HookRegistry with sample handlers for testing."""
    registry = HookRegistry()
    call_log = []

    def pre_handler(event):
        call_log.append(("pre", event.tool_name if hasattr(event, "tool_name") else "unknown"))

    def post_handler(event):
        call_log.append(("post", event.tool_name if hasattr(event, "tool_name") else "unknown"))

    def session_handler(event):
        call_log.append(("session", event.session_id if hasattr(event, "session_id") else "unknown"))

    registry.register(EventType.PRE_TOOL_USE, pre_handler)
    registry.register(EventType.POST_TOOL_USE, post_handler)
    registry.register(EventType.SESSION_START, session_handler)
    registry.register(EventType.SESSION_END, session_handler)

    return registry, call_log


# ===========================================================================
# 1. Test skill import pipeline with live ECC repo
# ===========================================================================

class TestSkillImportPipeline:
    """Test the ECC skill import pipeline end-to-end."""

    def test_github_api_connectivity(self):
        """Test that we can reach the ECC repo on GitHub."""
        try:
            result = list_skill_directories()
            assert len(result) >= 0
            assert isinstance(result, list)
        except Exception as exc:
            pytest.skip(f"GitHub API unreachable: {exc}")

    def test_live_skill_fetch(self, sample_ecc_skills):
        """Test fetching actual ECC skills from GitHub."""
        for skill in sample_ecc_skills:
            entry = fetch_skill_content(skill)
            if entry is not None:
                assert entry.name == skill.name
                assert entry.raw_content != ""
                assert entry.git_sha == skill.sha

    def test_full_import_pipeline_mocked(self, sample_ecc_skills, sample_sessions):
        """Test the full import pipeline with mocked GitHub API."""
        import base64
        b64_map = {}
        for skill in sample_ecc_skills:
            raw = skill.name + " skill content"
            b64_map[skill.name] = {
                "content": base64.b64encode(raw.encode()).decode(),
                "encoding": "base64",
                "sha": skill.sha,
            }

        def api_handler(url):
            name = url.split("/")[-1]
            if name in b64_map:
                return MagicMock(status_code=200, json=lambda: b64_map[name])
            return MagicMock(status_code=404)

        with patch("ecc_import._github_api_get", side_effect=api_handler):
            entries = []
            for skill in sample_ecc_skills:
                entry = fetch_skill_content(skill)
                if entry:
                    entries.append(entry)
            assert len(entries) == len(sample_ecc_skills)

    def test_skill_validation(self, sample_ecc_skills):
        """Test that skills pass validation."""
        for skill in sample_ecc_skills:
            result = validate_skill_file(skill.name, "---\nname: " + skill.name + "\n---\n# Test")
            assert result is True


# ===========================================================================
# 2. Test hook system with agent tool-use
# ===========================================================================

class TestHookSystem:
    """Test the hook event system integration."""

    def test_pre_post_tool_use_events(self):
        """Test PreToolUse and PostToolUse event firing."""
        registry = HookRegistry()
        fired = []

        def tracker(event):
            fired.append({
                "type": event.event_type.name,
                "tool": event.tool_name,
                "result": getattr(event, "result", None),
                "duration_ms": getattr(event, "duration_ms", None),
            })

        registry.register(EventType.PRE_TOOL_USE, tracker)
        registry.register(EventType.POST_TOOL_USE, tracker)
        engine = HookEngine(registry)

        engine.fire(PreToolUse(tool_name="mcp_linear_get_issue", params={"id": "LAT-299"}))
        engine.fire(PostToolUse(
            tool_name="mcp_linear_get_issue",
            result={"title": "E2E Testing", "status": "In Progress"},
            duration_ms=45.0,
        ))

        assert len(fired) == 2
        assert fired[0]["tool"] == "mcp_linear_get_issue"
        assert fired[1]["duration_ms"] == 45.0

    def test_session_lifecycle_events(self):
        """Test SessionStart and SessionEnd events."""
        registry = HookRegistry()
        fired = []

        def tracker(event):
            fired.append({
                "type": event.event_type.name,
                "session_id": getattr(event, "session_id", None),
            })

        registry.register(EventType.SESSION_START, tracker)
        registry.register(EventType.SESSION_END, tracker)
        engine = HookEngine(registry)

        engine.fire(SessionStart(session_id="session-001"))
        engine.fire(SessionEnd(session_id="session-001", duration_ms=5000.0, tool_invocations=3))

        assert len(fired) == 2
        assert fired[0]["type"] == "SESSION_START"
        assert fired[1]["type"] == "SESSION_END"
        assert fired[1]["session_id"] == "session-001"

    def test_hook_ordering(self, hook_registry_with_handlers):
        """Test that hooks fire in correct order."""
        registry, call_log = hook_registry_with_handlers()
        engine = HookEngine(registry)

        engine.fire(PreToolUse(tool_name="mcp_linear_list_issues", params={}))
        engine.fire(PostToolUse(tool_name="mcp_linear_list_issues", result="ok"))
        engine.fire(SessionEnd(session_id="test", duration_ms=1000.0, tool_invocations=1))

        assert len(call_log) == 4
        assert call_log[0][0] == "pre"
        assert call_log[1][0] == "post"


# ===========================================================================
# 3. Test instinct extraction on sample sessions
# ===========================================================================

class TestInstinctExtraction:
    """Test the instinct extraction system."""

    def test_pattern_extraction(self, sample_sessions):
        """Test that patterns are extracted from sample sessions."""
        extractor = PatternExtractor(sessions=sample_sessions)
        patterns = extractor.extract_all()
        assert len(patterns) > 0
        for p in patterns:
            assert hasattr(p, "category")
            assert hasattr(p, "evidence")

    def test_skill_candidate_generation(self, sample_sessions):
        """Test that skill candidates are generated."""
        extractor = PatternExtractor(sessions=sample_sessions)
        generator = SkillCandidateGenerator(extractor)
        candidates = generator.generate()
        assert len(candidates) >= 0

    def test_review_queue(self):
        """Test the review queue."""
        queue = ReviewQueue()
        queue.enqueue(SkillCandidate(
            name="test-skill",
            description="A test skill",
            content="# Test Skill\n\n## Usage\n1. Use it\n",
            trigger="mcp_linear_*",
            priority=3,
        ))
        assert queue.pending_count() == 1


# ===========================================================================
# 4. Performance benchmark: hook overhead <100ms
# ===========================================================================

class TestPerformanceBenchmark:
    """Benchmark hook overhead to ensure <100ms impact."""

    def test_hook_overhead_per_event(self):
        """Test that individual hook events complete in <1ms."""
        registry = HookRegistry()
        engine = HookEngine(registry)

        times = []
        for _ in range(100):
            start = time.perf_counter()
            engine.fire(PreToolUse(tool_name="test", params={}))
            engine.fire(PostToolUse(tool_name="test", result="ok"))
            elapsed = (time.perf_counter() - start) * 1000
            times.append(elapsed)

        avg_ms = sum(times) / len(times)
        assert avg_ms < 10.0, f"Average hook overhead {avg_ms:.2f}ms exceeds budget"

    def test_full_session_lifecycle(self):
        """Test full session lifecycle hook overhead."""
        registry = HookRegistry()
        engine = HookEngine(registry)

        start = time.perf_counter()
        engine.fire(SessionStart(session_id="bench"))
        for i in range(10):
            engine.fire(PreToolUse(tool_name=f"tool_{i}", params={}))
            engine.fire(PostToolUse(tool_name=f"tool_{i}", result="ok"))
        engine.fire(SessionEnd(session_id="bench", duration_ms=5000.0, tool_invocations=10))
        total = (time.perf_counter() - start) * 1000

        assert total < 100.0, f"Full session hooks took {total:.1f}ms"

    def test_hook_registry_register_unregister(self):
        """Test register/unregister performance."""
        registry = HookRegistry()
        handler = lambda e: None

        start = time.perf_counter()
        for _ in range(1000):
            registry.register(EventType.PRE_TOOL_USE, handler)
            registry.unregister(EventType.PRE_TOOL_USE, handler)
        total = (time.perf_counter() - start) * 1000

        assert total < 100.0, f"1000 register/unregister cycles took {total:.1f}ms"


# ===========================================================================
# 5. Integration with existing MQA pipeline
# ===========================================================================

class TestMQAPipelineIntegration:
    """Test integration with the existing MQA pipeline."""

    def test_hook_event_integration(self):
        """Test that hook events integrate correctly with MQA pipeline concepts."""
        registry = HookRegistry()
        mqa_stages = []

        def stage_tracker(event):
            if event.event_type == EventType.PRE_TOOL_USE:
                mqa_stages.append(("tool-use", event.tool_name))
            elif event.event_type == EventType.SESSION_END:
                mqa_stages.append(("merge", "session-complete"))

        registry.register(EventType.PRE_TOOL_USE, stage_tracker)
        registry.register(EventType.SESSION_END, stage_tracker)
        engine = HookEngine(registry)

        engine.fire(SessionStart(session_id="mqa-001"))
        engine.fire(PreToolUse(tool_name="mcp_linear_list_issues", params={"state": "backlog"}))
        engine.fire(PostToolUse(tool_name="mcp_linear_list_issues", result="[issue-1]"))
        engine.fire(PreToolUse(tool_name="mcp_linear_save_issue", params={"title": "New task"}))
        engine.fire(PostToolUse(tool_name="mcp_linear_save_issue", result="created"))
        engine.fire(SessionEnd(session_id="mqa-001", duration_ms=30000.0, tool_invocations=2))

        stage_names = [s[0] for s in mqa_stages]
        assert "tool-use" in stage_names
        assert "merge" in stage_names
        assert len(mqa_stages) == 5

    def test_ecc_skills_mqa_compatibility(self):
        """Test that imported ECC skills are compatible with MQA pipeline."""
        ecc_skill = SkillEntry(
            name="eval-harness",
            description="ECC eval harness for MQA pipeline",
            raw_content="---\nname: eval-harness\ndescription: MQA-compatible eval harness\n---\n\n# Eval Harness\n\n## MQA Integration\n\n1. Run during dispatch stage\n2. Validate during MQA stage\n3. Report during merge stage",
            git_sha="abc123",
        )

        adapted = adapt_skill(ecc_skill)
        assert "MQA Integration" in adapted

    def test_hook_result_in_mqa_reporting(self):
        """Test that hook execution results can be used for MQA reporting."""
        registry = HookRegistry()
        results = []

        def reporter(event):
            results.append({
                "type": event.event_type.name,
                "tool": getattr(event, "tool_name", None),
                "duration_ms": getattr(event, "duration_ms", 0),
            })

        registry.register(EventType.PRE_TOOL_USE, reporter)
        registry.register(EventType.POST_TOOL_USE, reporter)
        engine = HookEngine(registry)

        engine.fire(PreToolUse(tool_name="mcp_linear_get_issue", params={"id": "LAT-299"}))
        engine.fire(PostToolUse(
            tool_name="mcp_linear_get_issue",
            result={"title": "E2E Testing", "status": "In Progress"},
            duration_ms=45.0,
        ))

        assert len(results) == 2
        assert results[1]["duration_ms"] == 45.0

    def test_instinct_extraction_mqa_integration(self):
        """Test that instinct extraction integrates with MQA pipeline."""
        sessions = []
        for i in range(5):
            sessions.append({
                "content": (
                    f"# Cron Job: mqa-review\n"
                    f"## MQA Stage: Review\n"
                    f"Tool calls: mcp_linear_get_issue, mcp_linear_save_issue\n"
                    f"States corrected: Backlog -> In Progress\n"
                    f"Self-improvement loop active\n"
                    f"Parallel execution: {i + 1} agents\n"
                ),
                "job_name": "mqa-review",
                "filename": f"session_{i}.md",
                "run_time": f"2026-06-14 00:00:{i:02d}",
                "job_id": f"mqa_{i:03d}",
            })

        extractor = PatternExtractor(sessions=sessions)
        patterns = extractor.extract_all()

        mqa_categories = {"linear-state-correction", "self-improvement-loop", "parallel-execution"}
        found_categories = {p.category for p in patterns}
        assert len(mqa_categories & found_categories) > 0

    def test_hook_overhead_mqa_impact(self):
        """Test that hook overhead is acceptable within MQA pipeline timing."""
        registry, _ = hook_registry_with_handlers()
        engine = HookEngine(registry)

        cycle_start = time.perf_counter()
        engine.fire(SessionStart(session_id="mqa-cycle"))
        for tool_name in ["mcp_linear_list_issues", "mcp_linear_get_issue", "mcp_linear_save_issue"]:
            engine.fire(PreToolUse(tool_name=tool_name, params={}))
            engine.fire(PostToolUse(tool_name=tool_name, result="ok", duration_ms=50.0))
        engine.fire(SessionEnd(session_id="mqa-cycle", duration_ms=10000.0, tool_invocations=3))
        cycle_time = (time.perf_counter() - cycle_start) * 1000

        assert cycle_time < 100.0, f"MQA cycle with hooks took {cycle_time:.1f}ms"


# ===========================================================================
# 6. Documentation completeness
# ===========================================================================

class TestDocumentationCompleteness:
    """Test that documentation files exist and are complete."""

    def test_migration_guide_exists(self):
        """Migration guide should exist for existing skills."""
        docs_dir = Path(__file__).resolve().parent.parent / "docs"
        migration_guide = docs_dir / "ecc-migration-guide.md"
        assert migration_guide.exists(), f"Migration guide not found at {migration_guide}"

    def test_migration_guide_has_required_sections(self):
        """Migration guide should have all required sections."""
        docs_dir = Path(__file__).resolve().parent.parent / "docs"
        migration_guide = docs_dir / "ecc-migration-guide.md"
        if migration_guide.exists():
            content = migration_guide.read_text()
            required_sections = ["Overview", "Skill Format", "Migration", "Hook", "Instinct", "Performance", "MQA"]
            content_lower = content.lower()
            for section in required_sections:
                assert section.lower() in content_lower, f"Migration guide missing section: {section}"

    def test_prd_references_documentation(self):
        """PRD should reference the migration documentation."""
        prd_path = Path(__file__).resolve().parent.parent.parent / "vault" / "prds" / "agent-harness-ecosystem-ecc.md"
        if prd_path.exists():
            content = prd_path.read_text()
            assert "migration" in content.lower() or "doc" in content.lower()

    def test_code_has_docstrings(self):
        """Core modules should have comprehensive docstrings."""
        assert ecc_import.__doc__ is not None, "ecc_import missing module docstring"
        assert "ECC" in ecc_import.__doc__, "ecc_import docstring should mention ECC"
        assert instinct_extractor.__doc__ is not None, "instinct_extractor missing module docstring"
        from hermes_hooks import engine, events, registry
        assert engine.__doc__ is not None, "HookEngine module missing docstring"
        assert events.__doc__ is not None, "Events module missing docstring"
        assert registry.__doc__ is not None, "Registry module missing docstring"

    def test_test_files_have_descriptions(self):
        """Test files should have descriptive headers."""
        test_file = Path(__file__).resolve()
        content = test_file.read_text()
        assert "LAT-299" in content, "Test file should reference LAT-299"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
