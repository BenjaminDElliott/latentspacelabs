"""Migration adapter: ECC frontmatter → Hermes frontmatter.

Handles field mapping, deduplication, and format transformation
between ECC and Hermes SKILL.md schemas.
"""

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .parser import EccSkillFile, EccSkillFrontmatter


# ECC skill → Hermes category mapping
CATEGORY_MAP: dict[str, str] = {
    # Engineering core
    "coding-standards": "engineering",
    "tdd-workflow": "engineering",
    "verification-loop": "engineering",
    "security-review": "security",
    "eval-harness": "engineering",
    # Design & UI
    "frontend-patterns": "engineering",
    "backend-patterns": "engineering",
    "api-design": "engineering",
    "frontend-slides": "engineering",
    # Research
    "deep-research": "research",
    "market-research": "research",
    "documentation-lookup": "engineering",
    # Operations
    "strategic-compact": "operations",
    "context-budget": "operations",
    "agent-sort": "operations",
    "hookify-rules": "devops",
    "mcp-server-patterns": "devops",
    "continuous-learning": "self-improvement",
    "continuous-learning-v2": "self-improvement",
    # Testing
    "e2e-testing": "engineering",
    "python-testing": "engineering",
    "golang-testing": "engineering",
    "rust-testing": "engineering",
    "react-testing": "engineering",
    "java-coding-standards": "engineering",
    "cpp-coding-standards": "engineering",
    # Framework-specific
    "django-patterns": "engineering",
    "django-security": "security",
    "fastapi-patterns": "engineering",
    "nextjs-turbopack": "engineering",
    "nestjs-patterns": "engineering",
    "react-patterns": "engineering",
    "golang-patterns": "engineering",
    "kotlin-patterns": "engineering",
    "swiftui-patterns": "engineering",
    "rust-patterns": "engineering",
    "python-patterns": "engineering",
    "postgres-patterns": "engineering",
    "docker-patterns": "engineering",
    "deployment-patterns": "engineering",
    "database-migrations": "engineering",
    # General
    "brand-voice": "content",
    "article-writing": "content",
    "content-engine": "content",
    "search-first": "engineering",
    "error-handling": "engineering",
}


@dataclass
class HermesFrontmatter:
    """Hermes-compatible SKILL.md frontmatter."""

    name: str
    description: str
    version: str = "1.0.0"
    author: str = "ecc"
    category: str = "engineering"
    tags: list[str] = field(default_factory=list)

    def to_yaml(self) -> str:
        """Serialize to YAML frontmatter string."""
        lines = ["---"]
        lines.append(f"name: {self._yaml_str(self.name)}")
        lines.append(f"description: {self._yaml_str(self.description)}")
        lines.append(f"version: {self.version}")
        lines.append(f"author: {self.author}")

        if self.category:
            lines.append(f"category: {self._yaml_str(self.category)}")

        if self.tags:
            tag_str = ", ".join(f'"{t}"' for t in self.tags)
            lines.append(f"tags: [{tag_str}]")

        lines.append("---")
        return "\n".join(lines)

    @staticmethod
    def _yaml_str(value: str) -> str:
        """Format a string value for YAML."""
        if "\n" in value:
            return f'"{value}"'
        return value


@dataclass
class SkillMetadata:
    """Metadata written alongside imported skills."""

    name: str
    version: str
    category: str
    source: str = "ecc"
    source_repo: str = "affaan-m/ECC"
    source_branch: str = "v2.0.0"
    source_path: str = ""
    imported_at: str = ""
    source_hash: str = ""
    adapter_version: str = "1.0.0"

    def to_json(self) -> str:
        """Serialize to JSON."""
        if not self.imported_at:
            self.imported_at = datetime.now(timezone.utc).isoformat()
        return json.dumps(asdict(self), indent=2)


@dataclass
class ImportedSkill:
    """Complete imported skill with both frontmatter and content."""

    name: str
    frontmatter: HermesFrontmatter
    content: str
    metadata: SkillMetadata

    def to_markdown(self) -> str:
        """Render complete SKILL.md file."""
        header = self.frontmatter.to_yaml()
        return f"{header}\n\n{self.content}"


