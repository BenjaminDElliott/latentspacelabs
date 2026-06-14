"""Curated ECC skill import pipeline.

Fetches ECC skills from GitHub, adapts them to Hermes format,
and installs them into ~/.hermes/skills/ecc/ namespace.

Supports idempotent re-runs: already-imported skills with matching
content hashes are skipped.
"""

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests

from .adapter import ImportedSkill, SkillMetadata, adapt_skill, is_idempotent
from .parser import EccSkillFile, parse_skill_from_url

logger = logging.getLogger(__name__)

# ECC repo configuration
ECC_REPO = "affaan-m/ECC"
ECC_BRANCH = "v2.0.0"
ECC_API_URL = f"https://api.github.com/repos/{ECC_REPO}/git/trees/{ECC_BRANCH}"
ECC_RAW_URL = f"https://raw.githubusercontent.com/{ECC_REPO}/{ECC_BRANCH}"

# Curated skill subset (PRD-specified + additional high-value)
CURATED_SKILLS: list[str] = [
    "coding-standards",
    "security-review",
    "verification-loop",
    "tdd-workflow",
    "eval-harness",
    "strategic-compact",
    "deep-research",
    "backend-patterns",
    "frontend-patterns",
    "api-design",
    "documentation-lookup",
    "e2e-testing",
    "hookify-rules",
    "mcp-server-patterns",
    "search-first",
    "error-handling",
]

# Additional skills that are safe to import (general engineering)
BONUS_SKILLS: list[str] = [
    "agent-sort",
    "context-budget",
    "continuous-learning",
    "continuous-learning-v2",
    "deployment-patterns",
    "database-migrations",
    "docker-patterns",
    "postgress-patterns",
]

# Combined import list
IMPORT_SKILLS: list[str] = CURATED_SKILLS + BONUS_SKILLS


@dataclass
class ImportResult:
    """Result of importing a single skill."""

    name: str
    status: str  # "imported", "skipped", "updated", "failed"
    error: Optional[str] = None
    source_hash: str = ""
    metadata_path: Optional[Path] = None


@dataclass
class ImportReport:
    """Aggregate report of an import run."""

    total_requested: int = 0
    total_skipped: int = 0
    total_imported: int = 0
    total_updated: int = 0
    total_failed: int = 0
    results: list[ImportResult] = field(default_factory=list)

    def add(self, result: ImportResult) -> None:
        self.results.append(result)

    @property
    def success(self) -> bool:
        return self.total_failed == 0

    def summary(self) -> str:
        lines = [
            f"ECC Import Report: {self.total_requested} requested",
            f"  Imported: {self.total_imported}",
            f"  Updated:  {self.total_updated}",
            f"  Skipped:  {self.total_skipped}",
            f"  Failed:   {self.total_failed}",
        ]
        if self.results:
            lines.append("")
            lines.append("Details:")
            for r in self.results:
                lines.append(f"  {r.name}: {r.status}" + (f" ({r.error})" if r.error else ""))
        return "\n".join(lines)


def fetch_skill_list() -> list[str]:
    """Fetch the list of available ECC skill names from GitHub.

    Returns:
        List of skill directory names (e.g., "security-review").
    """
    try:
        response = requests.get(
            ECC_API_URL,
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=30,
        )
        response.raise_for_status()
        tree = response.json().get("tree", [])
        # Only consider top-level skills/ directory (canonical)
        skill_dirs = set()
        for entry in tree:
            path = entry["path"]
            if path.startswith("skills/") and path.endswith("/SKILL.md"):
                skill_name = path[len("skills/"):-len("/SKILL.md")]
                skill_dirs.add(skill_name)
        return sorted(skill_dirs)
    except requests.RequestException as e:
        logger.warning("Failed to fetch ECC skill list: %s", e)
        return []


def fetch_skill_raw(skill_name: str) -> Optional[str]:
    """Fetch raw SKILL.md content for a skill from GitHub.

    Args:
        skill_name: Name of the ECC skill.

    Returns:
        Raw markdown content, or None on failure.
    """
    url = f"{ECC_RAW_URL}/skills/{skill_name}/SKILL.md"
    try:
        response = requests.get(url, timeout=30)
        if response.status_code == 404:
            logger.debug("Skill %s not found (404)", skill_name)
            return None
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        logger.warning("Failed to fetch %s: %s", skill_name, e)
        return None


