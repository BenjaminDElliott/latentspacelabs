---
id: ADR-0023
title: Run-record write strategy with branch protection
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-41
supersedes:
superseded_by:
revisit_trigger: Revisit when a second harness writes runs/ concurrently across forks, when the run-record volume exceeds ~200 runs/week making PR-per-run unworkable, or when a non-repo telemetry substrate is chosen.
---

# ADR-0023: Run-record write strategy with branch protection

> File name: `docs/decisions/0023-run-record-write-strategy.md` — zero-padded 4-digit sequence, lowercase, dashed.
> Keep ADRs short (a page or two). Link out to supporting detail rather than inlining it.

## Context

ADR-0014 chose repo-committed run records as the MVP persistence substrate: every agent run writes a `runs/<run_id>.md` + `runs/<run_id>.json` file pair into the `runs/` tree at the repo root. ADR-0014 explicitly deferred the branch-protection interaction:

> *"This ADR does not address how `runs/` interacts with branch protection or required reviewers. An implementation ticket for the run recorder must confirm that the branch into which run reports are committed does not require human review for each agent-committed file."*

The problem this ADR solves: the ICP run recorder must write durable `runs/` files without fighting GitHub branch protection rules, required review thresholds, or concurrent agent execution. The first run recorder cannot safely push directly into `main` if branch protection is enabled. The strategy must handle:

- **Branch protection:** `main` is protected (required status checks, at minimum). If enabled for required reviewers, the agent cannot force-push without a bypass token or writing to a non-protected branch.
- **PR review requirements:** The existing review workflow (ADR-0007, `thread-approved-merge-authority.md`) expects human review before merge. Run-record-only commits that require a review round add friction.
- **Concurrent agent execution:** Two agents running near-simultaneously may both produce run records. The strategy must define collision behavior (append to JSONL, per-file, or last-writer-wins).
- **Append-only durability:** Run records are immutable append-only evidence. Once committed, they should not be rewritten by a subsequent run (unless the prior run crashed and was swept).

## Decision Drivers

- **MVP compatibility with ADR-0014.** The `runs/` tree must remain the MVP canonical store. No new external substrate is introduced.
- **No review required for run-record-only PRs.** Ben should not need to review a PR that only adds `runs/<run_id>.{md,json}` files.
- **Branch-protection safe.** The strategy must work when `main` has required status checks and, optionally, required reviewers.
- **Concurrent-agent safe.** Two agents writing near the same time must not corrupt the `runs/` tree.
- **Linear write-back URL must resolve.** The run report URL in the Linear five-element write-back (ADR-0003) must be resolvable at the time the comment is posted.
- **Low friction, low cognitive load.** Ben should not need to click anything to accept run-record commits.
- **Reversible.** If the strategy proves wrong, it can be replaced by a new ADR without changing the run-report envelope or the Linear write-back contract.

## Considered Options

### 1. Dedicated branch for run records (`runs/` branch)

Every run-record commit goes to `runs/` or `main/runs/`, a dedicated branch that is not protected and does not require review. Run records accumulate here permanently. Linear write-back URLs resolve against this branch.

**Pros:**
- No branch-protection friction: `main`'s protections are irrelevant.
- No PR review needed for run-record commits.
- Concurrent agents can push to the same branch; conflicts only happen on the same `run_id` file, which is rare.
- Linear write-back URL always resolves (the branch exists and the file is committed).

**Cons:**
- Run records live on a branch, not `main`. If someone clones `main`, they do not see run records.
- The `runs/` branch accumulates commits — it is a linear history of run reports. This is intentional for MVP but could grow long.
- Linear write-back URLs must point at `runs/branch` rather than `main` — a minor convention change.
- Requires a second git remote branch that Ben (or the harness) maintains.

### 2. PR-based writes with auto-approve (label-gated)

Each run opens a PR targeting `main` with the run record files. A GitHub label (e.g. `run-record`) on the PR triggers auto-merge via a workflow, or a pre-configured auto-approve bot applies the review. The PR must be small (one or two files) and unreviewable by humans.

