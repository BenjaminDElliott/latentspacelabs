#!/usr/bin/env python3
"""
ECC → Hermes SKILL.md Migration Adapter (LAT-294)

Handles field name mapping and format conversion when importing
ECC SKILL.md files into the Hermes Agent skill system.

Field Mapping:
    ECC field         → Hermes field          Notes
    ─────────────     ─────────────           ─────────────
    name              → name                  Identical semantics
    description       → description           Identical semantics
    allowed-tools     → allowed-tools         Format normalization needed
    category          → category              (ECC lacks this, derives from path)
    version           → version               (ECC lacks this, default 1.0.0)
    author            → author                (ECC lacks this, default "ecc")
    hidden            → hidden                (ECC lacks this, default false)

Usage:
    from ecc_migration_adapter import EccMigrationAdapter
    adapter = EccMigrationAdapter()
    converted = adapter.migrate(ecc_frontmatter, ecc_body, skill_path)
"""

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MigratedSkill:
    """A skill migrated from ECC format to Hermes format."""
    name: str
    description: str
    version: str = "1.0.0"
    author: str = "ecc"
    category: str = ""
    allowed_tools: str = ""
    hidden: bool = False
    body: str = ""
    original_path: str = ""
    skill_path: str = ""
    migration_warnings: list[str] = field(default_factory=list)


class EccMigrationAdapter:
    """Converts ECC SKILL.md frontmatter to Hermes SKILL.md format.

    The adapter:
    1. Maps known ECC fields to Hermes equivalents
    2. Fills in missing Hermes-required fields with defaults
    3. Normalizes format differences (e.g., allowed-tools syntax)
    4. Derives category from skill path when possible
    5. Tracks warnings for fields that couldn't be fully mapped
    """

    # Default values for missing fields
    DEFAULT_VERSION = "1.0.0"
    DEFAULT_AUTHOR = "ecc"
    DEFAULT_HIDDEN = False

    # Category derivation from skill path patterns
    CATEGORY_PATTERNS = [
        # .agents/skills/<category>/skill-name/
        (r"\.agents/skills/([^/]+)/", 1),
        # skills/<category>/skill-name/
        (r"skills/([^/]+)/", 1),
    ]

    # allowed-tools normalization: ECC uses "Read, Write, Edit, Bash, Grep, Glob"
    # Hermes uses "Bash(npx:*) Bash(npm:*)" format
    # We normalize by: splitting on commas, stripping whitespace
    TOOL_SPLIT_RE = re.compile(r",\s*")

    def migrate(
        self,
        frontmatter: dict,
        body: str = "",
        skill_path: str = "",
    ) -> MigratedSkill:
        """Migrate an ECC skill to Hermes format.

        Args:
            frontmatter: Dict of frontmatter key-value pairs from ECC SKILL.md
            body: The markdown body content after frontmatter
            skill_path: Original file path in ECC repo (for category derivation)

        Returns:
            MigratedSkill with Hermes-compatible fields
        """
        warnings = []

        # 1. Required fields (present in both formats)
        name = frontmatter.get("name", "")
        description = frontmatter.get("description", "")

        if not name:
            name = self._derive_name_from_path(skill_path)
            warnings.append(f"Deriving name from path: {skill_path}")

        if not description:
            warnings.append("No description provided; body will be used")
            description = body[:200]

        # 2. Optional fields with defaults (in Hermes but not ECC)
        version = frontmatter.get("version", self.DEFAULT_VERSION)
        author = frontmatter.get("author", self.DEFAULT_AUTHOR)
        hidden = self._parse_bool(frontmatter.get("hidden", ""))

        # 3. Category derivation from path
        category = frontmatter.get("category", "")
        if not category:
            category = self._derive_category(skill_path)
            if category:
                warnings.append(f"Derived category '{category}' from skill path")

        # 4. allowed-tools normalization
        allowed_tools = self._normalize_allowed_tools(frontmatter.get("allowed-tools", ""))

        return MigratedSkill(
            name=name,
            description=description,
            version=version,
            author=author,
            category=category,
            allowed_tools=allowed_tools,
            hidden=hidden,
            body=body,
            original_path=skill_path,
            migration_warnings=warnings,
        )

    def migrate_from_dict(self, skill_data: dict) -> MigratedSkill:
        """Migrate from a pre-parsed skill dict (e.g., from JSON).

        Args:
            skill_data: Dict with 'frontmatter', optionally 'body', 'skill_path'

        Returns:
            MigratedSkill
        """
        return self.migrate(
            frontmatter=skill_data.get("frontmatter", {}),
            body=skill_data.get("body", ""),
            skill_path=skill_data.get("skill_path", ""),
        )

    def to_hermes_frontmatter(self, migrated: MigratedSkill) -> str:
        """Generate Hermes-compatible YAML frontmatter string."""
        lines = ["---"]
        lines.append(f"name: {migrated.name}")
        if migrated.description:
            # Use > for multi-line descriptions to handle newlines
            desc = migrated.description.replace("\n", " ")
            lines.append(f"description: {desc}")
        if migrated.version:
            lines.append(f"version: {migrated.version}")
        if migrated.author:
            lines.append(f"author: {migrated.author}")
        if migrated.category:
            lines.append(f"category: {migrated.category}")
        if migrated.allowed_tools:
            lines.append(f"allowed-tools: {migrated.allowed_tools}")
        if migrated.hidden:
            lines.append(f"hidden: true")
        lines.append("---")
        return "\n".join(lines)

    def to_hermes_skill_file(self, migrated: MigratedSkill) -> str:
        """Generate a complete Hermes-compatible SKILL.md file string."""
        frontmatter = self.to_hermes_frontmatter(migrated)
        return f"{frontmatter}\n\n# {migrated.name}\n\n{migrated.body}"

    # --- Private helpers ---

    def _derive_name_from_path(self, skill_path: str) -> str:
        """Extract skill name from file path."""
        # e.g., ".agents/skills/agent-introspection-debugging/SKILL.md"
        match = re.search(r"SKILL\.md$", skill_path)
        if match:
            base = skill_path[: match.start()].rstrip("/")
            return base.split("/")[-1]
        return "unknown"

    def _derive_category(self, skill_path: str) -> str:
        """Derive category from skill path structure."""
        for pattern, group_idx in self.CATEGORY_PATTERNS:
            match = re.search(pattern, skill_path)
            if match:
                return match.group(group_idx)
        return ""

    def _normalize_allowed_tools(self, value: str) -> str:
        """Normalize allowed-tools format from ECC to Hermes.

        ECC format: "Read, Write, Edit, Bash, Grep, Glob"
        Hermes format: "Bash(npx:*) Bash(npm:*)" (space-separated patterns)

        We normalize by:
        - Splitting on commas
        - Stripping whitespace
        - Re-joining with spaces
        """
        if not value:
            return ""

        # Handle comma-separated format
        if "," in value:
            tools = [t.strip() for t in value.split(",") if t.strip()]
            return " ".join(tools)

        # Handle space-separated format (already in Hermes style)
        return value.strip()

    def _parse_bool(self, value: str) -> bool:
        """Parse a boolean string value."""
        if not value:
            return False
        return value.lower() in ("true", "1", "yes")

    def batch_migrate(
        self, skill_list: list[dict]
    ) -> list[MigratedSkill]:
        """Migrate multiple skills from a list of dicts.

        Args:
            skill_list: List of dicts with 'frontmatter', optionally 'body', 'skill_path'

        Returns:
            List of MigratedSkill objects
        """
        return [self.migrate_from_dict(s) for s in skill_list]