def compute_content_hash(content: str) -> str:
    """Compute a SHA-256 hash of content for deduplication."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def import_skill(
    skill_name: str,
    target_dir: Path,
    dry_run: bool = False,
    skip_existing: bool = True,
) -> ImportResult:
    """Import a single ECC skill into Hermes namespace.

    Args:
        skill_name: Name of the ECC skill to import.
        target_dir: Target directory (e.g., ~/.hermes/skills/ecc/).
        dry_run: If True, don't write files.
        skip_existing: If True, skip skills already imported with same hash.

    Returns:
        ImportResult with status.
    """
    # Fetch raw content from GitHub
    raw_content = fetch_skill_raw(skill_name)
    if raw_content is None:
        return ImportResult(
            name=skill_name,
            status="failed",
            error="Skill not found on GitHub (404)",
        )

    # Parse ECC skill
    try:
        ecc_skill = parse_skill_from_url(raw_content, f"skills/{skill_name}/SKILL.md")
    except ValueError as e:
        return ImportResult(
            name=skill_name,
            status="failed",
            error=f"Parse error: {e}",
        )

    # Check idempotency
    if skip_existing and is_idempotent(
        skill_name, target_dir, adapter_version="1.0.0", source_hash=ecc_skill.frontmatter.source_hash
    ):
        logger.info("Skipping %s (already imported with same hash)", skill_name)
        return ImportResult(
            name=skill_name,
            status="skipped",
            source_hash=ecc_skill.frontmatter.source_hash,
            metadata_path=target_dir / skill_name / "METADATA.json",
        )

    # Adapt to Hermes format
    imported = adapt_skill(ecc_skill)

    if dry_run:
        return ImportResult(
            name=skill_name,
            status="skipped",  # Dry run counts as skipped
            source_hash=imported.metadata.source_hash,
        )

    # Write files
    skill_dir = target_dir / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Write SKILL.md
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(imported.to_markdown(), encoding="utf-8")

    # Write METADATA.json
    metadata_path = skill_dir / "METADATA.json"
    metadata_path.write_text(imported.metadata.to_json(), encoding="utf-8")

    status = "updated" if metadata_path.exists() and metadata_path.stat().st_mtime < skill_md.stat().st_mtime else "imported"

    return ImportResult(
        name=skill_name,
        status=status,
        source_hash=imported.metadata.source_hash,
        metadata_path=metadata_path,
    )


def import_all(
    target_dir: Optional[Path] = None,
    skills_filter: Optional[list[str]] = None,
    dry_run: bool = False,
    skip_existing: bool = True,
) -> ImportReport:
    """Import all curated ECC skills.

    Args:
        target_dir: Target directory (default: ~/.hermes/skills/ecc/).
        skills_filter: Specific skills to import (default: all curated).
        dry_run: If True, don't write files.
        skip_existing: If True, skip already-imported skills.

    Returns:
        ImportReport with aggregate results.
    """
    if target_dir is None:
        target_dir = Path.home() / ".hermes" / "skills" / "ecc"

    target_dir.mkdir(parents=True, exist_ok=True)

    filter_list = skills_filter or IMPORT_SKILLS
    report = ImportReport(total_requested=len(filter_list))

    for skill_name in filter_list:
        result = import_skill(
            skill_name=skill_name,
            target_dir=target_dir,
            dry_run=dry_run,
            skip_existing=skip_existing,
        )
        report.add(result)

        if result.status == "imported":
            report.total_imported += 1
        elif result.status == "updated":
            report.total_updated += 1
        elif result.status == "skipped":
            report.total_skipped += 1
        elif result.status == "failed":
            report.total_failed += 1

    logger.info(report.summary())
    return report


def list_available_skills() -> list[str]:
    """List all available ECC skills from GitHub.

    Returns:
        Sorted list of skill names.
    """
    return fetch_skill_list()


def verify_import(target_dir: Optional[Path] = None) -> bool:
    """Verify all imported skills have valid SKILL.md and METADATA.json.

    Args:
        target_dir: Target directory (default: ~/.hermes/skills/ecc/).

    Returns:
        True if all skills are valid.
    """
    if target_dir is None:
        target_dir = Path.home() / ".hermes" / "skills" / "ecc"

    if not target_dir.exists():
        print(f"No ECC skills directory found at {target_dir}")
        return False

    all_valid = True
    for skill_dir in sorted(target_dir.iterdir()):
        if not skill_dir.is_dir():
            continue

        skill_name = skill_dir.name
        skill_md = skill_dir / "SKILL.md"
        metadata_json = skill_dir / "METADATA.json"

        issues = []

        # Check SKILL.md
        if not skill_md.exists():
            issues.append("Missing SKILL.md")
        else:
            content = skill_md.read_text(encoding="utf-8")
            if not content.startswith("---"):
                issues.append("SKILL.md missing YAML frontmatter")

        # Check METADATA.json
        if not metadata_json.exists():
            issues.append("Missing METADATA.json")
        else:
            try:
                metadata = json.loads(metadata_json.read_text())
                if "name" not in metadata:
                    issues.append("METADATA.json missing 'name' field")
                if "source_hash" not in metadata:
                    issues.append("METADATA.json missing 'source_hash'")
            except json.JSONDecodeError as e:
                issues.append(f"METADATA.json invalid JSON: {e}")

        if issues:
            print(f"  {skill_name}: {'; '.join(issues)}")
            all_valid = False

    if all_valid:
        print(f"All {len(list(target_dir.iterdir()))} imported skills are valid.")
    else:
        print("Some skills have issues.")

    return all_valid
