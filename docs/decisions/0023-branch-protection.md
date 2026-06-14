---
id: ADR-0023
title: Branch protection policy for agentic merge
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-48
supersedes:
superseded_by:
revisit_trigger: >-
  When a new check category is added, when advisory checks become blocking,
  or when a different merge tool replaces Perplexity/ICP.
---

# ADR-0023: Branch protection policy for agentic merge

> File name: `docs/decisions/0023-branch-protection.md`

## Context

The agentic merge cycle (LAT-47, LAT-45) requires a deterministic set of GitHub checks that Perplexity / the ICP may evaluate before merging an approved PR. Without a documented policy:

- Perplexity does not know which checks are safe to bypass and which are mandatory.
- Ben does not have a single reference for what "CI green" means at merge time.
- Branch protection on `main` is unconfigured or configured ad-hoc.
- When new checks are added (lint, coverage, policy scan), their role in the merge gate is undefined.

## Decision Drivers

1. **Determinism** — Perplexity must be able to read the policy and decide merge vs refuse without human interpretation.
2. **Safety-first** — During the pilot, missing CI is treated the same as failing CI.
3. **MVP pragmatism** — A single combined check (`check / npm run check`) is sufficient for MVP; separate named checks come in a post-MVP refactor.
4. **Advisory vs blocking** — Some checks (lint, coverage) are useful but not worth blocking a merge on during the pilot.
5. **Composability with LAT-47** — The policy must implement G4 (Required CI is green) from the ready-to-merge gate.

## Considered Options

### 1. Single combined check (chosen)

All guardrails run in one workflow job. GitHub sees one check: `check / npm run check`. Branch protection requires this single check.

**Pros:**
- Simplest MVP configuration.
- `check.yml` already exists and works.
- One check = one line in branch protection config.
- Atomic: if any sub-step fails, the whole check fails.

**Cons:**
- Cannot selectively require only sub-checks.
- Harder to see which specific sub-step failed in the PR UI (it's buried in the workflow logs).

### 2. Separate named check jobs

Each guardrail is its own GitHub Actions job with a distinct name. Branch protection requires each blocking job individually.

**Pros:**
- Fine-grained control: can require only typecheck, tests, build — not lint.
- PR UI shows each check individually.
- Easier to add/remove checks from branch protection.

**Cons:**
- More complex workflow configuration.
- Slower PR feedback (checks run in parallel but branch protection waits for all).
- Requires refactoring `check.yml` (post-MVP).

### 3. No required checks (MVP-only escape)

Branch protection is disabled entirely during the pilot; Perplexity runs checks locally before merging.

**Pros:**
- Zero CI configuration overhead.
- Fastest merge path.

**Cons:**
- Perplexity may merge without any CI verification.
- No GitHub-level safety net if Perplexity buggily merges a failing PR.
- Does not satisfy LAT-47 G4.

## Decision

**Chosen option: Option 1 (single combined check) for MVP, transitioning to Option 2 (separate named jobs) in post-MVP.**

### MVP policy

- **Blocking checks (merge-critical):** The single `check / npm run check` status. If it is `success`, all required sub-checks (typecheck, build, tests, ADR validation, PRD validation, policy scan, secret-guard) have passed.
- **Advisory checks (nice-to-have):** `lint` and `coverage` — not required by branch protection but reported in the merge packet.
- **Branch protection on `main`:** Require `check / npm run check` as a required status check.

### Post-MVP policy

- The `check.yml` workflow is refactored into separate named jobs (one per check).
- Branch protection is configured to require each blocking job individually.
- Advisory jobs are added to the PR status list but not required.

### Detailed check classification

| Check | Source | Blocking? |
|---|---|---|
| typecheck | `npm run typecheck` | Yes |
| build | `npm run build` | Yes |
| tests | `npm run test` | Yes |
| ADR validation | `npm run validate:adrs` | Yes |
| PRD validation | `npm run validate:prds` | Yes |
| policy scan | `npm run policy-scan` | Yes |
| secret guard | `npm run secret-guard:tracked` | Yes |
| lint | `npm run lint` | Advisory |
| coverage | coverage tool | Advisory |

### Perplexity merge authority rules

1. If any blocking check is `failure` → refuse merge.
2. If any blocking check is `pending` → refuse merge and wait.
3. If no blocking check has ever run → refuse merge and wait for CI.
4. If all blocking checks are `success` → merge is allowed (assuming other LAT-47 gates pass).
5. If advisory checks fail → merge is allowed unless Ben's approval includes a condition on them.
6. Ben may override a specific check with explicit thread approval naming the check.

## Consequences

### Good

- **Deterministic merge decisions.** Perplexity reads the policy and applies clear rules.
- **Safe by default.** No merge without CI verification.
- **Extensible.** Advisory checks can be promoted to blocking via a future ADR.
- **Single source of truth.** Branch protection config follows this policy.

### Bad / open

- **MVP coarseness.** The single combined check does not show per-sub-step status in the PR UI. Ben may need to click through to the workflow run to see which sub-step failed. This is acceptable for the pilot.
- **Lint and coverage gaps.** Advisory checks may pass silently, leaving bad code style or low coverage on `main`.
- **Post-MVP refactor cost.** The workflow refactoring to separate jobs requires a coordinated PR that touches CI configuration (Stop-category per ADR-0008).

## Confirmation

This decision is working when:

1. Every PR merged to `main` has a passing `check / npm run check` status.
2. Perplexity refuses merge when the check is failing or pending.
3. Ben can find, in the policy, which checks are blocking vs advisory.
4. Branch protection on `main` requires at least `check / npm run check`.

A revisit trigger fires when:
- A new check category is added (e.g., security scanning, performance benchmarks).
- Advisory checks need to become blocking (e.g., coverage drops below a critical threshold).
- A different merge tool replaces Perplexity/ICP.

## Links

- Related Linear issues: LAT-48 (branch protection policy), LAT-47 (merge authority), LAT-45 (merge train), LAT-38 (CI gates)
- Related process docs: [`thread-approved-merge-authority.md`](../process/thread-approved-merge-authority.md), [`parallel-merge-train.md`](../process/parallel-merge-train.md)
- Related ADRs: ADR-0001, ADR-0008, ADR-0018
- Supporting policy: [`docs/branch-protection-policy.md`](../branch-protection-policy.md)
