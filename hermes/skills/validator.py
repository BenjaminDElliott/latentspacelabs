"""
Skill validation for the agentskills.io specification.

Validates SKILL.md files against the agentskills.io spec:
- Required frontmatter fields (name, version, description)
- Trigger patterns format
- Parameter definitions
- Content structure

Reference: https://agentskills.io
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# agentskills.io Spec Validation
# ---------------------------------------------------------------------------

# agentskills.io frontmatter field requirements
REQUIRED_FIELDS = ["name", "description"]
OPTIONAL_FIELDS = [
    "version",
    "author",
    "source",
    "triggerPatterns",
    "parameters",
    "category",
    "origin",
    "dependencies",
]

# agentskills.io field type expectations
FIELD_SCHEMA: dict[str, dict[str, Any]] = {
    "name": {"type": "string", "required": True, "pattern": r"^[a-z][a-z0-9-]*$"},
    "description": {"type": "string", "required": True, "min_length": 1},
    "version": {"type": "string", "required": False, "pattern": r"^\d+\.\d+\.\d+$"},
    "author": {"type": "string", "required": False},
    "source": {"type": "string", "required": False, "format": "url"},
    "triggerPatterns": {"type": "array", "required": False, "items_type": "string"},
    "parameters": {"type": "object", "required": False},
    "category": {"type": "string", "required": False},
    "origin": {"type": "string", "required": False},
    "dependencies": {"type": "array", "required": False, "items_type": "string"},
}

# agentskills.io trigger pattern format: glob-like patterns
# Examples: "fix: *", "test *", "debug *"
_TRIGGER_PATTERN_RE = re.compile(r"^[\*\w\-:/\{\}]+(\.[\w]+)*$")

# Max SKILL.md size (1 MB)
MAX_SKILL_SIZE_BYTES = 1024 * 1024


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class SkillValidationError:
    """A single validation error found in a skill."""

    field: str
    message: str
    severity: str = "error"  # "error" or "warning"

    def to_dict(self) -> dict[str, str]:
        return {
            "field": self.field,
            "message": self.message,
            "severity": self.severity,
        }


@dataclass
class ValidationResult:
    """Result of validating a skill file.

    Attributes:
        name: Skill name (or 'unknown' if not parseable).
        valid: Whether all errors are resolved.
        errors: List of validation errors (non-empty = invalid).
        warnings: List of validation warnings.
        fields: Parsed frontmatter fields (if valid frontmatter found).
    """

    name: str = "unknown"
    valid: bool = True
    errors: list[SkillValidationError] = field(default_factory=list)
    warnings: list[SkillValidationError] = field(default_factory=list)
    fields: dict[str, str] = field(default_factory=dict)

    @property
    def error_count(self) -> int:
        return sum(1 for e in self.errors if e.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for w in self.warnings if w.severity == "warning")

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "valid": self.valid,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
            "fields": self.fields,
        }


# ---------------------------------------------------------------------------
# Frontmatter Parser (stdlib only, no PyYAML dependency)
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)", re.DOTALL)
_YAML_PAIR_RE = re.compile(r"^(\w[\w-]*):\s*(.*)$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Parse YAML frontmatter from a Markdown document.

    Args:
        text: Full document text.

    Returns:
        Tuple of (fields_dict, body_without_frontmatter).
    """
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text

    raw_yaml = m.group(1)
    body = m.group(2)

    fields: dict[str, str] = {}
    for pair in _YAML_PAIR_RE.finditer(raw_yaml):
        key = pair.group(1).strip()
        value = pair.group(2).strip().strip('"').strip("'")
        fields[key] = value

    return fields, body


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


