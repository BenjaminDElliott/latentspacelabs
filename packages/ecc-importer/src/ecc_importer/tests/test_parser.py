"""Tests for the ECC SKILL.md parser."""

import pytest

from ..parser import EccSkillFrontmatter, EccSkillFile, parse_frontmatter, parse_skill_from_url


SAMPLE_ECC_SKILL = """---
name: security-review
description: Use this skill when adding authentication, handling user input, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns.
origin: ECC
---

# Security Review Skill

This skill ensures all code follows security best practices.

## When to Activate

- Implementing authentication or authorization
- Handling user input or file uploads
"""

SAMPLE_ECC_SKILL_WITH_TOOLS = """---
name: eval-harness
description: A formal evaluation framework for AI sessions.
origin: ECC
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Eval Harness

Evaluation framework description.
"""

SAMPLE_NO_FRONTOFFERM = """# Just a title
No frontmatter here.
"""


class TestParseFrontmatter:
    """Tests for parse_frontmatter function."""

    def test_parses_basic_ecc_frontmatter(self):
        """Should correctly parse name and description."""
        fm = parse_frontmatter(SAMPLE_ECC_SKILL)

        assert fm.name == "security-review"
        assert "authentication" in fm.description
        assert fm.origin == "ECC"
        assert fm.allowed_tools is None
        assert len(fm.source_hash) == 16

    def test_parses_allowed_tools(self):
        """Should parse comma-separated allowed-tools."""
        fm = parse_frontmatter(SAMPLE_ECC_SKILL_WITH_TOOLS)

        assert fm.name == "eval-harness"
        assert fm.allowed_tools == ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]

    def test_raises_on_missing_frontmatter(self):
        """Should raise ValueError when no YAML frontmatter."""
        with pytest.raises(ValueError, match="No YAML frontmatter"):
            parse_frontmatter(SAMPLE_NO_FRONTOFFERM)

    def test_raises_on_missing_name(self):
        """Should raise ValueError when name is missing."""
        no_name = """---
description: A skill without a name
---
content
"""
        with pytest.raises(ValueError, match="missing required field: name"):
            parse_frontmatter(no_name)

    def test_raises_on_missing_description(self):
        """Should raise ValueError when description is missing."""
        no_desc = """---
name: test-skill
---
content
"""
        with pytest.raises(ValueError, match="missing required field: description"):
            parse_frontmatter(no_desc)

    def test_hash_is_deterministic(self):
        """Hash should be deterministic for same content."""
        fm1 = parse_frontmatter(SAMPLE_ECC_SKILL)
        fm2 = parse_frontmatter(SAMPLE_ECC_SKILL)
        assert fm1.source_hash == fm2.source_hash

    def test_hash_differs_for_different_content(self):
        """Hash should differ for different content."""
        fm1 = parse_frontmatter(SAMPLE_ECC_SKILL)
        fm2 = parse_frontmatter("""---
name: different-name
description: Different description
origin: ECC
---
content
""")
        assert fm1.source_hash != fm2.source_hash


class TestParseSkillFromUrl:
    """Tests for parse_skill_from_url function."""

    def test_parses_full_skill(self):
        """Should return EccSkillFile with all fields."""
        skill = parse_skill_from_url(SAMPLE_ECC_SKILL, "skills/security-review/SKILL.md")

        assert skill.frontmatter.name == "security-review"
        assert skill.frontmatter.source_path == "skills/security-review/SKILL.md"
        assert "# Security Review Skill" in skill.content
        assert skill.path == "skills/security-review/SKILL.md"

    def test_extracts_content_after_frontmatter(self):
        """Should extract markdown content after the frontmatter block."""
        skill = parse_skill_from_url(SAMPLE_ECC_SKILL, "test/path")
        assert skill.content.startswith("# Security Review Skill")
        assert "---" not in skill.content
