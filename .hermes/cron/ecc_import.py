#!/usr/bin/env python3
"""
ECC Skill Import Pipeline (LAT-295)

Fetches curated skills from the ECC (Agent Harness) repository on GitHub,
adapts them to Hermes Agent skill format, and writes them to
~/.hermes/skills/ecc/ with idempotent deduplication.

Usage:
    python3 ecc_import.py              # Run import with defaults
    python3 ecc_import.py --dry-run    # Show what would be imported
    python3 ecc_import.py --skills NAME1,NAME2  # Override curated list
"""

from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# GitHub: source ECC repository
ECC_REPO_OWNER = "affaan-m"
ECC_REPO_NAME = "ECC"
ECC_BRANCH = "main"
ECC_API_URL = (
    f"https://api.github.com/repos/{ECC_REPO_OWNER}/{ECC_REPO_NAME}/contents/skills"
)

# Output namespace in Hermes Agent
HERMES_SKILLS_DIR = Path.home() / ".hermes" / "skills" / "ecc"

# Curated initial subset (LAT-295 acceptance criteria)
DEFAULT_CURATED_SKILLS = [
    "security-review",
    "verification-loop",
    "eval-harness",
    "coding-standards",
    "strategic-compact",
    "deep-research",
]

# GitHub token for higher rate limits (optional)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class SkillFile:
    """A single file entry returned from the GitHub API."""

    name: str
    path: str
    sha: str
    size: int
    url: str
    download_url: str  # raw content URL


@dataclass
class SkillEntry:
    """A skill after fetching its SKILL.md content."""

    name: str
    description: str = ""
    version: str = "1.0.0"
    category: str = "ecc"
    origin: str = "ECC"
    raw_content: str = ""
    git_sha: str = ""


