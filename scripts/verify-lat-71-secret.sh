#!/usr/bin/env bash
# LAT-71 verification: confirm ANTHROPIC_API_KEY exists as a GitHub Actions repo secret.
#
# Usage: bash scripts/verify-lat-71-secret.sh
#
# Acceptance criteria:
#   - `gh secret list --repo BenjaminDElliott/latentspacelabs` shows ANTHROPIC_API_KEY by name only.
#   - No secret value appears in the output.

set -euo pipefail

REPO="BenjaminDElliott/latentspacelabs"

echo "=== LAT-71: GitHub Actions Secret Verification ==="
echo "Repository: $REPO"
echo

# List repo secrets and capture output
OUTPUT="$(gh secret list --repo "$REPO" 2>&1)" || {
  echo "FAIL: gh secret list exited non-zero"
  echo "$OUTPUT"
  exit 1
}

echo "Secret list output:"
echo "$OUTPUT"
echo

# Check ANTHROPIC_API_KEY appears by name
if echo "$OUTPUT" | grep -q '^ANTHROPIC_API_KEY	'; then
  echo "PASS: ANTHROPIC_API_KEY is present in GitHub Actions repo secrets."
else
  echo "FAIL: ANTHROPIC_API_KEY not found in GitHub Actions repo secrets."
  exit 1
fi

# Verify no value is exposed (all visible columns should be the name + timestamp)
VALUE_COLUMN=$(echo "$OUTPUT" | grep '^ANTHROPIC_API_KEY	' | awk '{print $3}')
if [ "$VALUE_COLUMN" = "" ] || [[ "$VALUE_COLUMN" == "20"* ]]; then
  echo "PASS: Secret value is not exposed (only name + timestamp visible)."
else
  echo "WARNING: Secret value appears in output: $VALUE_COLUMN"
fi

echo
echo "LAT-71 verification complete."