**Pros:**
- Run records land on `main` directly.
- PR history of run records is visible in GitHub's UI.
- Existing branch protection (required checks) is satisfied.

**Cons:**
- Per-run PR opens a lot of noise: at pilot volume, this may be 10-50 PRs/day.
- Even with auto-approve, there is a brief window where the PR exists unmerged — the Linear write-back must wait.
- Concurrent runs on different PRs can merge independently; no conflict resolution needed (different files).
- Auto-approve requires either a bot user (GitHub Actions token or a dedicated bot) or a label-triggered workflow. Adds a small CI dependency.
- If required reviewers are enabled and no bypass exists, the label alone may not be enough — the bot must also hold a review role.

### 3. Squash-merge to main via a lightweight PR

Each run opens a PR targeting `main`. Ben configures the repo's squash-merge setting so that merging the PR creates a single squashed commit on `main`. The PR is auto-approved (via the same mechanism as option 2). This is essentially option 2 but with the explicit convention that squash-merge is used, so each run record is a single commit on `main`.

**Pros:**
- Same as option 2, plus: `main` history is cleaner (no PR merge noise, just squashed commits).
- Each run record is one clean commit on `main`.

**Cons:**
- Same as option 2, plus: if someone wants to review a run record's diff, squash merge means the history is flattened — they must view the PR diff.

### 4. External storage (separate repo, S3, or database)

Run records are written to an external location: a second repo (`latentspacelabs-runs/`), S3/GCS, or an in-repo `runs/` directory that is gitignored and written by the run recorder at runtime.

**Pros:**
- No branch-protection friction at all.
- No PR noise on the main repo.
- Scalable to any volume.

**Cons:**
- Violates ADR-0014's MVP-in constraint of one durable destination (the repo).
- Adds a second system to maintain for the MVP.
- Linear write-back URLs point to an external location — the evidence chain is no longer fully within one repo.
- Less reviewable for humans who are already in the repo.

### 5. Push directly to `main` with GitHub token (bypass or unprotected)

The run recorder pushes directly to `main` using a GitHub token that has write access. If branch protection allows force-push from the token's user or if `main` has no required-review rule (only required checks), this works seamlessly.

**Pros:**
- Simplest possible implementation: write file, commit, push to `main`.
- No PR, no extra branch, no external dependency.

**Cons:**
- Fails if `main` requires a review that the token's user cannot satisfy.
- Two concurrent runs on the same `run_id` will race on push; the second push may be rejected or overwrite the first.
- `main` history mixes code commits and run-record commits — not a structural problem but worth noting.
- Last-writer-wins on crash recovery: if run A's report is overwritten by run A's recovery, the history is correct (same `run_id`).

## Decision

**Accepted: Option 3 (squash-merge PRs to `main`), with Option 1 (dedicated `runs/` branch) as the fallback if `main` requires review and a review-bypass bot is not configured.**

The rationale is in the sections below.

### Primary strategy: PR-based writes with auto-approve, squash-merge to main

For MVP, the run recorder will:

1. Create a short-lived branch from `main` (e.g. `runs/rec-<run_id>`).
2. Write `runs/<run_id>.md` + `runs/<run_id>.json` to that branch.
3. Open a PR targeting `main` with the files.
4. The PR is labeled `run-record` + the Linear issue key (e.g. `LAT-41`).
5. A GitHub Actions workflow auto-approves and auto-squash-merges `run-record` PRs when all required status checks pass.
6. The Linear write-back comment posts the `main`-branch URL to the run report file.

**Auto-approve workflow:** A single GitHub Actions workflow in `.github/workflows/auto-merge-run-records.yml` watches for PRs with the `run-record` label. When a `run-record` PR is created (or updated), the workflow:
- Applies an approval from the GitHub Actions bot (`github-actions`).
- Squash-merges the PR if no required review from a human user is configured (only the `required-checks` rule on `main`).

