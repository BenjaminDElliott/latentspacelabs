"""Tests for the ECC → Hermes migration adapter."""

from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ..parser import EccSkillFrontmatter, EccSkillFile
from ..adapter import (
    ImportedSkill,
    SkillMetadata,
    HermesFrontmatter,
    adapt_skill,
    map_category,
    extract_tags,
    is_idempotent,
)


def _make_ecc_skill(name: str, description: str, origin: str = "ECC") -> EccSkillFile:
    """Helper to create a minimal EccSkillFile for testing."""
    frontmatter = EccSkillFrontmatter(
        name=name,
        description=description,
        origin=origin,
        allowed_tools=None,
        source_hash="abc123",
        source_path=f"skills/{name}/SKILL.md",
    )
    content = f"# {name.title()}\n\nTest content for {name}."
    return EccSkillFile(
        frontmatter=frontmatter,
        content=content,
        raw=f"---\nname: {name}\ndescription: {description}\norigin: {origin}\n---\n\n{content}",
        path=frontmatter.source_path,
    )


class TestMapCategory:
    """Tests for category mapping."""

    def test_known_mapping_security_review(self):
        assert map_category("security-review") == "security"

    def test_known_mapping_coding_standards(self):
        assert map_category("coding-standards") == "engineering"

    def test_known_mapping_deep_research(self):
        assert map_category("deep-research") == "research"

    def test_known_mapping_strategic_compact(self):
        assert map_category("strategic-compact") == "operations"

    def test_unknown_default_engineering(self):
        assert map_category("obscure-unknown-skill") == "engineering"

    def test_known_mappings(self):
        """Test several known mappings."""
        assert map_category("tdd-workflow") == "engineering"
        assert map_category("verification-loop") == "engineering"
        assert map_category("eval-harness") == "engineering"
        assert map_category("backend-patterns") == "engineering"
        assert map_category("mcp-server-patterns") == "devops"
        assert map_category("hookify-rules") == "devops"
        assert map_category("brand-voice") == "content"
        assert map_category("continuous-learning") == "self-improvement"


class TestExtractTags:
    """Tests for tag extraction."""

    def test_includes_skill_name(self):
        tags = extract_tags("Some description", "security-review")
        assert "security-review" in tags

    def test_extracts_security_tag(self):
        tags = extract_tags("Security checklist for auth and password", "test")
        assert "security" in tags

    def test_extracts_testing_tag(self):
        tags = extract_tags("Unit and integration testing", "test")
        assert "testing" in tags

    def test_extracts_research_tag(self):
        tags = extract_tags("Deep web research and search", "test")
        assert "research" in tags


class TestAdaptSkill:
    """Tests for the main adaptation function."""

    def test_adapts_security_review(self):
        skill = _make_ecc_skill("security-review", "Security review patterns")
        adapted = adapt_skill(skill)

        assert adapted.name == "security-review"
        assert adapted.frontmatter.name == "security-review"
        assert adapted.frontmatter.author == "ecc"
        assert adapted.frontmatter.version == "1.0.0"
        assert adapted.frontmatter.category == "security"
        assert "security" in adapted.frontmatter.tags

    def test_strips_origin_field(self):
        skill = _make_ecc_skill("test", "Test", origin="ECC")
        adapted = adapt_skill(skill)

        # Should have author="ecc" but no origin field in Hermes frontmatter
        yaml = adapted.frontmatter.to_yaml()
        assert "origin" not in yaml
        assert "author: ecc" in yaml

    def test_adds_version_field(self):
        skill = _make_ecc_skill("test", "Test")
        adapted = adapt_skill(skill)

        assert adapted.frontmatter.version == "1.0.0"
        assert "version: 1.0.0" in adapted.frontmatter.to_yaml()

    def test_enhances_content_with_attribution(self):
        skill = _make_ecc_skill("test", "Test skill")
        adapted = adapt_skill(skill)

        assert "ECC (affaan-m/ECC)" in adapted.content
        assert "LAT-286" in adapted.content

    def test_preserves_source_attribution(self):
        skill = _make_ecc_skill(
            "test",
            "Test",
        )
        skill.content = "# Test\n\n**Source:** ECC (affaan-m/ECC)\ncontent"
        adapted = adapt_skill(skill)

        # Should not double-add attribution
        ecc_count = adapted.content.count("ECC (affaan-m/ECC)")
        assert ecc_count == 1, f"Attribution appears {ecc_count} times, expected 1"

    def test_output_format(self):
        skill = _make_ecc_skill("security-review", "Security patterns")
        adapted = adapt_skill(skill)

        md = adapted.to_markdown()
        assert md.startswith("---")
        assert "name: security-review" in md
        assert "author: ecc" in md
        assert "version: 1.0.0" in md
        assert "# Security Review" in md


class TestHermesFrontmatterYaml:
    """Tests for YAML serialization."""

    def test_basic_fields(self):
        fm = HermesFrontmatter(name="test", description="Test skill")
        yaml = fm.to_yaml()

        assert yaml.startswith("---")
        assert yaml.endswith("---")
        assert "name: test" in yaml
        assert "description: Test skill" in yaml

    def test_with_tags(self):
        fm = HermesFrontmatter(name="test", description="Test", tags=["security", "testing"])
        yaml = fm.to_yaml()

        assert "tags:" in yaml
        assert "security" in yaml

    def test_with_category(self):
        fm = HermesFrontmatter(name="test", description="Test", category="engineering")
        yaml = fm.to_yaml()

        assert "category: engineering" in yaml


class TestSkillMetadata:
    """Tests for metadata serialization."""

    def test_serializes_json(self):
        meta = SkillMetadata(
            name="test",
            version="1.0.0",
            category="engineering",
            source_hash="abc123",
        )
        json_str = meta.to_json()

        import json as _json
        data = _json.loads(json_str)
        assert data["name"] == "test"
        assert data["source_repo"] == "affaan-m/ECC"
        assert data["source_branch"] == "v2.0.0"
        assert data["adapter_version"] == "1.0.0"


class TestIsIdempotent:
    """Tests for idempotency check."""

    def test_returns_false_when_no_metadata(self, tmp_path):
        assert not is_idempotent("test", tmp_path / "ecc", adapter_version="1.0.0", source_hash="abc")

    def test_returns_true_when_same_hash_and_adapter(self, tmp_path):
        skill_dir = tmp_path / "ecc" / "test"
        skill_dir.mkdir()
        metadata_path = skill_dir / "METADATA.json"
        metadata_path.write_text('{"source_hash": "abc", "adapter_version": "1.0.0"}')

        assert is_idempotent("test", tmp_path / "ecc", adapter_version="1.0.0", source_hash="abc")

    def test_returns_false_when_adapter_changed(self, tmp_path):
        skill_dir = tmp_path / "ecc" / "test"
        skill_dir.mkdir()
        metadata_path = skill_dir / "METADATA.json"
        metadata_path.write_text('{"source_hash": "abc", "adapter_version": "0.9.0"}')

        assert not is_idempotent("test", tmp_path / "ecc", adapter_version="1.0.0", source_hash="abc")

    def test_returns_false_when_hash_changed(self, tmp_path):
        skill_dir = tmp_path / "ecc" / "test"
        skill_dir.mkdir()
        metadata_path = skill_dir / "METADATA.json"
        metadata_path.write_text('{"source_hash": "abc", "adapter_version": "1.0.0"}')

        assert not is_idempotent("test", tmp_path / "ecc", adapter_version="1.0.0", source_hash="def")
