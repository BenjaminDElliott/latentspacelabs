"""
Tests for ECC Skill Import Pipeline (LAT-295).

Covers:
1. Import verification - pipeline runs, skills are fetched, written, idempotent
2. Skill format validation - frontmatter, required fields, content integrity
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add parent directory to path so we can import ecc_import
sys.path.insert(
    0,
    str(Path(__file__).resolve().parent.parent / ".hermes" / "cron"),
)

import ecc_import  # noqa: E402


# ---------------------------------------------------------------------------
# Frontmatter parsing tests
# ---------------------------------------------------------------------------


class TestFrontmatterParsing(unittest.TestCase):
    """Test YAML frontmatter parser."""

    def test_parse_valid_frontmatter(self) -> None:
        text = "---\nname: test-skill\ndescription: A test\nversion: 1.0.0\n---\n\n# Body content\n"
        fields, body = ecc_import.parse_frontmatter(text)
        self.assertEqual(fields["name"], "test-skill")
        self.assertEqual(fields["description"], "A test")
        self.assertEqual(fields["version"], "1.0.0")
        self.assertEqual(body.strip(), "# Body content")

    def test_parse_no_frontmatter(self) -> None:
        text = "# Just a title\n\nNo frontmatter here."
        fields, body = ecc_import.parse_frontmatter(text)
        self.assertEqual(fields, {})
        self.assertEqual(body, text)

    def test_parse_empty_frontmatter(self) -> None:
        text = "---\n---\n\nBody after empty frontmatter.\n"
        fields, body = ecc_import.parse_frontmatter(text)
        self.assertEqual(fields, {})
        self.assertIn("Body after empty frontmatter", body)

    def test_serialize_frontmatter(self) -> None:
        fields = {"name": "test", "version": "2.0.0"}
        result = ecc_import.serialize_frontmatter(fields)
        self.assertIn("---", result)
        self.assertIn("name: test", result)
        self.assertIn("version: 2.0.0", result)
        self.assertIn("---", result)

    def test_roundtrip(self) -> None:
        """Serialize then parse should be consistent."""
        fields = {"name": "my-skill", "description": "Test desc"}
        fm = ecc_import.serialize_frontmatter(fields)
        parsed, _ = ecc_import.parse_frontmatter(fm + "\n\nbody")
        self.assertEqual(parsed["name"], "my-skill")
        self.assertEqual(parsed["description"], "Test desc")


# ---------------------------------------------------------------------------
# Skill format validation tests
# ---------------------------------------------------------------------------


class TestSkillValidation(unittest.TestCase):
    """Test SKILL.md validation."""

    def _write_tmp_skill(self, content: str) -> Path:
        """Helper to write a temporary SKILL.md file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, dir=tempfile.gettempdir()
        ) as f:
            f.write(content)
            return Path(f.name)

    def test_validate_valid_skill(self) -> None:
        content = """---
name: test
description: A test skill
---
# Test Skill

Some content.
"""
        path = self._write_tmp_skill(content)
        try:
            result = ecc_import.validate_skill_file(path)
            self.assertTrue(result.valid)
            self.assertEqual(result.name, path.name)
        finally:
            path.unlink()

    def test_validate_missing_name(self) -> None:
        content = """---
description: No name field
---
# Content
"""
        path = self._write_tmp_skill(content)
        try:
            result = ecc_import.validate_skill_file(path)
            self.assertFalse(result.valid)
            self.assertTrue(any("name" in e for e in result.errors))
        finally:
            path.unlink()

    def test_validate_missing_description(self) -> None:
        content = """---
name: test
---
# Content
"""
        path = self._write_tmp_skill(content)
        try:
            result = ecc_import.validate_skill_file(path)
            self.assertFalse(result.valid)
            self.assertTrue(any("description" in e for e in result.errors))
        finally:
            path.unlink()

    def test_validate_missing_frontmatter(self) -> None:
        path = self._write_tmp_skill("# Title\nNo frontmatter.")
        try:
            result = ecc_import.validate_skill_file(path)
            self.assertFalse(result.valid)
        finally:
            path.unlink()

    def test_validate_empty_body(self) -> None:
        content = "---\nname: test\ndescription: desc\n---\n"
        path = self._write_tmp_skill(content)
        try:
            result = ecc_import.validate_skill_file(path)
            self.assertFalse(result.valid)
        finally:
            path.unlink()

    def test_validate_nonexistent_file(self) -> None:
        result = ecc_import.validate_skill_file(Path("/tmp/does_not_exist_12345.md"))
        self.assertFalse(result.valid)
        self.assertTrue(any("exist" in e for e in result.errors))

    def test_validate_all_skills_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            results = ecc_import.validate_all_skills(Path(tmpdir))
            self.assertEqual(len(results), 0)