class SkillValidator:
    """Validates SKILL.md files against the agentskills.io specification."""

    def __init__(self, schema: dict[str, dict[str, Any]] | None = None):
        """Initialize validator.

        Args:
            schema: Optional custom field schema. Uses agentskills.io defaults if None.
        """
        self.schema = schema or FIELD_SCHEMA

    def validate_frontmatter(self, text: str) -> tuple[dict[str, str], list[SkillValidationError]]:
        """Parse and validate frontmatter structure.

        Args:
            text: SKILL.md content.

        Returns:
            Tuple of (parsed_fields, frontmatter_errors).
        """
        errors: list[SkillValidationError] = []
        fields, body = parse_frontmatter(text)

        if not fields:
            errors.append(
                SkillValidationError(
                    field="frontmatter",
                    message="Missing YAML frontmatter (--- delimiters not found)",
                    severity="error",
                )
            )
            return fields, errors

        return fields, errors

    def validate_fields(
        self, fields: dict[str, str]
    ) -> tuple[list[SkillValidationError], list[SkillValidationError]]:
        """Validate frontmatter fields against the agentskills.io spec.

        Args:
            fields: Parsed frontmatter fields.

        Returns:
            Tuple of (errors, warnings).
        """
        errors: list[SkillValidationError] = []
        warnings: list[SkillValidationError] = []

        # Check required fields
        for field_name, field_def in self.schema.items():
            if field_def.get("required") and field_name not in fields:
                errors.append(
                    SkillValidationError(
                        field=field_name,
                        message=f"Required field '{field_name}' is missing",
                        severity="error",
                    )
                )

        # Validate field formats
        for field_name, value in fields.items():
            field_def = self.schema.get(field_name)
            if not field_def:
                # Unknown field - add as warning, not error
                warnings.append(
                    SkillValidationError(
                        field=field_name,
                        message=f"Unknown field '{field_name}' (not in agentskills.io spec)",
                        severity="warning",
                    )
                )
                continue

            # Type checking
            expected_type = field_def.get("type", "string")
            if expected_type == "string" and not isinstance(value, str):
                errors.append(
                    SkillValidationError(
                        field=field_name,
                        message=f"Field '{field_name}' must be a string",
                        severity="error",
                    )
                )
                continue

            # Min length check
            min_length = field_def.get("min_length")
            if min_length and len(value) < min_length:
                errors.append(
                    SkillValidationError(
                        field=field_name,
                        message=f"Field '{field_name}' must be at least {min_length} characters",
                        severity="error",
                    )
                )

            # Pattern check
            pattern = field_def.get("pattern")
            if pattern and not re.match(pattern, value):
                errors.append(
                    SkillValidationError(
                        field=field_name,
                        message=f"Field '{field_name}' does not match expected pattern: {pattern}",
                        severity="error",
                    )
                )

            # Trigger patterns validation
            if field_name == "triggerPatterns":
                errors.extend(self._validate_trigger_patterns(value))

            # Parameter validation
            if field_name == "parameters":
                errors.extend(self._validate_parameters(value))

            # Warnings for non-required fields
            if not field_def.get("required"):
                if field_name not in fields:
                    warnings.append(
                        SkillValidationError(
                            field=field_name,
                            message=f"Field '{field_name}' is recommended but missing",
                            severity="warning",
                        )
                    )

        return errors, warnings

    def _validate_trigger_patterns(self, patterns_str: str) -> list[SkillValidationError]:
        """Validate trigger pattern strings.

        Args:
            patterns_str: Comma-separated or pipe-separated patterns.

        Returns:
            List of validation errors.
        """
        errors: list[SkillValidationError] = []
        # Handle comma or pipe separated patterns
        patterns = [p.strip() for p in re.split(r"[,|]", patterns_str) if p.strip()]

        if not patterns:
            errors.append(
                SkillValidationError(
                    field="triggerPatterns",
                    message="No valid trigger patterns found",
                    severity="error",
                )
            )
            return errors

        for pattern in patterns:
            if not pattern or len(pattern) > 256:
                errors.append(
                    SkillValidationError(
                        field="triggerPatterns",
                        message=f"Trigger pattern '{pattern}' is empty or too long (>256 chars)",
                        severity="error",
                    )
                )
            elif not _TRIGGER_PATTERN_RE.match(pattern):
                errors.append(
                    SkillValidationError(
                        field="triggerPatterns",
                        message=f"Trigger pattern '{pattern}' has invalid format",
                        severity="error",
                    )
                )

        return errors

    def _validate_parameters(self, params_str: str) -> list[SkillValidationError]:
        """Validate parameter definitions.

        Args:
            params_str: Parameter definitions (simplified YAML-like).

        Returns:
            List of validation errors.
        """
        errors: list[SkillValidationError] = []
        # Handle simple parameter format: "param1: type, param2: type"
        param_defs = [p.strip() for p in params_str.split(",") if p.strip()]

        for param_def in param_defs:
            if ":" not in param_def:
                errors.append(
                    SkillValidationError(
                        field="parameters",
                        message=f"Parameter '{param_def}' missing type definition",
                        severity="error",
                    )
                )

        return errors

    def validate_content(self, body: str) -> list[SkillValidationError]:
        """Validate the skill body content.

        Args:
            body: Skill description text (without frontmatter).

        Returns:
            List of validation errors.
        """
        errors: list[SkillValidationError] = []
        warnings: list[SkillValidationError] = []

        # Content should not be empty
        if not body.strip():
            errors.append(
                SkillValidationError(
                    field="content",
                    message="Skill body content is empty after frontmatter",
                    severity="error",
                )
            )
            return errors

        # Check for first-level heading in body
        if not re.search(r"^#\s+", body, re.MULTILINE):
            warnings.append(
                SkillValidationError(
                    field="content",
                    message="No first-level heading (#) found in body",
                    severity="warning",
                )
            )

        # Check for executable code blocks
        code_blocks = len(re.findall(r"```", body))
        if code_blocks % 2 != 0:
            errors.append(
                SkillValidationError(
                    field="content",
                    message="Unmatched code block delimiters (```)",
                    severity="error",
                )
            )

        return errors

    def validate_full(self, text: str) -> ValidationResult:
        """Run complete validation on a SKILL.md document.

        Args:
            text: Full SKILL.md content.

        Returns:
            Validation results with errors and warnings.
        """
        result = ValidationResult()

        # Step 1: Check size
        if len(text.encode("utf-8")) > MAX_SKILL_SIZE_BYTES:
            result.errors.append(
                SkillValidationError(
                    field="size",
                    message=f"Skill exceeds maximum size of {MAX_SKILL_SIZE_BYTES} bytes",
                    severity="error",
                )
            )
            return result

        # Step 2: Parse frontmatter
        fields, body = parse_frontmatter(text)
        if not fields:
            # No frontmatter - extract name from title if present
            title_match = re.search(r"^#\s+(.+)", text, re.MULTILINE)
            if title_match:
                result.name = title_match.group(1).strip().lower().replace(" ", "-")
                result.fields["name"] = result.name
            result.fields["description"] = body[:200].strip()

            result.errors.append(
                SkillValidationError(
                    field="frontmatter",
                    message="No YAML frontmatter found",
                    severity="error",
                )
            )
            result.valid = False
            return result

        # Step 3: Extract skill name for result
        result.name = fields.get("name", "unknown")
        result.fields = fields

        # Step 4: Validate fields
        field_errors, field_warnings = self.validate_fields(fields)
        result.errors.extend(field_errors)
        result.warnings.extend(field_warnings)

        # Step 5: Validate content
        content_errors = self.validate_content(body)
        result.errors.extend(content_errors)

        # Step 6: Overall validity
        result.valid = result.error_count == 0

        return result

    def validate_file(self, path: Path) -> ValidationResult:
        """Validate a SKILL.md file on disk.

        Args:
            path: Path to SKILL.md file.

        Returns:
            Validation results.
        """
        if not path.exists():
            return ValidationResult(
                name=path.name,
                valid=False,
                errors=[
                    SkillValidationError(
                        field="file",
                        message=f"File does not exist: {path}",
                        severity="error",
                    )
                ],
            )

        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return ValidationResult(
                name=path.name,
                valid=False,
                errors=[
                    SkillValidationError(
                        field="encoding",
                        message="File is not valid UTF-8",
                        severity="error",
                    )
                ],
            )

        return self.validate_full(text)


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------


def validate_agentskills_io_spec(text: str) -> ValidationResult:
    """Quick validation against agentskills.io spec.

    Args:
        text: SKILL.md content.

    Returns:
        Validation results.
    """
    validator = SkillValidator()
    return validator.validate_full(text)


def validate_skill_file(path: Path) -> ValidationResult:
    """Quick validation of a SKILL.md file.

    Args:
        path: Path to SKILL.md file.

    Returns:
        Validation results.
    """
    validator = SkillValidator()
    return validator.validate_file(path)
