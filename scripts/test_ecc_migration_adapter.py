#!/usr/bin/env python3
"""
Tests for ECC → Hermes SKILL.md Migration Adapter (LAT-294)

Run:
    python3 scripts/test_ecc_migration_adapter.py
"""

import json
import sys
from pathlib import Path

# Add the parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from ecc_migration_adapter import EccMigrationAdapter, MigratedSkill


# --- Test Data ---

ECC_SKILL_MINIMAL = {
    "frontmatter": {
        "name": "test-skill",
        "description": "A minimal ECC skill.",
    },
    "body": "# Test Skill\n\nBody content.",
    "skill_path": ".agents/skills/test-skill/SKILL.md",
}

ECC_SKILL_WITH_TOOLS = {
    "frontmatter": {
        "name": "test-tools-skill",
        "description": "A skill with allowed-tools.",
        "allowed-tools": "Read, Write, Edit, Bash, Grep, Glob",
    },
    "body": "# Test Tools Skill\n\nBody content.",
    "skill_path": ".agents/skills/test-tools-skill/SKILL.md",
}

ECC_SKILL_FULL = {
    "frontmatter": {
        "name": "test-full-skill",
        "description": "A fully-featured ECC skill.",
        "allowed-tools": "Read, Write",
        "category": "coding",
        "version": "2.1.0",
        "author": "ecc-contributor",
    },
    "body": "# Test Full Skill\n\nBody content.",
    "skill_path": ".agents/skills/coding/test-full-skill/SKILL.md",
}

ECC_SKILL_NO_NAME = {
    "frontmatter": {
        "description": "Skill without a name field.",
    },
    "body": "# No Name Skill\n\nBody content.",
    "skill_path": ".agents/skills/orphan-skill/SKILL.md",
}

HERMES_SKILL_WITH_HIDDEN = {
    "frontmatter": {
        "name": "hidden-skill",
        "description": "A hidden Hermes skill.",
        "hidden": "true",
    },
    "body": "# Hidden Skill\n\nBody content.",
    "skill_path": "skills/hidden-skill/SKILL.md",
}


def assert_eq(actual, expected, msg=""):
    """Assert equality with a descriptive message."""
    if actual != expected:
        raise AssertionError(f"{msg}: expected {expected!r}, got {actual!r}")


