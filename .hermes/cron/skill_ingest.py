#!/usr/bin/env python3
"""
Skill Ingestion Cron Job (LAT-191)

Runs the Layer 1 external skill ingestion pipeline on a schedule.
Fetched from configured GitHub repositories.

Usage:
    python3 skill_ingest.py              # Run full pipeline
    python3 skill_ingest.py --dry-run    # Preview only
    python3 skill_ingest.py --force      # Force re-ingestion (skip dedup)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add project root to path for hermes.skills imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from hermes.skills.ingest import run_ingestion_pipeline


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Skill Ingestion Cron Job (LAT-191)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 skill_ingest.py                          # Full pipeline\n"
            "  python3 skill_ingest.py --dry-run                # Preview\n"
            "  python3 skill_ingest.py --force                  # Force re-ingest\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without writing",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-ingestion (skip dedup)",
    )
    args = parser.parse_args()

    summary = run_ingestion_pipeline(dry_run=args.dry_run)

    # Exit code: non-zero on errors
    sys.exit(1 if summary["total_skills_invalid"] > 0 else 0)


if __name__ == "__main__":
    main()
