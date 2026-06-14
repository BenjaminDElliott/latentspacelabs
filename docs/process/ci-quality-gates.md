# LAT-49: CI Quality Gates (Lint & Coverage)

## Overview

This repo uses GitHub Actions to run automated quality checks on every PR and push to `main`. Checks are split into **blocking** (must pass to merge) and **advisory** (informational) categories.

## Available local commands

| Command | Description |
|---|---|
| `npm run lint` | ESLint over all TypeScript source files in `packages/`. Errors fail the command; warnings are advisory. |
| `npm run typecheck` | `tsc --noEmit` across all workspaces. |
| `npm run build` | `tsc -p tsconfig.build.json` across all workspaces. |
| `npm run test` | Node.js test runner via `tsx --test` across all workspaces. |
| `npm run coverage` | `tsx --experimental-test-coverage --test` across all workspaces. Reports per-file line/branch/function coverage. |
| `npm run check` | Full local quality gate: lint → typecheck → build → ADR validation → PRD validation → policy scan → secret guard → coverage. |

## GitHub Actions checks

| Check name | Job | Status | Depends on |
|---|---|---|---|
| `typecheck` | Blocking | Required | — |
| `build` | Blocking | Required | typecheck |
| `tests` | Blocking | Required | build |
| `ADR validation` | Blocking | Required | — |
| `PRD validation` | Blocking | Required | — |
| `policy scan` | Blocking | Required | — |
| `secret guard` | Blocking | Required | — |
| `lint` | Advisory | Optional | — |
| `coverage` | Advisory | Optional | tests |

### Branch protection policy

- **Blocking checks** must pass for merge.
- **Advisory checks** (`lint`, `coverage`) show results but do not block merge. This is the MVP policy — advisory checks can be promoted to blocking later by selecting them in branch protection settings without changing the workflow.

### Check stability

Job names in `.github/workflows/check.yml` are stable identifiers (`lint`, `coverage`). Future branch protection configurations can reference these by name.

## Coverage policy (MVP)

Coverage is **report-only** in CI (continue-on-error). Each workspace produces a per-file coverage report showing line, branch, and function percentages. No hard threshold is enforced yet.

To set a minimum coverage threshold per workspace, add `--test-coverage-lines=<N>` to the `coverage` script in `package.json`:

```json
{
  "coverage": "tsx --experimental-test-coverage --test-coverage-lines=80 --test src/*.test.ts"
}
```

When a threshold is added, the coverage job will fail if coverage drops below the line.

## ESLint configuration

ESLint v10 (flat config) is configured at the workspace root (`eslint.config.js`). The config:

- Ignores `dist/`, `node_modules/`, and `.d.ts` files.
- Applies to all `*.ts` files.
- Test files (`*.test.ts`) have relaxed rules.
- Errors (fail lint): `consistent-type-imports`, `no-require-imports`, `no-duplicate-enum-values`, `prefer-const`.
- Warnings: `no-non-null-assertion`, `no-unused-vars`, `no-explicit-any`, `no-console`.

Fix auto-fixable issues: `npx eslint packages/ --fix`