def map_category(skill_name: str) -> str:
    """Map an ECC skill name to a Hermes category.

    Args:
        skill_name: Name of the ECC skill.

    Returns:
        Hermes-compatible category string.
    """
    return CATEGORY_MAP.get(skill_name, "engineering")


def extract_tags(description: str, skill_name: str) -> list[str]:
    """Extract search tags from skill description.

    Args:
        description: Skill description text.
        skill_name: Skill name for additional context.

    Returns:
        List of tag strings.
    """
    # Always include the skill name as a tag
    tags = [skill_name]

    # Extract keywords from description
    keyword_map = {
        "security": ["security", "auth", "password", "encryption"],
        "testing": ["test", "testing", "tdd", "coverage", "unit", "integration", "e2e"],
        "research": ["research", "search", "web", "investigate"],
        "design": ["design", "ui", "frontend", "react", "component"],
        "backend": ["backend", "api", "database", "server", "endpoint"],
        "devops": ["devops", "docker", "kubernetes", "deploy", "k8s"],
        "operations": ["operations", "workflow", "process", "automation"],
        "content": ["content", "writing", "documentation", "article"],
    }

    desc_lower = description.lower()
    for tag, keywords in keyword_map.items():
        if any(k in desc_lower for k in keywords):
            tags.append(tag)
            break

    return tags


def adapt_skill(skill: EccSkillFile) -> ImportedSkill:
    """Transform an ECC skill to Hermes-compatible format.

    This is the core migration function that handles all field differences:
    - Maps `origin` → `author`
    - Adds `version` (1.0.0 for all imported skills)
    - Derives `category` from skill name
    - Extracts `tags` from description
    - Strips ECC-specific fields (`allowed-tools`, `origin`)

    Args:
        skill: Parsed ECC skill file.

    Returns:
        Hermes-compatible ImportedSkill.
    """
    name = skill.frontmatter.name

    # Build Hermes frontmatter
    category = map_category(name)
    tags = extract_tags(skill.frontmatter.description, name)

    frontmatter = HermesFrontmatter(
        name=name,
        description=skill.frontmatter.description,
        version="1.0.0",
        author="ecc",
        category=category,
        tags=tags,
    )

    # Build metadata
    metadata = SkillMetadata(
        name=name,
        version="1.0.0",
        category=category,
        source_path=skill.frontmatter.source_path,
        source_hash=skill.frontmatter.source_hash,
    )

    # Enhance content with source attribution if not present
    content = skill.content
    if "ECC" not in content and "affaan-m" not in content:
        # Add source attribution after the H1 title
        content = re.sub(
            r"^(#\s+.*?)(\n|$)",
            f"\\1\n\n**Source:** ECC (affaan-m/ECC) — Imported by Hermes Agent (LAT-286)\n"
            f"**Version:** 1.0.0\n"
            f"**Imported:** {datetime.now(timezone.utc).strftime('%Y-%m-%d')}\n",
            content,
            count=1,
            flags=re.MULTILINE,
        )

    return ImportedSkill(
        name=name,
        frontmatter=frontmatter,
        content=content,
        metadata=metadata,
    )


def is_idempotent(
    skill_name: str,
    target_dir: Path,
    adapter_version: str = "1.0.0",
    source_hash: str = "",
) -> bool:
    """Check if a skill is already imported with the same version.

    An import is idempotent if:
    - A METADATA.json exists for this skill
    - The source_hash matches (same ECC content)
    - The adapter_version matches (same migration logic)

    Args:
        skill_name: Name of the skill.
        target_dir: Target directory path (~/.hermes/skills/ecc/).
        adapter_version: Current adapter version.
        source_hash: Content hash of the source ECC skill.

    Returns:
        True if the skill can be skipped (already imported).
    """
    metadata_path = target_dir / skill_name / "METADATA.json"
    if not metadata_path.exists():
        return False

    try:
        existing = json.loads(metadata_path.read_text())
        # Idempotent if same source hash and adapter version
        if existing.get("source_hash") == source_hash and existing.get("adapter_version") == adapter_version:
            return True
        # If adapter changed, we should update (not idempotent)
        if existing.get("adapter_version") != adapter_version:
            return False
        # If source hash matches but adapter is same, skip
        return existing.get("source_hash") == source_hash
    except (json.JSONDecodeError, KeyError):
        return False