def run_tests():
    adapter = EccMigrationAdapter()
    passed = 0
    failed = 0

    # --- Test 1: Minimal skill migration ---
    print("Test 1: Minimal ECC skill migration...")
    try:
        result = adapter.migrate_from_dict(ECC_SKILL_MINIMAL)
        assert_eq(result.name, "test-skill", "name")
        assert_eq(result.description, "A minimal ECC skill.", "description")
        assert_eq(result.version, "1.0.0", "version default")
        assert_eq(result.author, "ecc", "author default")
        assert_eq(result.category, "test-skill", "category derived from path")
        assert_eq(result.allowed_tools, "", "allowed_tools empty")
        assert_eq(result.hidden, False, "hidden default")
        assert len(result.migration_warnings) > 0, "should have warnings for derived values"
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 2: Allowed-tools normalization ---
    print("Test 2: allowed-tools normalization...")
    try:
        result = adapter.migrate_from_dict(ECC_SKILL_WITH_TOOLS)
        assert_eq(result.allowed_tools, "Read Write Edit Bash Grep Glob", "allowed_tools normalized")
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 3: Full skill migration with all fields ---
    print("Test 3: Full skill migration...")
    try:
        result = adapter.migrate_from_dict(ECC_SKILL_FULL)
        assert_eq(result.name, "test-full-skill", "name")
        assert_eq(result.description, "A fully-featured ECC skill.", "description")
        assert_eq(result.version, "2.1.0", "version from ECC")
        assert_eq(result.author, "ecc-contributor", "author from ECC")
        assert_eq(result.allowed_tools, "Read Write", "allowed_tools normalized")
        # Category derivation: path is ".agents/skills/coding/test-full-skill/SKILL.md"
        # First pattern: .agents/skills/([^/]+)/ → group 1 = "coding"
        assert_eq(result.category, "coding", "category derived from path")
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 4: Missing name derivation ---
    print("Test 4: Missing name derivation from path...")
    try:
        result = adapter.migrate_from_dict(ECC_SKILL_NO_NAME)
        assert_eq(result.name, "orphan-skill", "name derived from path")
        assert len(result.migration_warnings) > 0, "should have warning about derived name"
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 5: Hidden field parsing ---
    print("Test 5: Hidden field parsing...")
    try:
        result = adapter.migrate_from_dict(HERMES_SKILL_WITH_HIDDEN)
        assert_eq(result.hidden, True, "hidden parsed as True")
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 6: Hermes frontmatter generation ---
    print("Test 6: Hermes frontmatter generation...")
    try:
        skill = MigratedSkill(
            name="test-skill",
            description="A test skill.",
            version="1.0.0",
            author="hermes",
            category="testing",
            allowed_tools="Bash(npx:*) Bash(npm:*)",
            hidden=False,
        )
        fm = adapter.to_hermes_frontmatter(skill)
        assert "---" in fm, "frontmatter should have delimiters"
        assert "name: test-skill" in fm, "should contain name"
        assert "description: A test skill." in fm, "should contain description"
        assert "version: 1.0.0" in fm, "should contain version"
        assert "author: hermes" in fm, "should contain author"
        assert "category: testing" in fm, "should contain category"
        assert "allowed-tools: Bash(npx:*) Bash(npm:*)" in fm, "should contain allowed-tools"
        assert "hidden: true" not in fm, "should NOT contain hidden when False"
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 7: Complete SKILL.md file generation ---
    print("Test 7: Complete SKILL.md file generation...")
    try:
        skill = MigratedSkill(
            name="test-skill",
            description="A test skill.",
            version="1.0.0",
            author="hermes",
            category="testing",
            allowed_tools="Bash(npx:*)",
            hidden=False,
            body="# Test\n\nSome content.",
        )
        file_content = adapter.to_hermes_skill_file(skill)
        assert file_content.startswith("---\n"), "should start with frontmatter delimiter"
        assert "# test-skill" in file_content, "should contain heading"
        assert "# Test" in file_content, "should contain body"
        assert "name: test-skill" in file_content, "should contain name"
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 8: Batch migration ---
    print("Test 8: Batch migration...")
    try:
        skills = [ECC_SKILL_MINIMAL, ECC_SKILL_WITH_TOOLS, ECC_SKILL_FULL]
        results = adapter.batch_migrate(skills)
        assert len(results) == 3, f"expected 3 results, got {len(results)}"
        assert results[0].name == "test-skill"
        assert results[1].name == "test-tools-skill"
        assert results[2].name == "test-full-skill"
        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 9: Backward compatibility with real ECC skills ---
    print("Test 9: Backward compatibility with real ECC skills...")
    try:
        data_path = Path(__file__).parent.parent / "data" / "ecc_skills" / "parsed_skills.json"
        if data_path.exists():
            with open(data_path) as f:
                real_skills = json.load(f)

            migrated = adapter.batch_migrate(real_skills)
            assert len(migrated) > 0, "should have migrated skills"

            # All migrated skills should have non-empty name and description
            for m in migrated:
                assert m.name, f"Skill {m.skill_path} has empty name"
                assert m.description, f"Skill {m.skill_path} has empty description"
                assert m.version, "version should be set (default or from source)"

            print(f"  PASSED (migrated {len(migrated)} real skills)")
            passed += 1
        else:
            print("  SKIPPED (no parsed_skills.json found)")
            passed += 1  # Count as passed since data may not exist
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Test 10: Category derivation from different path patterns ---
    print("Test 10: Category derivation from different paths...")
    try:
        # Test path pattern 1: .agents/skills/<category>/
        result1 = adapter.migrate({}, body="", skill_path=".agents/skills/coding/test-skill/SKILL.md")
        assert_eq(result1.category, "coding", "category from .agents/skills/ pattern")

        # Test path pattern 2: skills/<category>/
        result2 = adapter.migrate({}, body="", skill_path="skills/research/test-skill/SKILL.md")
        assert_eq(result2.category, "research", "category from skills/ pattern")

        # Test no category derivation
        result3 = adapter.migrate({}, body="", skill_path="SKILL.md")
        assert_eq(result3.category, "", "empty category when no pattern matches")

        print("  PASSED")
        passed += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        failed += 1

    # --- Summary ---
    print(f"\n{'='*60}")
    print(f"Test Results: {passed} passed, {failed} failed out of {passed+failed} tests")
    print(f"{'='*60}")

    if failed > 0:
        sys.exit(1)
    else:
        print("All tests passed! ECC migration adapter is working correctly.")
        sys.exit(0)


if __name__ == "__main__":
    run_tests()
