# Branch Protection Policy

> **Ticket:** LAT-48
> **Related:** LAT-47 (thread-approved merge authority), LAT-38 (CI gates), parallel-merge-train.md
> **Status:** Draft
> **Created:** 2026-06-14

## 1. Purpose

This document defines the required GitHub checks for `main`, their blocking status, and how Perplexity / the ICP merge authority interacts with them. It ensures that the agentic merge cycle has a deterministic, checkable set of gates — and that Perplexity can decide when to merge and when to refuse based on observable CI state.

## 2. Required check set (MVP)

| # | Check name (GitHub status name) | Source | Blocking? | Description |
|---|---|---|---|---|
| C1 | `check / npm run check` | `.github/workflows/check.yml` | **Yes** | The canonical gate — runs typecheck, build, ADR validation, PRD validation, policy scan, secret-guard, and tests (see `package.json` `check` script). |
| C2 | `check / typecheck` | `packages/*` — `npm run typecheck` | **Yes** | Standalone TypeScript type-check across all packages. |
| C3 | `check / build` | `packages/*` — `npm run build` | **Yes** | Standalone build step across all packages. |
| C4 | `check / tests` | `packages/*` — `npm run test` | **Yes** | Standalone test run across all packages. |
| C5 | `check / ADR validation` | `packages/adr-tools` | **Yes** | Validates all ADR files in `docs/decisions/` against the ADR schema. |
| C6 | `check / PRD validation` | `packages/prd-tools` | **Yes** | Validates all PRD files in `docs/prds/` against the PRD schema. |
| C7 | `check / lint` | `packages/*` — `npm run lint` | **Advisory** | Linter output. Fails do not block merge but are flagged in the merge packet. |
| C8 | `check / coverage` | `packages/*` — coverage tool | **Advisory** | Code coverage threshold check. Fails do not block merge but are flagged. |

**Blocking checks (C1–C6):** If any blocking check is `failure` or `pending`, Perplexity **must refuse** the merge (unless an explicit override from Ben applies, see § 4).

**Advisory checks (C7–C8):** If these fail, Perplexity may still merge if Ben's approval is valid and all blocking checks pass, but the merge packet must flag the advisory failures.

## 3. Branch protection expectations for `main`

The following settings should be configured on the `main` branch in GitHub:

| Setting | Value | Rationale |
|---|---|---|
| Require a pull request before merging | **Yes** | Ensures every change to `main` goes through review. |
| Require approvals | **Yes** | At least 1 approval (Ben or thread-approved agent). |
| Dismiss stale PR approvals | **Yes** | New commits invalidate approvals (per LAT-47 § *What counts as approval*). |
| Require review from code owners | **No** (MVP) | Code owners file not yet in use; added in a later phase. |
| Require status checks to pass | **Yes** | All blocking checks (C1–C6) must be `success`. |
| Require branches to be up to date before merging | **Yes** | Forces rebase on `main` before merge. |
| Require conversation resolution | **Yes** | All review threads must be resolved. |
| Include administrators | **No** (MVP) | Ben retains ability to force-merge from the web UI; future ADR may enable for all. |
| Allow force pushes | **No** | Per `approval-gates-and-autonomy-rules.md`. |
| Allow deletions | **Yes** | Agent branches are deleted after merge (parallel-merge-train.md). |

### How checks map to GitHub branch protection

GitHub branch protection treats every job in a workflow that appears in the status list as a "required status check." The `check.yml` workflow produces a **single** check name: `check / npm run check`. For MVP, that single check is sufficient — it runs all sub-steps atomically.

In the next iteration (post-MVP), the workflow will be refactored into **separate named jobs** (C1–C8), each producing its own status check. Branch protection is then configured to require C1–C6 (blocking) and show C7–C8 (advisory). This is documented below in § 6.

## 4. Merge authority — handling missing checks

### 4.1 No checks configured (MVP fallback)

During the transition period before branch protection is fully configured, or for PRs opened before LAT-48 lands:

- **Perplexity requires at least one CI run.** If no CI has ever run on the PR, Perplexity refuses merge and triggers CI by pushing an empty commit or waiting for the author's commit.
- **If `check / npm run check` ran and passed**, Perplexity may merge (assuming other LAT-47 gates pass).
- **If `check / npm run check` is absent**, Perplexity waits for it rather than merging blind.

### 4.2 Failing required check