# ---------------------------------------------------------------------------
# YAML frontmatter parser (stdlib only, no PyYAML dependency)
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)", re.DOTALL)
_YAML_PAIR_RE = re.compile(r"^(\w[\w-]*):\s*(.*)$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Parse YAML frontmatter from a Markdown document.

    Returns (fields_dict, body_without_frontmatter).
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


def serialize_frontmatter(fields: dict[str, str]) -> str:
    """Render YAML frontmatter block."""
    lines = ["---"]
    for key, value in sorted(fields.items()):
        if any(c in value for c in ":#{}[]&*?|->!%@`") or value == "":
            lines.append(f'{key}: "{value}"')
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------


def _api_request(url: str) -> Any:
    """Make a GET request to the GitHub API and return parsed JSON."""
    req = urllib.request.Request(url)
    if GITHUB_TOKEN:
        req.add_header("Authorization", f"token {GITHUB_TOKEN}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "HermesECCImport/1.0")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403 and "rate limit" in exc.read().decode().lower():
            print("WARNING: GitHub API rate limit hit. Continuing with partial results.")
            return []
        raise


def list_skill_directories() -> list[SkillFile]:
    """List all skill directories in the ECC repository."""
    result = _api_request(ECC_API_URL)
    if not isinstance(result, list):
        return []

    skills: list[SkillFile] = []
    for entry in result:
        if entry.get("type") == "dir":
            skills.append(
                SkillFile(
                    name=entry["name"],
                    path=entry["path"],
                    sha=entry["sha"],
                    size=entry.get("size", 0),
                    url=entry["url"],
                    download_url=entry.get("download_url", ""),
                )
            )
    return skills


def fetch_skill_content(skill_dir: SkillFile) -> SkillEntry | None:
    """Fetch SKILL.md for a given skill directory."""
    sk_url = f"{ECC_API_URL}/{skill_dir.name}/SKILL.md"
    try:
        data = _api_request(sk_url)
    except (urllib.error.HTTPError, json.JSONDecodeError):
        return None

    if not isinstance(data, dict):
        return None

    raw_b64 = data.get("content", "")
    raw_bytes = base64.b64decode(raw_b64) if raw_b64 else b""
    raw_text = raw_bytes.decode("utf-8", errors="replace")

    fields, _body = parse_frontmatter(raw_text)

    return SkillEntry(
        name=fields.get("name", skill_dir.name),
        description=fields.get("description", ""),
        version=fields.get("version", "1.0.0"),
        category=fields.get("category", "ecc"),
        origin=fields.get("origin", "ECC"),
        raw_content=raw_text,
        git_sha=skill_dir.sha,
    )


# ---------------------------------------------------------------------------
# Adapter: ECC -> Hermes format
# ---------------------------------------------------------------------------


def adapt_skill(ecc_skill: SkillEntry) -> str:
    """Convert an ECC SKILL.md to Hermes-compatible format.

    Strategy:
    - Preserve the original content (ECC skills are largely compatible).
    - Add Hermes-specific metadata in frontmatter if missing.
    - Append a "Hermes Adaptation" note for traceability.
    """
    fields, body = parse_frontmatter(ecc_skill.raw_content)

    # Map fields
    fields.setdefault("name", ecc_skill.name)
    fields.setdefault("origin", "ECC")
    fields.setdefault("version", "1.0.0")
    fields.setdefault("category", "ecc")

    if not fields.get("description"):
        # Derive description from title if missing
        title_match = re.search(r"#\s+(.+)", body)
        if title_match:
            fields["description"] = title_match.group(1)
        else:
            fields["description"] = f"Imported ECC skill: {ecc_skill.name}"

    # Append adaptation note
    adapter_note = (
        f"\n\n---\n\n"
        f"**Hermes Adaptation** (imported from ECC {ecc_skill.git_sha[:7]})\n"
        f"*Auto-converted for Hermes Agent. "
        f"Original: https://github.com/{ECC_REPO_OWNER}/{ECC_REPO_NAME}/tree/{ECC_BRANCH}/skills/{ecc_skill.name}*\n"
    )
    body = body.rstrip() + adapter_note

    frontmatter = serialize_frontmatter(fields)
    return f"{frontmatter}\n\n{body}"


# ---------------------------------------------------------------------------
# Installer: write with idempotent deduplication
# ---------------------------------------------------------------------------


def compute_skill_hash(content: str) -> str:
    """Compute a SHA-256 hash of skill content for change detection."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def write_skill(skill: SkillEntry, dest: Path, dry_run: bool = False) -> bool:
    """Write a skill to the ecc namespace. Returns True if content changed.

    Idempotency: reads existing file, compares hash, skips if identical.
    """
    dest.mkdir(parents=True, exist_ok=True)
    skill_file = dest / "SKILL.md"

    if skill_file.exists() and not dry_run:
        existing = skill_file.read_text(encoding="utf-8")
        existing_hash = compute_skill_hash(existing)
        new_hash = compute_skill_hash(skill.raw_content)
        if existing_hash == new_hash:
            print(f"  SKIP (unchanged): {skill.name}")
            return False

    if dry_run:
        print(f"  DRY-RUN would write: {skill.name}")
        return True

    skill_file.write_text(skill.raw_content, encoding="utf-8")
    print(f"  WRITTEN: {skill.name} -> {dest}")
    return True


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    """Result of validating a skill file."""

    name: str
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_skill_file(path: Path) -> ValidationResult:
    """Validate a SKILL.md file for required Hermes fields."""
    errors: list[str] = []
    warnings: list[str] = []
    name = path.name

    if not path.exists():
        return ValidationResult(
            name=name, valid=False, errors=[f"File does not exist: {path}"]
        )

    content = path.read_text(encoding="utf-8")

    # Check frontmatter exists
    if not content.strip().startswith("---"):
        errors.append("Missing YAML frontmatter (---)")
        return ValidationResult(name=name, valid=False, errors=errors)

    fields, body = parse_frontmatter(content)

    # Required fields
    if "name" not in fields:
        errors.append("Missing 'name' field in frontmatter")
    if "description" not in fields:
        errors.append("Missing 'description' field in frontmatter")

    # Content should not be empty
    if not body.strip():
        errors.append("Skill body content is empty after frontmatter")

    # Warnings
    if "version" not in fields:
        warnings.append("No 'version' field - defaults to 1.0.0")
    if "category" not in fields:
        warnings.append("No 'category' field - defaults to 'ecc'")

    return ValidationResult(
        name=name, valid=len(errors) == 0, errors=errors, warnings=warnings
    )


def validate_all_skills(skills_dir: Path) -> list[ValidationResult]:
    """Validate all skills in the ecc namespace."""
    results: list[ValidationResult] = []
    if not skills_dir.exists():
        return [
            ValidationResult(
                name="ecc", valid=False, errors=["Directory does not exist"]
            )
        ]

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        results.append(validate_skill_file(skill_md))

    return results


# ---------------------------------------------------------------------------
# Main import pipeline
# ---------------------------------------------------------------------------


def run_import(
    curated_names: list[str] | None = None,
    dry_run: bool = False,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """Execute the full ECC skill import pipeline.

    Returns a summary dict with counts and any errors.
    """
    skills_dir = output_dir or HERMES_SKILLS_DIR
    curated = curated_names or DEFAULT_CURATED_SKILLS

    summary: dict[str, Any] = {
        "curated": curated,
        "imported": [],
        "skipped": [],
        "errors": [],
        "validation_results": [],
        "timestamp": datetime.datetime.utcnow().isoformat(),
    }

    print(f"=== ECC Skill Import Pipeline (LAT-295) ===")
    print(f"  Curated skills: {', '.join(curated)}")
    print(f"  Output directory: {skills_dir}")
    print(f"  Dry run: {dry_run}")
    print()

    # Step 1: List all ECC skill directories
    print("[1/4] Fetching ECC skill directory listing...")
    try:
        all_skills = list_skill_directories()
        available_names = {s.name for s in all_skills}
    except Exception as exc:
        summary["errors"].append(f"Failed to list skills: {exc}")
        print(f"  ERROR: {exc}")
        return summary

    print(f"  Found {len(all_skills)} ECC skill directories on GitHub")

    # Step 2: Filter to curated subset
    print("[2/4] Filtering to curated subset...")
    missing = [s for s in curated if s not in available_names]
    if missing:
        print(
            f"  WARNING: {len(missing)} skills not found in ECC repo: {', '.join(missing)}"
        )
        summary["errors"].extend([f"Skill not found in ECC repo: {s}" for s in missing])
    target_skills = [s for s in curated if s in available_names]
    print(f"  Target: {len(target_skills)} of {len(curated)} skills")

    # Step 3: Fetch and adapt each skill
    print("[3/4] Fetching and adapting skills...")
    for skill_name in target_skills:
        skill_dir_entry = next((s for s in all_skills if s.name == skill_name), None)
        if skill_dir_entry is None:
            summary["errors"].append(f"Failed to find {skill_name}")
            print(f"  ERROR: Failed to find {skill_name}")
            continue

        try:
            entry = fetch_skill_content(skill_dir_entry)
            if entry is None:
                summary["errors"].append(f"Failed to fetch SKILL.md for {skill_name}")
                print(f"  ERROR: Failed to fetch {skill_name}")
                continue

            # Validate before writing
            vr = validate_skill_file(Path(f"tmp_{skill_name}.md"))
            adapted = adapt_skill(entry)

            # Write
            dest = skills_dir / skill_name
            if write_skill(entry, dest, dry_run=dry_run):
                # Validate after write
                vr = validate_skill_file(dest / "SKILL.md")
                if vr.valid:
                    summary["imported"].append(skill_name)
                else:
                    summary["errors"].extend([f"{skill_name}: {e}" for e in vr.errors])
            else:
                summary["skipped"].append(skill_name)

        except Exception as exc:
            summary["errors"].append(f"{skill_name}: {exc}")
            print(f"  ERROR: {skill_name} - {exc}")

    # Step 4: Final validation pass
    print("[4/4] Running final validation...")
    results = validate_all_skills(skills_dir)
    summary["validation_results"] = [
        {
            "name": r.name,
            "valid": r.valid,
            "errors": r.errors,
            "warnings": r.warnings,
        }
        for r in results
    ]

    valid_count = sum(1 for r in results if r.valid)
    print(f"  Validated: {valid_count}/{len(results)} skills pass validation")

    # Summary
    print()
    print(f"=== Import Summary ===")
    print(f"  Imported:  {len(summary['imported'])}")
    print(f"  Skipped:   {len(summary['skipped'])}")
    print(f"  Errors:    {len(summary['errors'])}")
    for err in summary["errors"]:
        print(f"    - {err}")

    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """CLI entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="ECC Skill Import Pipeline (LAT-295)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 ecc_import.py                          # Run full import\n"
            "  python3 ecc_import.py --dry-run                # Preview changes\n"
            "  python3 ecc_import.py --skills foo,bar         # Import specific skills\n"
            "  python3 ecc_import.py --output /custom/path    # Custom output directory\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be imported without writing files",
    )
    parser.add_argument(
        "--skills",
        type=str,
        default=None,
        help="Comma-separated list of skill names to import (overrides curated list)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Custom output directory (default: ~/.hermes/skills/ecc)",
    )

    args = parser.parse_args()

    # Parse skills override
    curated: list[str] | None = None
    if args.skills:
        curated = [s.strip() for s in args.skills.split(",") if s.strip()]

    # Custom output directory
    output_dir: Path | None = None
    if args.output:
        output_dir = Path(args.output)

    summary = run_import(
        curated_names=curated,
        dry_run=args.dry_run,
        output_dir=output_dir,
    )

    # Exit code: 0 on success, 1 on errors
    if summary["errors"]:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
