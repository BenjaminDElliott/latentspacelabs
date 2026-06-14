"""CLI entry point for the ECC skill import pipeline.

Usage:
    ecc-import import              # Import curated skills to ~/.hermes/skills/ecc/
    ecc-import import --dry-run    # Preview without writing
    ecc-import import --skill NAME  # Import a single skill
    ecc-import list                # List available ECC skills
    ecc-import verify              # Verify existing imports
    ecc-import audit               # Show compatibility audit summary
"""

import argparse
import logging
import sys
from pathlib import Path

from . import __version__
from .pipeline import import_all, list_available_skills, verify_import


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the CLI."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def cmd_import(args: argparse.Namespace) -> int:
    """Handle the 'import' command."""
    target_dir = Path(args.target) if args.target else None

    # Build skill filter
    skills_filter = None
    if args.skill:
        skills_filter = args.skill.split(",")
        logging.info("Importing specific skills: %s", skills_filter)

    report = import_all(
        target_dir=target_dir,
        skills_filter=skills_filter,
        dry_run=args.dry_run,
        skip_existing=not args.force,
    )

    print(report.summary())
    return 1 if not report.success else 0


def cmd_list(args: argparse.Namespace) -> int:
    """Handle the 'list' command."""
    skills = list_available_skills()
    if not skills:
        print("No ECC skills found. Check GitHub connectivity.")
        return 1

    print(f"Available ECC skills ({len(skills)} total):")
    for skill in skills:
        print(f"  - {skill}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Handle the 'verify' command."""
    target_dir = Path(args.target) if args.target else None
    valid = verify_import(target_dir)
    return 0 if valid else 1


def cmd_audit(args: argparse.Namespace) -> int:
    """Handle the 'audit' command."""
    from pathlib import Path as P

    audit_doc = P(__file__).parents[3] / "docs" / "ecc-compatibility-audit.md"
    if audit_doc.exists():
        print(f"Full audit: {audit_doc}")
        print()
        content = audit_doc.read_text()
        # Show summary (first 30 lines)
        for line in content.split("\n")[:30]:
            print(line)
        print("\n... (see full doc for complete analysis)")
    else:
        print("Audit document not found.")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="ecc-import",
        description="ECC (affaan-m/ECC) skill import pipeline for Hermes Agent",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    parser.add_argument(
        "-t", "--target",
        help="Target directory (default: ~/.hermes/skills/ecc/)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # import
    import_parser = subparsers.add_parser("import", help="Import ECC skills")
    import_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview imports without writing",
    )
    import_parser.add_argument(
        "--force",
        action="store_true",
        help="Re-import even if already present with same hash",
    )
    import_parser.add_argument(
        "--skill",
        help="Import specific skill(s), comma-separated",
    )
    import_parser.set_defaults(func=cmd_import)

    # list
    list_parser = subparsers.add_parser("list", help="List available ECC skills")
    list_parser.set_defaults(func=cmd_list)

    # verify
    verify_parser = subparsers.add_parser("verify", help="Verify existing imports")
    verify_parser.set_defaults(func=cmd_verify)

    # audit
    audit_parser = subparsers.add_parser("audit", help="Show compatibility audit summary")
    audit_parser.set_defaults(func=cmd_audit)

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 1

    setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
