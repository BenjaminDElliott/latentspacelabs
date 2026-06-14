"""
Tests for skill validation (LAT-191).
"""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile

from hermes.skills.validator import (
    SkillValidator,
    SkillValidationError,
    ValidationResult,
    parse_frontmatter,
    validate_agentskills_io_spec,
    validate_skill_file,
)


class TestParseFrontmatter(unittest.TestCase):
    """Tests for frontmatter parsing."""

    def test_valid_frontmatter(self):
        text = """---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

This is the body content.
"""
        fields, body = parse_frontmatter(text)
        self.assertIn("name", fields)
        self.assertEqual(fields["name"], "test-skill")
        self.assertIn("description", fields)
        self.assertEqual(fields["description"], "A test skill")
        self.assertIn("version", fields)
        self.assertEqual(fields["version"], "1.0.0")
        self.assertIn("# Test Skill", body)

    def test_no_frontmatter(self):
        text = "# No Frontmatter\n\nJust regular markdown."
        fields, body = parse_frontmatter(text)
        self.assertEqual(fields, {})
        self.assertEqual(body, "# No Frontmatter\n\nJust regular markdown.")

    def test_empty_frontmatter(self):
        text = """---
---

Content only.
"""
        fields, body = parse_frontmatter(text)
        self.assertEqual(fields, {})
        self.assertIn("Content only", body)

    def test_string_values_quoted(self):
        text = """---
name: "test-skill"
description: "A skill with :colon:"
---

Body.
"""
        fields, _ = parse_frontmatter(text)
        self.assertEqual(fields["name"], "test-skill")
        self.assertEqual(fields["description"], "A skill with :colon:")


class TestSkillValidator(unittest.TestCase):
    """Tests for SkillValidator class."""

    def setUp(self):
        self.validator = SkillValidator()

    def test_valid_skill(self):
        text = """---
name: test-skill
description: A valid test skill
version: 1.0.0
---

# Test Skill

This is a valid skill with all required fields.
"""
        result = self.validator.validate_full(text)
        self.assertTrue(result.valid)
        self.assertEqual(result.name, "test-skill")
        self.assertEqual(result.error_count, 0)

    def test_missing_required_fields(self):
        text = """---
version: 1.0.0
---

# Missing Fields

No name or description.
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertEqual(result.error_count, 2)  # name + description

    def test_invalid_version_format(self):
        text = """---
name: test-skill
description: Invalid version
version: abc
---

# Body
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("version" in e.field for e in result.errors))

    def test_invalid_name_format(self):
        text = """---
name: "Invalid Name With Spaces"
description: Invalid name format
---

# Body
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("name" in e.field for e in result.errors))

    def test_empty_body(self):
        text = """---
name: test-skill
description: Empty body
---

"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("content" in e.field for e in result.errors))

    def test_unmatched_code_blocks(self):
        text = """---
name: test-skill
description: Has code
---

# Test

Some code here
```python
print("hello")

No closing triple backtick.
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("code block" in str(e.message) for e in result.errors))

    def test_trigger_patterns_valid(self):
        text = """---
name: test-skill
description: Has triggers
triggerPatterns: "fix: *, test *, debug *"
---

# Body
"""
        result = self.validator.validate_full(text)
        self.assertTrue(result.valid)

    def test_trigger_patterns_invalid(self):
        text = """---
name: test-skill
description: Bad trigger
triggerPatterns: "fix: *, , debug *"
---

# Body
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)

    def test_unknown_fields_warning(self):
        text = """---
name: test-skill
description: Has unknown field
unknown_field: some value
---

# Body
"""
        result = self.validator.validate_full(text)
        self.assertTrue(result.valid)  # Unknown fields are warnings, not errors
        self.assertEqual(result.warning_count, 1)

    def test_file_validation_existing(self):
        with NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("""---
name: file-test
description: File validation test
version: 1.0.0
---

# File Test

Valid skill in file.
""")
            f.flush()
            path = Path(f.name)

        result = self.validator.validate_file(path)
        self.assertTrue(result.valid)
        self.assertEqual(result.name, "file-test")

        path.unlink()

    def test_file_validation_missing(self):
        result = self.validator.validate_file(Path("/nonexistent/path/skill.md"))
        self.assertFalse(result.valid)
        self.assertEqual(result.error_count, 1)

    def test_no_frontmatter_extraction(self):
        """When no frontmatter exists, extract name from title."""
        text = """# My Cool Skill

This is a skill without YAML frontmatter.
"""
        result = self.validator.validate_full(text)
        self.assertEqual(result.name, "my-cool-skill")
        self.assertFalse(result.valid)

    def test_max_size_exceeded(self):
        """Test skill exceeds max size limit."""
        large_content = "x" * (1024 * 1024 + 1)
        text = f"""---
name: large-skill
description: Too large
---

{large_content}
"""
        result = self.validator.validate_full(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("size" in e.field for e in result.errors))


class TestValidateAgentskillsIOSpec(unittest.TestCase):
    """Tests for convenience function."""

    def test_valid_skill(self):
        text = """---
name: test-skill
description: A valid skill
version: 1.0.0
---

# Test
"""
        result = validate_agentskills_io_spec(text)
        self.assertTrue(result.valid)

    def test_invalid_skill(self):
        text = "Just plain text, no frontmatter"
        result = validate_agentskills_io_spec(text)
        self.assertFalse(result.valid)


class TestValidateSkillFile(unittest.TestCase):
    """Tests for file validation convenience function."""

    def test_existing_file(self):
        with NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("""---
name: test
description: Valid
version: 1.0.0
---

# Test
""")
            f.flush()
            path = Path(f.name)

        result = validate_skill_file(path)
        self.assertTrue(result.valid)
        path.unlink()

    def test_missing_file(self):
        result = validate_skill_file(Path("/nonexistent"))
        self.assertFalse(result.valid)


if __name__ == "__main__":
    unittest.main()
