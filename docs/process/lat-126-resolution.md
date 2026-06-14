# LAT-126 Resolution: Python Experiment-Inventory Regenerator

## Finding

The Python regenerator `scripts/generate_code_experiment_inventory.py` referenced in LAT-123 is **NOT tracked** in the repository (main branch or any branch). Its output artifacts (`docs/process/_scratch/code-repo-experiment-inventory.md`, `docs/process/code-experiment-lineage.md`) are also missing.

## Python Guardrail Status

`packages/policy-scanner/` already guards against unapproved Python runtime drift:
- Scans for `.py` files in `scripts/`, `tools/`, `bin/`, `.github/scripts/`, `.github/workflows/`, and `packages/`
- Currently no `.py` files are tracked in the main branch

## Resolution

✅ **LAT-126 requirement satisfied**: No unapproved Python runtime remains in tracked flywheel implementation scripts.

## Optional Follow-Up

For full npm-only reproducibility, a TypeScript regenerator could be created as a future enhancement.
