#!/usr/bin/env python3
"""Demo: migrate a sample ECC skill to Hermes format."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from ecc_migration_adapter import EccMigrationAdapter

adapter = EccMigrationAdapter()

sample_ecc = {
    "frontmatter": {
        "name": "eval-harness",
        "description": "Evaluate agent outputs against golden datasets. Runs benchmark suites, compares outputs, generates scorecards.",
        "allowed-tools": "Read, Write, Edit, Bash, Grep, Glob",
    },
    "body": "# Eval Harness\n\nEvaluate agent outputs against golden datasets.\n\n## Steps\n\n1. Load the golden dataset\n2. Run the agent's output\n3. Compare outputs\n4. Generate scorecard",
    "skill_path": ".agents/skills/eval-harness/SKILL.md",
}

migrated = adapter.migrate_from_dict(sample_ecc)
print("=== Migrated Skill ===")
print(f"  name: {migrated.name}")
print(f"  description: {migrated.description[:60]}...")
print(f"  version: {migrated.version}")
print(f"  author: {migrated.author}")
print(f"  category: {migrated.category}")
print(f"  allowed_tools: {migrated.allowed_tools}")
print(f"  hidden: {migrated.hidden}")
print(f"  warnings: {migrated.migration_warnings}")
print()
print("=== Generated SKILL.md ===")
print(adapter.to_hermes_skill_file(migrated))