If `main` has a required-review rule that requires a *human* user, the workflow checks that the `run-record` label is present and that the PR is small (≤ 5 changed files, ≤ 500 lines changed). If both conditions hold, the `github-actions` bot is granted a review (via the GitHub API), satisfying the reviewer requirement.

**Squash-merge convention:** The workflow uses `squash` merge, so each run record appears on `main` as a single commit. The commit message is `run: record <run_id> for LAT-NNN` (compact, searchable).

**Collision behavior for concurrent runs:** Each run writes to a unique `run_id`, so concurrent runs produce files in the same PR but different paths (e.g., `runs/run_a.json` and `runs/run_b.json`). No file-level conflict is possible. If the same `run_id` is written by two agents (e.g., a crash-recovery scenario), the second agent detects the file exists and either:
- Reads the existing file and appends its updated fields (last-writer-wins for `ended_at`, `status`).
- Opens its own PR with the recovered file (the old file on `main` is orphaned but still readable).

### Fallback strategy: dedicated `runs/` branch

If `main` has a required-review rule that cannot be auto-satisfied (e.g., a minimum of 1 human reviewer, `github-actions` does not count), the run recorder switches to the dedicated `runs/` branch strategy:

1. Create/update branch `runs/records` from `main`.
2. Write `runs/<run_id>.md` + `runs/<run_id>.json` to that branch.
3. Push to `runs/records` (no PR, no review required).
4. Linear write-back URL points at the `runs/records` branch: `https://github.com/<owner>/<repo>/blob/runs/records/runs/<run_id>.md`.

This is simpler than option 1 because there is only one branch (not a PR per run). It has the same pros/cons as option 1 but avoids the PR noise entirely.

### Why not Option 5 (direct push to main)?

Option 5 is the simplest possible path, and it would work if `main` only has required-checks protection (no required reviews). However, the MVP review workflow (ADR-0007, `thread-approved-merge-authority.md`) expects human review before merge. If `main` is protected with required reviewers, direct push will be rejected. Option 3 is safer because it works regardless of whether required checks or required reviewers are enabled — the PR mechanism satisfies both.

### Why not Option 4 (external storage)?

ADR-0014 chose the repo as the MVP persistence substrate. External storage is a valid long-term strategy but adds a system for the MVP. The `runs/` tree keeps all evidence in one place, which aligns with ADR-0014's principle that the repo is the durable source of truth. External storage is a candidate for the telemetry backend ADR that ADR-0014 defers.

## Implementation Steps

### Phase 1: GitHub workflow for auto-approve and auto-merge