# ---------------------------------------------------------------------------
# GitHub API mock tests
# ---------------------------------------------------------------------------


class TestGitHubAPI(unittest.TestCase):
    """Test GitHub API interaction with mocked responses."""

    def test_list_skill_directories_parsing(self) -> None:
        mock_data = [
            {
                "type": "dir",
                "name": "security-review",
                "path": "skills/security-review",
                "sha": "abc123",
                "size": 0,
                "url": "https://api.github.com/repos/affaan-m/ECC/contents/skills/security-review",
                "download_url": "",
            },
            {
                "type": "file",
                "name": "readme.md",
                "path": "readme.md",
                "sha": "def456",
                "size": 100,
                "url": "https://api.github.com/repos/affaan-m/ECC/contents/readme.md",
                "download_url": "https://raw.githubusercontent.com/...",
            },
        ]
        with patch.object(ecc_import, "_api_request", return_value=mock_data):
            skills = ecc_import.list_skill_directories()
            self.assertEqual(len(skills), 1)
            self.assertEqual(skills[0].name, "security-review")

    def test_list_skill_directories_empty(self) -> None:
        with patch.object(ecc_import, "_api_request", return_value=[]):
            skills = ecc_import.list_skill_directories()
            self.assertEqual(len(skills), 0)

    def test_list_skill_directories_non_list(self) -> None:
        with patch.object(ecc_import, "_api_request", return_value={"error": "not found"}):
            skills = ecc_import.list_skill_directories()
            self.assertEqual(len(skills), 0)

    def test_fetch_skill_content(self) -> None:
        raw = "---\nname: test\ndescription: A test skill\n---\n\n# Content"
        b64 = base64.b64encode(raw.encode()).decode()
        mock_data = {
            "content": b64,
            "encoding": "base64",
            "sha": "xyz789",
        }
        skill_dir = ecc_import.SkillFile(
            name="test",
            path="skills/test",
            sha="abc123",
            size=0,
            url="",
            download_url="",
        )
        with patch.object(ecc_import, "_api_request", return_value=mock_data):
            entry = ecc_import.fetch_skill_content(skill_dir)
            self.assertIsNotNone(entry)
            self.assertEqual(entry.name, "test")
            self.assertEqual(entry.description, "A test skill")
            self.assertIn("# Content", entry.raw_content)

    def test_fetch_skill_content_not_found(self) -> None:
        skill_dir = ecc_import.SkillFile(
            name="nonexistent",
            path="skills/nonexistent",
            sha="abc123",
            size=0,
            url="",
            download_url="",
        )
        with patch.object(
            ecc_import, "_api_request", side_effect=Exception("Not Found")
        ):
            entry = ecc_import.fetch_skill_content(skill_dir)
            self.assertIsNone(entry)


# ---------------------------------------------------------------------------
# Adapter tests
# ---------------------------------------------------------------------------


class TestAdapter(unittest.TestCase):
    """Test ECC to Hermes skill adapter."""

    def test_adapt_skill_adds_hermes_fields(self) -> None:
        raw = "---\nname: test-skill\ndescription: A test skill\n---\n\n# Test\n\nContent here."
        entry = ecc_import.SkillEntry(
            name="test-skill",
            description="A test skill",
            version="1.0.0",
            origin="ECC",
            raw_content=raw,
            git_sha="a1b2c3d4",
        )
        adapted = ecc_import.adapt_skill(entry)
        self.assertIn("name: test-skill", adapted)
        self.assertIn("description: A test skill", adapted)
        self.assertIn("origin: ECC", adapted)
        self.assertIn("category: ecc", adapted)

    def test_adapt_skill_adds_adaptation_note(self) -> None:
        raw = "---\nname: test-skill\ndescription: desc\n---\n\n# Content\n"
        entry = ecc_import.SkillEntry(
            name="test-skill",
            description="desc",
            raw_content=raw,
            git_sha="a1b2c3d4",
        )
        adapted = ecc_import.adapt_skill(entry)
        self.assertIn("Hermes Adaptation", adapted)
        self.assertIn("ECC a1b2c3d4", adapted)

    def test_adapt_skill_without_description(self) -> None:
        raw = "---\nname: my-skill\n---\n\n# My Skill\n\nContent."
        entry = ecc_import.SkillEntry(
            name="my-skill",
            description="",
            raw_content=raw,
            git_sha="abc123",
        )
        adapted = ecc_import.adapt_skill(entry)
        # Should derive description from title
        self.assertIn("description: My Skill", adapted)

    def test_adapt_skill_preserves_body(self) -> None:
        raw = "---\nname: test\ndescription: desc\n---\n\n# Main Title\n\n## Section\n\nSome content.\n"
        entry = ecc_import.SkillEntry(
            name="test",
            description="desc",
            raw_content=raw,
            git_sha="abc123",
        )
        adapted = ecc_import.adapt_skill(entry)
        self.assertIn("# Main Title", adapted)
        self.assertIn("## Section", adapted)
        self.assertIn("Some content.", adapted)