- Perplexity **refuses** the merge.
- Perplexity posts the refusal in the thread citing the failed check and gate number.
- If Ben replies with explicit override (e.g., "override C4, merge anyway"), Perplexity may merge **only if** the failing check is advisory (C7–C8) or if Ben's override explicitly names the check.
- For blocking checks (C1–C6), Ben must explicitly name the check to override (e.g., "override C5 — skip ADR validation for this PR").

### 4.3 Pending check

- If a required check is `pending` (still running), Perplexity **refuses** and waits.
- If the check has been running for >10 minutes, Perplexity may re-run CI via the GitHub Actions rerun API before refusing.

### 4.4 Missing check (never ran)

Treated the same as pending: Perplexity refuses and either waits for the check to start or triggers it (by pushing a commit).

## 5. When Perplexity must refuse merge despite thread approval

In addition to the LAT-47 ready-to-merge gate, Perplexity must refuse merge when:

| Condition | Action |
|---|---|
| Any blocking check (C1–C6) is `failure` | Refuse. Wait for fix + re-run. |
| Any blocking check (C1–C6) is `pending` | Refuse. Wait or re-run. |
| No required check has ever run | Refuse. Wait for CI. |
| PR targets a branch other than `main` | Refuse (unless ticket explicitly authorizes alternate base). |
| PR is a draft | Refuse. |
| Ben has an unresolved review thread on the PR | Refuse. |
| A `block-merge` or `needs-human` QA finding is unresolved | Refuse. |
| A Stop-category action is in the diff without explicit approval | Refuse. |
| Runaway-cost band active on the originating run | Refuse. |

Perplexity may merge despite advisory failures (C7–C8) if Ben approves and all blocking checks pass.

## 6. Post-MVP: Separate named check jobs

When LAT-48 is superseded, the `check.yml` workflow should be refactored to produce **separate named jobs** so branch protection can selectively require only the blocking ones. The refactored workflow would look like:

```yaml
# .github/workflows/check.yml (post-MVP structure)
jobs:
  typecheck:
    name: typecheck
    runs-on: ubuntu-latest
    steps: [...]  # npm run typecheck

  build:
    name: build
    runs-on: ubuntu-latest
    steps: [...]  # npm run build

  tests:
    name: tests
    runs-on: ubuntu-latest
    steps: [...]  # npm run test

  adr-validation:
    name: ADR validation
    runs-on: ubuntu-latest
    steps: [...]  # npm run validate:adrs

  prd-validation:
    name: PRD validation
    runs-on: ubuntu-latest
    steps: [...]  # npm run validate:prds

  lint:
    name: lint
    runs-on: ubuntu-latest
    steps: [...]  # npm run lint

  coverage:
    name: coverage
    runs-on: ubuntu-latest
    steps: [...]  # coverage threshold

  policy-scan:
    name: policy scan
    runs-on: ubuntu-latest
    steps: [...]  # npm run policy-scan

  secret-guard:
    name: secret guard
    runs-on: ubuntu-latest
    steps: [...]  # npm run secret-guard:tracked
```

Branch protection is then configured to require: **typecheck, build, tests, ADR validation, PRD validation, policy scan, secret guard** (blocking) and show: **lint, coverage** (advisory, not required).

## 7. Interaction with LAT-47 ready-to-merge gate

LAT-47 § *Ready-to-merge gate* defines G10 checks as part of its pre-merge checklist:

- **G4 (Required CI is green)** is satisfied by this policy: the `check / npm run check` check (C1) must be `success`, and all other required checks must be `success`.
- **G10 (Linear write-back plan present)** is satisfied when the agent has drafted the write-back comment before merging.

This policy does not replace LAT-47's gate; it **implements** G4. When LAT-47 and this policy disagree, this policy (and any ADR it cites) wins for CI-related decisions.

## 8. Acceptance criteria summary

| Criterion | How it is satisfied |
|---|---|
| PR with no required checks configured → policy says allowed during MVP or requires caution | § 4.1: Perplexity requires at least one CI run; if `check / npm run check` passed, merge is allowed. |
| Failing required check → Perplexity refuses unless Ben override and policy permits | § 4.2: Blocking checks refuse; advisory checks may be overridden. Ben's explicit override names the check. |
| Branch protection configured → required checks and approval gates aligned | § 3: Branch protection requires all blocking checks (C1–C6) plus PR approval and conversation resolution. |