1. Create `.github/workflows/auto-merge-run-records.yml` that:
   - Triggers on `pull_request` events.
   - Checks if the PR has the `run-record` label.
   - If yes, applies an approval via the GitHub API (`POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with `event: APPROVE`).
   - If yes and all status checks pass, squash-merges the PR (`POST /repos/{owner}/{repo}/pulls/{pull_number}/merge` with `merge_method: squash`).
   - Uses the `GITHUB_TOKEN` (which is granted write access to PRs and merge operations).

2. Create the `run-record` label (if it does not already exist):
   - Color: green (e.g., `#0e8a16`)
   - Description: "Auto-approve and auto-merge run-record PRs"

### Phase 2: Run recorder integration

1. After a run completes, the run recorder generates `runs/<run_id>.md` + `runs/<run_id>.json`.
2. The run recorder creates a new git branch from `main`.
3. Writes the two files to the branch and commits them.
4. Pushes the branch to the remote.
5. Opens a PR targeting `main` with:
   - Title: `run: record <run_id> for <LAT-NNN>`
   - Body: minimal — links to the Linear issue, states it contains run record files only.
   - Labels: `run-record`, the Linear issue key (`LAT-NNN`).
6. Waits for the workflow to auto-approve and auto-merge.
7. Posts the Linear write-back comment with the resolved URL to the committed file on `main`.

### Phase 3: Fallback branch strategy

1. Create a `runs/records` branch from `main` (or let the first run record PR create it via the fallback path).
2. The run recorder checks whether `main` has required-review protection. If it does and the auto-approve workflow cannot satisfy it, the recorder pushes to `runs/records` instead of opening a PR.
3. The Linear write-back URL points to `runs/records` branch.

### Phase 4: Collision handling

1. Before writing a run report, check if `runs/<run_id>.json` already exists in `main` (via a quick API call or clone).
2. If it exists, the run recorder either:
   - Updates the existing file and opens a new PR with the update (rare — same `run_id` from a crash-recovery).
   - Creates a new file with a suffix (e.g., `runs/<run_id>-recovered.json`) and notes the collision in the file metadata.
3. Different `run_id` values never collide because they write to different files.

### Phase 5: Preflight integration (LAT-35)

Update the coding-agent preflight (`docs/process/coding-agent-preflight.md`) to note:
- Run record files are committed via a separate PR or branch, not part of the agent's implementation PR.
- Run record commits do not trigger QA/review agents (they are evidence, not implementation).

## Consequences

Good:

- Run records land on `main` (or `runs/records`) without requiring human review — low friction.
- The strategy works with both required-checks-only and required-review branch protection.
- Each run record is a distinct, immutable commit on `main`.
- Linear write-back URLs resolve against `main` (the durable source of truth).
- Concurrent runs produce non-overlapping files — no file-level conflicts.
- The strategy is reversible: switch to dedicated branch or external storage with a new ADR.
- Auto-merge is opt-in via the `run-record` label — Ben can manually review a run-record PR by removing the label.

Bad / open:

- PR noise: at pilot volume, this may be 10-50 PRs/day. Each PR is trivially small but visible in GitHub's UI. Mitigated by squash-merge and the `run-record` label.
- The auto-approve workflow adds a small CI dependency. If the workflow fails (e.g., token permissions issue), run records fall back to the `runs/records` branch or remain in draft PR state until Ben manually merges.
- If `main` requires a *human* reviewer and the `github-actions` bot does not count, the fallback to `runs/records` branch is needed. This is a known contingency, not a failure mode.
- Run records on `main` mix with code commits. This is intentional — ADR-0014 considers the repo the source of truth for everything, including evidence.

## Confirmation

Working if, after the first few dispatch runs:

- Every run record appears on `main` (or `runs/records` branch) within 60 seconds of run completion.
- No run record PR requires a human review to merge (auto-approve works).
- Linear write-back URLs resolve to the committed run report file.
- Two concurrent runs produce two distinct, correctly committed run records with no corruption.
- The `runs/records` fallback branch works when `main` requires human reviewers.

Revisit if:
- Run-record PR volume exceeds ~100/day and becomes noisy.
- The auto-approve workflow fails consistently (>10% failure rate).
- A run record on `main` conflicts with a code commit (extremely unlikely with squash-merge, but possible if two agents commit to `main` simultaneously).

## Links

- Linear: `LAT-41` (this ADR), `LAT-18` (persistence substrate, ADR-0014), `LAT-35` (preflight guardrails), `LAT-47` (merge authority), `LAT-165` (run contract), `LAT-184` (evidence recording).
- Related ADRs: `0014-icp-state-persistence-and-telemetry.md` (chose repo-committed `runs/` tree as MVP), `0006-agent-run-visibility-schema.md` (run-report envelope), `0003-linear-persistence-boundary.md` (Linear write-back contract), `0007-qa-review-evidence-workflow.md` (review evidence), `0012-integration-control-plane-software-architecture.md` (run recorder component).
- Process: `coding-agent-preflight.md` (update to note run-record commit strategy), `operating-model.md` (PR ↔ Linear linking), `thread-approved-merge-authority.md` (merge after approval).
- Templates: `agent-run-report.md` (run-report envelope form).
