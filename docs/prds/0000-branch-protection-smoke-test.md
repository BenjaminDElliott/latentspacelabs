---
prd_id: 0000-branch-protection-smoke-test
title: LAT-47 branch protection smoke test (INTENTIONALLY INVALID)
status: draft
owner: smoke-test
date: 2026-04-23
related_linear:
  - LAT-47
related_adrs: []
derived_from: []
supersedes: []
superseded_by: []
---

# Branch protection smoke test (DO NOT MERGE)

This file is an intentionally invalid PRD fixture used to verify that the
required `npm run check` gate blocks merges on the `main` branch.

The filename `0000-branch-protection-smoke-test.md` deliberately uses the
forbidden `NNNN-*.md` numeric prefix pattern, which the PRD validator in
`packages/prd-tools/src/validate.ts` rejects.

Remove this file and close the associated PR after the smoke test completes.
