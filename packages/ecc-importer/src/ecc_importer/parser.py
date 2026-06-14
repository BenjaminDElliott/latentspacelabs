"""Parser for ECC SKILL.md YAML frontmatter.

Extracts and validates the YAML frontmatter block from ECC SKILL.md files.
Handles ECC-specific fields (origin, allowed-tools) alongside standard fields.
"""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class EccSkillFrontmatter:
    """Parsed frontmatter from an ECC SKILL.md file."""

    name: str
    description: str
    origin: Optional[str] = None
    allowed_tools: Optional[list[str]] = None

    # Derived fields
    source_hash: str = ""
    source_path: str = ""

    def compute_hash(self) -> str:
        """Compute a content hash for deduplication."""
        content = f"{self.name}:{self.description}".encode("utf-8")
        return hashlib.sha256(content).hexdigest()[:16]


@dataclass
class EccSkillFile:
    """Complete parsed ECC SKILL.md file."""

    frontmatter: EccSkillFrontmatter
    content: str
    raw: str
    path: str  # Original path in ECC repo (e.g. "skills/security-review/SKILL.md")


def parse_frontmatter(raw: str) -> EccSkillFrontmatter:
    """Extract YAML frontmatter from SKILL.md content.

    Args:
        raw: Raw SKILL.md file content.

    Returns:
        Parsed EccSkillFrontmatter.

    Raises:
        ValueError: If frontmatter is missing or invalid.
    """
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", raw, re.DOTALL)
    if not match:
        raise ValueError("No YAML frontmatter found (missing --- delimiters)")

    yaml_block = match.group(1)
    fields = _parse_yaml_simple(yaml_block)

    name = fields.get("name")
    description = fields.get("description")

    if not name:
        raise ValueError("SKILL.md frontmatter missing required field: name")
    if not description:
        raise ValueError("SKILL.md frontmatter missing required field: description")

    result = EccSkillFrontmatter(
        name=name,
        description=description,
        origin=fields.get("origin"),
        allowed_tools=_parse_list(fields.get("allowed-tools", "")),
        source_hash="",
        source_path="",
    )
    result.source_hash = result.compute_hash()
    return result


def parse_skill_file(path: Path, source_path: str = "") -> EccSkillFile:
    """Parse a complete ECC SKILL.md file from the filesystem.

    Args:
        path: Path to the SKILL.md file.
        source_path: Original path in ECC repo for metadata.

    Returns:
        Parsed EccSkillFile.
    """
    raw = path.read_text(encoding="utf-8")
    frontmatter = parse_frontmatter(raw)
    frontmatter.source_path = source_path

    # Extract markdown content after frontmatter
    content = re.sub(r"^---\s*\n.*?\n---\s*\n?", "", raw, count=1, flags=re.DOTALL)

    return EccSkillFile(
        frontmatter=frontmatter,
        content=content.strip(),
        raw=raw,
        path=source_path,
    )


def parse_skill_from_url(
    raw_content: str, source_path: str = ""
) -> EccSkillFile:
    """Parse SKILL.md content fetched from a URL.

    Args:
        raw_content: Raw file content from HTTP request.
        source_path: Source path for metadata.

    Returns:
        Parsed EccSkillFile.
    """
    frontmatter = parse_frontmatter(raw_content)
    frontmatter.source_path = source_path

    content = re.sub(r"^---\s*\n.*?\n---\s*\n?", "", raw_content, count=1, flags=re.DOTALL)

    return EccSkillFile(
        frontmatter=frontmatter,
        content=content.strip(),
        raw=raw_content,
        path=source_path,
    )


def _parse_yaml_simple(block: str) -> dict[str, str]:
    """Parse a simple YAML block into a dict (no nested structures).

    Handles:
    - key: value pairs
    - Multiline strings (literal block with |)
    - Simple quoted strings
    - Lists (key: val1, val2, val3)
    """
    result: dict[str, str] = {}
    current_key = None
    current_value_lines: list[str] = []
    in_multiline = False

    for line in block.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if in_multiline:
            if line.startswith("  ") or line.startswith("\t"):
                current_value_lines.append(line.lstrip())
            else:
                in_multiline = False
                assert current_key is not None  # pyright: ignore[reportArgumentType]
                result[current_key] = "\n".join(current_value_lines)
                # Fall through to process this line
            if in_multiline:
                continue

        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            # Save previous field
            if current_key and not in_multiline:
                result[current_key] = "\n".join(current_value_lines) if current_value_lines else ""

            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()

            current_key = key
            current_value_lines = []

            if value.startswith("|"):
                in_multiline = True
            elif value.startswith('"') and value.endswith('"'):
                result[key] = value[1:-1]
                current_key = None
            elif value.startswith("'") and value.endswith("'"):
                result[key] = value[1:-1]
                current_key = None
            else:
                if value:
                    current_value_lines = [value]
                else:
                    current_value_lines = []
        else:
            current_value_lines.append(line)

    if current_key and not in_multiline:
        result[current_key] = "\n".join(current_value_lines) if current_value_lines else ""

    return result


def _parse_list(value: str) -> Optional[list[str]]:
    """Parse a comma-separated list string into a list."""
    if not value:
        return None
    return [item.strip() for item in value.split(",") if item.strip()]