# ---------------------------------------------------------------------------
# Idempotency tests
# ---------------------------------------------------------------------------


class TestIdempotency(unittest.TestCase):
    """Test that import is safe to run multiple times."""

    def test_write_skill_skips_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test-skill"
            entry = ecc_import.SkillEntry(
                name="test-skill",
                description="Test",
                raw_content="---\nname: test-skill\ndescription: Test\n---\n\n# Content",
            )

            # First write
            changed1 = ecc_import.write_skill(entry, dest)
            self.assertTrue(changed1)

            # Second write (same content) should skip
            changed2 = ecc_import.write_skill(entry, dest)
            self.assertFalse(changed2)

            # Verify file still exists and is correct
            skill_file = dest / "SKILL.md"
            self.assertTrue(skill_file.exists())
            self.assertEqual(skill_file.read_text(), entry.raw_content)

    def test_write_skill_overwrites_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test-skill"
            entry = ecc_import.SkillEntry(
                name="test-skill",
                description="Test",
                raw_content="---\nname: test-skill\ndescription: Test\n---\n\n# Content",
            )

            # First write
            changed1 = ecc_import.write_skill(entry, dest)
            self.assertTrue(changed1)

            # Modify the file
            (dest / "SKILL.md").write_text(
                "---\nname: test-skill\ndescription: Test\n---\n\n# Different content"
            )

            # Second write (different content) should overwrite
            changed2 = ecc_import.write_skill(entry, dest)
            self.assertTrue(changed2)

    def test_dry_run_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test-skill"
            entry = ecc_import.SkillEntry(
                name="test-skill",
                description="Test",
                raw_content="---\nname: test-skill\ndescription: Test\n---\n\n# Content",
            )

            changed = ecc_import.write_skill(entry, dest, dry_run=True)
            self.assertTrue(changed)
            self.assertFalse((dest / "SKILL.md").exists())


# ---------------------------------------------------------------------------
# Import verification tests
# ---------------------------------------------------------------------------


