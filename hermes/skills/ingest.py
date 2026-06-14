"""
Main skill ingestion pipeline (LAT-191).

Orchestrates the full Layer 1 ingestion pipeline:
1. Load configuration
2. Fetch skills from configured GitHub repos
3. Validate against agentskills.io spec
4. Apply trust-based sandboxing
5. Update skill registry
6. Write skills to disk

Usage:
    python3 -m hermes.skills.ingest          # Run full pipeline
    python3 -m hermes.skills.ingest --dry-run  # Preview only
    python3 -m hermes.skills.ingest --repo owner/repo  # Specific repo
    python3 -m hermes.skills.ingest --curated name1,name2  # Curated subset
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path
from typing import Any

from hermes.skills.config import (
    DEFAULT_REPOS,
    DEFAULT_TRUST_LEVEL,
    SkillSandboxConfig,
    TrustLevel,
    load_config,
)
from hermes.skills.fetcher import GitHubSkillFetcher, FetchResult, SkillEntry
from hermes.skills.registry import (
    SkillIndex,
    SkillMetadata,
    SkillTrustRecord,
    load_index,
    save_index,
)
from hermes.skills.sandbox import (
    SkillEntry as SandboxSkillEntry,
    apply_trust_sandbox,
    scan_vulnerabilities,
    calculate_vulnerability_rate,
    get_trust_level,
)
from hermes.skills.validator import SkillValidator


# ---------------------------------------------------------------------------
# Skill installation
# ---------------------------------------------------------------------------


def write_skill_to_disk(
    skill: SkillEntry,
    dest_base: Path,
    trust_level: str,
    dry_run: bool = False,
) -> bool:
    """Write a validated skill to the external layer.

    Creates:
    ~/.hermes/skills/layers/external/{skill_name}/SKILL.md

    Args:
        skill: The fetched skill entry.
        dest_base: Base directory for external skills.
        trust_level: Trust level for this skill.
        dry_run: If True, only show what would be written.

    Returns:
        True if the skill was written or would be written.
    """
    dest = dest_base / skill.name

    if dry_run:
        print(f"  [DRY-RUN] Would write skill: {skill.name} (trust: {trust_level})")
        return True

    dest.mkdir(parents=True, exist_ok=True)

    # Write SKILL.md
    skill_file = dest / "SKILL.md"
    existing_content = skill_file.read_text(encoding="utf-8") if skill_file.exists() else ""
    if existing_content == skill.raw_content:
        print(f"  SKIP (unchanged): {skill.name}")
        return False

    skill_file.write_text(skill.raw_content, encoding="utf-8")

    # Write trust level manifest
    trust_manifest = {
        "skill_name": skill.name,
        "trust_level": trust_level,
        "source_repo": f"{skill.repo_owner}/{skill.repo_name}",
        "git_sha": skill.git_sha,
        "ingested_at": datetime.datetime.utcnow().isoformat(),
    }
    manifest_file = dest / ".trust_manifest.json"
    manifest_file.write_text(json.dumps(trust_manifest, indent=2) + "\n", encoding="utf-8")

    print(f"  WRITTEN: {skill.name} -> {dest}")
    return True


def update_registry(
    index: SkillIndex,
    skill: SkillEntry,
    trust_level: str,
    vulnerability_score: float,
) -> None:
    """Update the skill registry with a new skill.

    Args:
        index: Current skill index.
        skill: The skill to add.
        trust_level: The assigned trust level.
        vulnerability_score: Computed vulnerability score.
    """
    metadata = SkillMetadata(
        name=skill.name,
        description=skill.description,
        version=skill.version,
        category=skill.category,
        origin=skill.origin,
        source_repo=f"{skill.repo_owner}/{skill.repo_name}",
        git_sha=skill.git_sha,
        trust_level=trust_level,
        file_path=f"layers/external/{skill.name}/SKILL.md",
        created_at=datetime.datetime.utcnow().isoformat(),
        updated_at=datetime.datetime.utcnow().isoformat(),
    )

    index.add_skill(metadata)

    # Update or create trust record
    trust_record = SkillTrustRecord(
        name=skill.name,
        trust_level=trust_level,
        vulnerability_score=vulnerability_score,
    )

    # Find existing record and merge stats
    for i, existing_record in enumerate(index.trust_records):
        if existing_record.name == skill.name:
            existing_record.trust_level = trust_level
            existing_record.vulnerability_score = vulnerability_score
            return

    index.trust_records.append(trust_record)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run_ingestion_pipeline(
    repos: list[Any] | None = None,
    curated: dict[str, list[str]] | None = None,
    dry_run: bool = False,
    trust_level: str | None = None,
    output_base: Path | None = None,
) -> dict[str, Any]:
    """Execute the full Layer 1 skill ingestion pipeline.

    Args:
        repos: Override repo list (uses config defaults if None).
        curated: Dict mapping repo name to curated skill list.
        dry_run: If True, preview without writing.
        trust_level: Override default trust level.
        output_base: Override output base directory.

    Returns:
        Pipeline summary with counts and details.
    """
    config = load_config()
    base_path = output_base or Path(config["registry"]["base_path"])
    trust_level = trust_level or DEFAULT_TRUST_LEVEL.value

    # Load current index
    index = load_index()

    # Repos to process
    repo_configs = repos or [
        type("RepoConfig", (), {
            "owner": r["owner"],
            "repo": r["repo"],
            "branch": r["branch"],
            "skills_path": r["skills_path"],
            "trust_level": r["trust_level"],
            "rate_limit_per_min": r["rate_limit_per_min"],
        })(r)
        for r in config["repos"]
    ]

    external_dir = base_path / "layers" / "external"
    external_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "dry_run": dry_run,
        "trust_level": trust_level,
        "repos_processed": 0,
        "total_skills_fetched": 0,
        "total_skills_valid": 0,
        "total_skills_invalid": 0,
        "total_skills_written": 0,
        "total_skills_skipped": 0,
        "vulnerability_findings": [],
        "repo_results": [],
        "errors": [],
    }

    print("=" * 60)
    print("  Hermes Skill Acquisition Pipeline (LAT-191)")
    print("  Layer 1: External Ingestion")
    print("=" * 60)
    print()
    print(f"  Trust level: {trust_level}")
    print(f"  Output base: {base_path}")
    print(f"  Dry run: {dry_run}")
    print(f"  Repos: {len(repo_configs)}")
    print()

    fetcher = GitHubSkillFetcher()

    for repo_config in repo_configs:
        print(f"--- Processing: {repo_config.owner}/{repo_config.repo} ---")

        # Build repo object
        from hermes.skills.config import ExternalSkillRepo
        repo = ExternalSkillRepo(
            owner=repo_config.owner,
            repo=repo_config.repo,
            branch=repo_config.branch,
            skills_path=repo_config.skills_path,
            trust_level=repo_config.trust_level,
            rate_limit_per_min=repo_config.rate_limit_per_min,
        )

        # Get curated list for this repo
        repo_key = f"{repo.owner}/{repo.repo}"
        curated_list = curated.get(repo_key) if curated else None

        # Fetch skills
        fetch_result = fetcher.fetch_all_skills(repo, curated_list)

        repo_summary: dict[str, Any] = {
            "repo": repo_key,
            "skills_fetched": fetch_result.skills_fetched,
            "skills_valid": fetch_result.skills_valid,
            "skills_invalid": fetch_result.skills_invalid,
            "errors": fetch_result.errors,
            "skills_written": 0,
            "skills_skipped": 0,
            "vulnerability_findings": [],
        }

        summary["repos_processed"] += 1
        summary["total_skills_fetched"] += fetch_result.skills_fetched

        # Process each skill
        for skill in fetch_result.skills:
            summary["total_skills_fetched"] += 1

            # Scan for vulnerabilities
            vuln_findings = scan_vulnerabilities(skill.raw_content)
            vuln_rate = calculate_vulnerability_rate(vuln_findings)
            summary["vulnerability_findings"].extend(vuln_findings)
            repo_summary["vulnerability_findings"].extend(vuln_findings)

            # Determine trust level
            if skill.validation_errors:
                summary["total_skills_invalid"] += 1
                repo_summary["skills_invalid"] += 1
                # Still write but with lower trust
                effective_trust = "intern"
            else:
                summary["total_skills_valid"] += 1
                repo_summary["skills_valid"] += 1
                effective_trust = trust_level

            # Update trust level based on vulnerability rate
            if vuln_rate > 0.261:
                effective_trust = "intern"
                summary["vulnerability_findings"].append({
                    "skill": skill.name,
                    "reason": f"Vulnerability rate {vuln_rate:.1%} exceeds community avg (26.1%)",
                })
            elif vuln_rate > 0.20:
                effective_trust = "junior"

            # Apply sandbox config
            sandbox_config = apply_trust_sandbox(
                SandboxSkillEntry(
                    name=skill.name,
                    trust_level=effective_trust,
                    vulnerability_score=vuln_rate,
                )
            )

            # Write to disk
            if write_skill_to_disk(
                skill, external_dir, effective_trust, dry_run=dry_run
            ):
                summary["total_skills_written"] += 1
                repo_summary["skills_written"] += 1
            else:
                summary["total_skills_skipped"] += 1
                repo_summary["skills_skipped"] += 1

            # Update registry (always, even on dry-run)
            update_registry(
                index,
                skill,
                effective_trust,
                vuln_rate,
            )

        summary["repo_results"].append(repo_summary)

        # Repo summary
        print()
        print(f"  Fetch: {fetch_result.skills_fetched} skills")
        print(f"  Valid: {fetch_result.skills_valid} | Invalid: {fetch_result.skills_invalid}")
        repo_vuln_count = sum(len(vf) for vf in repo_summary["vulnerability_findings"])
        print(f"  Vulnerabilities: {repo_vuln_count}")
        print()

    # Save registry
    if not dry_run:
        save_index(index)
        print(f"  Registry saved to {base_path / 'registry' / 'index.json'}")

    # Summary
    print("=" * 60)
    print("  Pipeline Summary")
    print("=" * 60)
    print(f"  Repos processed:   {summary['repos_processed']}")
    print(f"  Skills fetched:    {summary['total_skills_fetched']}")
    print(f"  Skills valid:      {summary['total_skills_valid']}")
    print(f"  Skills invalid:    {summary['total_skills_invalid']}")
    print(f"  Skills written:    {summary['total_skills_written']}")
    print(f"  Skills skipped:    {summary['total_skills_skipped']}")
    print(f"  Vulnerabilities:   {len(summary['vulnerability_findings'])}")

    # Calculate overall vulnerability rate
    unique_findings = len(set(
        (f.get("skill", "unknown"), f["pattern"])
        for f in summary["vulnerability_findings"]
        if isinstance(f, dict) and "pattern" in f
    ))
    overall_vuln_rate = unique_findings / max(summary["total_skills_written"], 1)
    print(f"  Overall vuln rate: {overall_vuln_rate:.1%}")
    print(f"  Target: <20% | Community avg: 26.1%")
    if overall_vuln_rate < 0.20:
        print(f"  Status: PASS (<20% vulnerability rate)")
    else:
        print(f"  Status: REVIEW (vulnerability rate above target)")

    if summary["errors"]:
        print()
        print("  Errors:")
        for err in summary["errors"]:
            print(f"    - {err}")

    print()
    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """CLI entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Hermes Skill Acquisition Pipeline - Layer 1: External Ingestion (LAT-191)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 -m hermes.skills.ingest                          # Full pipeline\n"
            "  python3 -m hermes.skills.ingest --dry-run                # Preview\n"
            "  python3 -m hermes.skills.ingest --repo affaan-m/ECC      # Specific repo\n"
            "  python3 -m hermes.skills.ingest --curated security-review\n"
            "  python3 -m hermes.skills.ingest --trust-level junior     # Override trust\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be ingested without writing files",
    )
    parser.add_argument(
        "--repo",
        type=str,
        action="append",
        metavar="OWNER/REPO",
        help="Process a specific repo (can be specified multiple times)",
    )
    parser.add_argument(
        "--curated",
        type=str,
        action="append",
        metavar="SKILL1,SKILL2",
        help="Curated skill list for the last --repo (comma-separated)",
    )
    parser.add_argument(
        "--trust-level",
        type=str,
        choices=["intern", "junior", "senior", "principal"],
        help="Override default trust level for ingested skills",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        help="Override output directory base path",
    )

    args = parser.parse_args()

    # Parse repos
    repos = None
    if args.repo:
        repos = []
        for repo_str in args.repo:
            parts = repo_str.split("/")
            if len(parts) == 2:
                repos.append({
                    "owner": parts[0],
                    "repo": parts[1],
                    "branch": "main",
                    "skills_path": "skills",
                    "trust_level": "intern",
                    "rate_limit_per_min": 30,
                })

    # Parse curated lists
    curated = None
    if args.curated and repos:
        curated = {}
        for i, repo in enumerate(repos):
            if i < len(args.curated):
                curated[f"{repo['owner']}/{repo['repo']}"] = args.curated[i].split(",")

    # Run pipeline
    summary = run_ingestion_pipeline(
        repos=repos,
        curated=curated,
        dry_run=args.dry_run,
        trust_level=args.trust_level,
        output_base=Path(args.output_dir) if args.output_dir else None,
    )

    # Exit code: non-zero if any errors
    sys.exit(1 if summary["total_skills_invalid"] > 0 or summary["errors"] else 0)


if __name__ == "__main__":
    main()