class TestImportPipeline(unittest.TestCase):
    """Test the full import pipeline."""

    def setUp(self) -> None:
        """Set up mock data for all ECC skills."""
        self.skill_contents = {}
        for skill_name in ecc_import.DEFAULT_CURATED_SKILLS:
            content = f"---\nname: {skill_name}\ndescription: Description for {skill_name}\n---\n\n# {skill_name}\n\nSkill content for testing."
            self.skill_contents[skill_name] = content

        self.mock_directories = [
            ecc_import.SkillFile(
                name=name,
                path=f"skills/{name}",
                sha=f"sha_{name}",
                size=0,
                url=f"https://api.github.com/repos/affaan-m/ECC/contents/skills/{name}",
                download_url="",
            )
            for name in ecc_import.DEFAULT_CURATED_SKILLS
        ]

        self.mock_skill_files = {
            name: {
                "content": base64.b64encode(content.encode()).decode(),
                "encoding": "base64",
                "sha": f"sha_{name}",
            }
            for name, content in self.skill_contents.items()
        }

    def _api_handler(self, url: str) -> dict | list:
        """Route API calls to the correct mock data."""
        if "contents/skills" in url and "/SKILL.md" not in url:
            return self.mock_directories
        for name in self.skill_contents:
            if f"/{name}/SKILL.md" in url:
                return self.mock_skill_files[name]
        return {}

    def test_full_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(
                ecc_import, "_api_request", side_effect=self._api_handler
            ):
                summary = ecc_import.run_import(
                    dry_run=False, output_dir=Path(tmpdir)
                )

            # All 6 curated skills should be imported
            self.assertEqual(len(summary["imported"]), 6)

            # All files should be written
            for skill_name in ecc_import.DEFAULT_CURATED_SKILLS:
                skill_dir = Path(tmpdir) / skill_name
                skill_file = skill_dir / "SKILL.md"
                self.assertTrue(skill_dir.exists(), f"Missing directory: {skill_dir}")
                self.assertTrue(skill_file.exists(), f"Missing file: {skill_file}")

    def test_import_idempotency(self) -> None:
        """Running import twice should not duplicate work."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(
                ecc_import, "_api_request", side_effect=self._api_handler
            ):
                # First run
                summary1 = ecc_import.run_import(
                    dry_run=False, output_dir=Path(tmpdir)
                )
                self.assertEqual(len(summary1["imported"]), 6)
                self.assertEqual(len(summary1["skipped"]), 0)

                # Second run (same content) should skip all
                summary2 = ecc_import.run_import(
                    dry_run=False, output_dir=Path(tmpdir)
                )
                self.assertEqual(len(summary2["imported"]), 0)
                self.assertEqual(len(summary2["skipped"]), 6)

    def test_dry_run_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(
                ecc_import, "_api_request", side_effect=self._api_handler
            ):
                summary = ecc_import.run_import(
                    dry_run=True, output_dir=Path(tmpdir)
                )

            # Should report as imported but files should not exist
            self.assertEqual(len(summary["imported"]), 6)
            for skill_name in ecc_import.DEFAULT_CURATED_SKILLS:
                skill_file = Path(tmpdir) / skill_name / "SKILL.md"
                self.assertFalse(skill_file.exists())

    def test_custom_curated_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(
                ecc_import, "_api_request", side_effect=self._api_handler
            ):
                summary = ecc_import.run_import(
                    curated_names=["security-review", "deep-research"],
                    dry_run=False,
                    output_dir=Path(tmpdir),
                )

            # Only 2 skills should be imported
            self.assertEqual(len(summary["imported"]), 2)
            self.assertIn("security-review", summary["imported"])
            self.assertIn("deep-research", summary["imported"])

    def test_missing_skill_in_repo(self) -> None:
        """Test behavior when a curated skill doesn't exist in the repo."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Override mock to only have 2 skills
            partial_skills = [
                ecc_import.SkillFile(
                    name="security-review",
                    path="skills/security-review",
                    sha="sha_sec",
                    size=0,
                    url="",
                    download_url="",
                ),
            ]
            partial_content = {
                "security-review": "---\nname: security-review\ndescription: Security\n---\n\n# Security"
            }
            partial_files = {
                name: {
                    "content": base64.b64encode(c.encode()).decode(),
                    "encoding": "base64",
                    "sha": "sha_sec",
                }
                for name, c in partial_content.items()
            }

            def partial_api(url: str) -> dict | list:
                if "contents/skills" in url and "/SKILL.md" not in url:
                    return partial_skills
                for name in partial_content:
                    if f"/{name}/SKILL.md" in url:
                        return partial_files[name]
                return {}

            with patch.object(ecc_import, "_api_request", side_effect=partial_api):
                summary = ecc_import.run_import(
                    curated_names=["security-review", "nonexistent-skill"],
                    dry_run=False,
                    output_dir=Path(tmpdir),
                )

            # Should have 1 error for the missing skill
            self.assertEqual(len(summary["imported"]), 1)
            self.assertEqual(len(summary["errors"]), 1)
            self.assertIn("nonexistent-skill", summary["errors"][0])

    def test_validation_after_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(
                ecc_import, "_api_request", side_effect=self._api_handler
            ):
                summary = ecc_import.run_import(
                    dry_run=False, output_dir=Path(tmpdir)
                )

            # All imported skills should pass validation
            for vr in summary["validation_results"]:
                self.assertTrue(vr["valid"], f"{vr['name']} failed validation: {vr['errors']}")


# ---------------------------------------------------------------------------
# Hash computation test
# ---------------------------------------------------------------------------


class TestHashComputation(unittest.TestCase):
    """Test skill hash computation."""

    def test_same_content_same_hash(self) -> None:
        content = "---\nname: test\n---\n\n# Test\n"
        h1 = ecc_import.compute_skill_hash(content)
        h2 = ecc_import.compute_skill_hash(content)
        self.assertEqual(h1, h2)

    def test_different_content_different_hash(self) -> None:
        h1 = ecc_import.compute_skill_hash("content one")
        h2 = ecc_import.compute_skill_hash("content two")
        self.assertNotEqual(h1, h2)


# ---------------------------------------------------------------------------
# Run tests
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    unittest.main(verbosity=2)
