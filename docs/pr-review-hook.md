# LAT-50: Automated PR Review Agent Hook

> Design for the GitHub-side hook that runs an automated PR review agent and writes structured review evidence back to the PR and Linear.

## 1. Overview

The PR review hook is a lightweight, deterministic agent invocation that runs on every pull request in the repository. It:

1. Collects review inputs (diff, context, tickets, ADRs).
2. Runs an automated review (LLM-powered, via the ICP skill framework or a local model).
3. Produces structured outputs (findings, recommendation, evidence artifact).
4. Posts comments on the PR and writes back to the associated Linear ticket.

The hook does **not** grant merge authority. Merge remains Ben-approved per the operating model. The hook's recommendation feeds into the LAT-47 ready-to-merge gate.

## 2. Trigger Strategy

### Primary: GitHub Actions

A dedicated workflow file (`.github/workflows/pr-review-hook.yml`) is triggered on:

- `pull_request_target` events: `opened`, `synchronize`, `ready_for_review`, `reopened`

The `pull_request_target` trigger gives the workflow read access to secrets (e.g., Linear API token, GitHub PAT) and the correct HEAD commit even on fork PRs.

```yaml
on:
  pull_request_target:
    types: [opened, synchronize, ready_for_review, reopened]
```

**Why `pull_request_target` over `pull_request`:**
- Fork PRs can run the hook with write access (post comments, write Linear).
- The workflow gets the base repo's `main` for diff comparison.

**Why not webhook:** Webhooks give near-real-time triggers but require a long-lived runner. GitHub Actions are serverless, pay-per-use, and already used for `check.yml`.

**Why not scheduled poll:** Polling introduces lag (30s–5min). Most PR activity is synchronous with PR events.

**Why not ICP-invoked only:** ICP is the internal orchestrator. The hook must also run standalone (GitHub Actions) for PRs created by humans or external tools. ICP can call the hook as a skill.

### Secondary: ICP Skill Invocation

The hook can be invoked by ICP as a skill:

```json
{
  "skill": "pr-review-hook",
  "params": {
    "pr_url": "https://github.com/BenjaminDElliott/latentspacelabs/pull/NNN",
    "dry_run": false
  }
}
```

ICP calls the hook script directly (no GitHub Actions) when running inside a review run. The hook's output feeds into the ICP run report.

## 3. Review Inputs

### Required Inputs

| Input | Source | Description |
|---|---|---|
| PR URL | Trigger payload | GitHub PR URL or number + repo owner/name |
| PR diff | GitHub API | Unified diff of the PR (base → head) |
| PR metadata | GitHub API | Title, body, labels, assignees, reviewers, draft status |
| Base branch | PR metadata | Branch being targeted (must be `main` per LAT-47 G1) |
| Linked Linear ticket | PR title/body | `LAT-NN:` prefix parsed from title (required per operating model) |
| Changed files | PR API | List of file paths in the diff |
| PR description | PR API | Body text for context |

### Optional Inputs (fetched when available)

| Input | Source | Description |
|---|---|---|
| ADR context | `docs/decisions/` | All ADRs relevant to changed files (checked via ADR search on touched files) |
| PRD context | `docs/prds/` | PRDs linked to the Linear ticket |
| Pre-flight results | PR branch | Previous preflight report if present (LAT-35) |
| QA report | PR branch | QA report from the coding agent run (if separate agent was used) |
| Prior review history | GitHub API | Previous review comments on this PR (for context continuity) |

### Input Contract

All inputs are collected in a structured JSON payload before the review runs. The payload is the review's "envelope":

```json
{
  "run_id": "review_<sha1>_<timestamp>",
  "pr_url": "https://github.com/...",
  "repo": "BenjaminDElliott/latentspacelabs",
  "pr_number": 80,
  "base_ref": "main",
  "head_ref": "herman/LAT-50-pr-review-hook",
  "head_commit": "abc1234...",
  "linear_ticket": "LAT-50",
  "changed_files": ["docs/pr-review-hook.md", "packages/pr-review-hook/src/index.ts"],
  "pr_title": "LAT-50: Design automated PR review agent hook",
  "pr_body": "...",
  "is_draft": false,
  "preflight_results": { ... },
  "qa_report": { ... },
  "fetched_at": "2026-06-14T00:00:00Z"
}
```

## 4. Review Outputs

### Output Structure

The hook produces a structured JSON output (the evidence envelope) and a human-readable Markdown report:

```json
{
  "run_id": "review_<sha1>_<timestamp>",
  "timestamp": "2026-06-14T00:00:00Z",
  "pr_url": "https://github.com/...",
  "summary": "One-line summary of the review outcome.",
  "recommendation": "approve | approve-with-nits | request-changes | block-merge | needs-human",
  "findings": [
    {
      "id": "finding-001",
      "severity": "medium",
      "title": "Test coverage gap in migration rollback",
      "description": "The migration rollback path in `migrate.sh` has no corresponding test case.",
      "location": { "file": "packages/icp/src/migrate.sh", "line": 42 },
      "category": "test-coverage",
      "suggested_action": "Add a test that exercises the rollback path."
    }
  ],
  "inline_comments": [
    {
      "finding_id": "finding-001",
      "file": "packages/icp/src/migrate.sh",
      "line": 42,
      "body": "Missing test for rollback path. See finding #1."
    }
  ],
  "evidence_artifact": {
    "type": "markdown",
    "path": ".agent-runs/<run_id>/pr-review-report.md",
    "url": "https://github.com/.../blob/herman/LAT-50-pr-review-hook/.agent-runs/<run_id>/pr-review-report.md"
  },
  "linear_writeback": {
    "outcome": "request-changes — 1 medium finding on test coverage for migration rollback.",
    "evidence": "<PR URL> · <report URL> · <run report URL>",
    "risks": "medium x1 (migration rollback untested); cost band normal.",
    "next_action": "author adds rollback test, re-request review.",
    "open_questions": "none"
  },
  "merge_readiness": {
    "is_ready": false,
    "blocking_findings": ["finding-001"],
    "notes": "Medium finding requires fix or explicit acceptance."
  }
}
```

### Merge Readiness Policy

| Finding Severity | Merge Readiness Effect |
|---|---|
| `nit` | Does not affect readiness. |
| `low` | Does not affect readiness alone. Three+ `low` findings escalate to `medium` readiness impact. |
| `medium` | Sets `is_ready: false`; `blocking_findings` lists the finding IDs. Requires fix or explicit in-PR acceptance. |
| `high` | Sets `is_ready: false` with `requires_fix: true`; blocks merge until resolved. |
| `critical` | Sets `is_ready: false`; requires Ben approval in addition to fix. |

The `merge_readiness` section feeds directly into LAT-47's ready-to-merge gate (G7: "No unresolved hard-blocker / sequencing issue").

### Severity Ladder (repeated from ADR-0007)

| Severity | Meaning | Merge Posture |
|---|---|---|
| `nit` | Style, naming, minor clarity. No correctness impact. | Does not block. |
| `low` | Minor correctness, doc drift, small test gap. | Does not block alone. |
| `medium` | Real correctness, test coverage, or design concern. | Blocks `approve`; needs fix or acceptance. |
| `high` | Security, data-loss, architectural, or cost concern. | **Blocks merge.** |
| `critical` | Active breakage: exposed secret, broken migration, runaway cost. | **Blocks merge, requires Ben approval.** |

Enforcement rules (from ADR-0007):
- `high` or `critical` ⇒ cannot recommend `approve` or `approve-with-nits`.
- `critical` ⇒ always routes to `needs-human`.
- Security-sensitive surfaces: any non-trivial finding is at least `medium`.

## 5. Comment Posting Policy

### Auto-post (no human gate)

- **`nit` and `low` findings:** Posted as PR comments. Grouped into a single comment when possible.
- **`medium` findings:** Posted as a PR comment block with all medium findings. Each finding gets a file/line anchor when applicable.

### Hold for human review (flagged, not posted)

- **`high` findings:** Flagged in the Linear write-back. Posted as a PR comment with "🔴 HIGH: Blocks merge" header. Not auto-merged.
- **`critical` findings:** Posted as a PR comment with "🚨 CRITICAL: Blocks merge, requires Ben approval." Also written to Linear with a `Risks:` entry.

### Comment Traceability

Every automated comment includes the run ID as a prefix:

```
<!-- LAT-50 review run_id=review_abc123_20260614 -->
**Finding #1** (medium): Test coverage gap in migration rollback
...
```

The run ID appears in:
1. The comment HTML comment prefix.
2. The evidence artifact URL (`.agent-runs/<run_id>/`).
3. The Linear write-back `Evidence:` line.

This creates a traceable chain: PR comment → run ID → evidence artifact → Linear comment → Linear ticket.

## 6. Linear Write-back Format

Follows the ADR-0003 five-element contract with LAT-50 additions:

```md
**Outcome:** {recommendation} — {one-line reason}
**Evidence:** <PR URL> · <review report URL> · <QA report URL> · <run report URL>
**Risks:** {severity_label xN} ({summary}); cost band {normal | elevated | runaway_risk}
**PR:** <PR URL>
**Next action:** {single recommended next step}
**Open questions:** {blocking questions, or "none"}
```

**Additions for LAT-50:**
- **Run ID** — included in the Evidence line for traceability.
- **Merge readiness** — included as a separate section in the Linear comment when `is_ready: false`.

### Linear Write-back Example

```md
**Outcome:** request-changes — 2 medium findings on test coverage for migration rollback and error path handling.

**Evidence:** https://github.com/BenjaminDElliott/latentspacelabs/pull/80 · https://.../pr-review-report.md · https://.../run-id=review_abc123

**Risks:** medium x2 (migration rollback untested, error path swallows exceptions); cost band normal.

**PR:** https://github.com/BenjaminDElliott/latentspacelabs/pull/80

**Next action:** author adds rollback test and error path test, re-request review.

**Open questions:** none

**Merge readiness:** NOT READY — 2 medium findings require fix or explicit acceptance.
```

## 7. Interaction with LAT-35 (Preflight) and LAT-47 (Merge Authority)

### LAT-35: Coding-agent Preflight

The review hook reads LAT-35 preflight results from the PR branch (`.agent-runs/<run_id>/preflight.md`). If preflight is absent or failed:

- **Preflight failed:** The review runs anyway but flags the preflight failure as a `low` finding. The finding notes which preflight check failed and cites the relevant policy.
- **Preflight warn:** The review runs and treats the warn as context — a `low` finding if the warn touches a surface the review also checks (e.g., architecture policy).

The review does **not** re-check all preflight conditions (those are pre-write). Instead, it cross-references preflight findings to ensure the review doesn't contradict the preflight. For example, if preflight flagged "ticket asks for Python but repo policy is TypeScript," the review checks if the code actually uses TypeScript.

### LAT-47: Thread-approved Merge Authority

The review hook's output feeds directly into LAT-47's ready-to-merge gate:

| Gate | Review Hook Dependency |
|---|---|
| G1–G6 | Independent (branch, CI, title, blockers) |
| **G7 (hard blockers)** | The review's `merge_readiness.is_ready` feeds here. If `false`, the merge gate fails until findings resolve. |
| G8 (unresolved Ben feedback) | Independent |
| G9 (body vs diff) | Independent |
| G10 (write-back present) | The review hook produces the write-back draft |

The review's recommendation values map to LAT-47 merge posture:

| Recommendation | Merge Posture (LAT-47) |
|---|---|
| `approve` / `approve-with-nits` | Verification concern cleared; merge depends on other gates. |
| `request-changes` | Merge blocked until author addresses findings. |
| `block-merge` | Merge blocked; must resolve finding or get explicit override. |
| `needs-human` | Routes to Ben; merge waits for Ben's decision. |

**Important:** The review hook does **not** execute the merge. It only produces evidence and recommendations. LAT-47 decides whether those recommendations allow merge.

## 8. Dry-Run Mode

The hook supports a `--dry-run` flag for testing without posting comments:

```bash
python3 packages/pr-review-hook/src/index.py --pr-number 80 --dry-run
```

**Dry-run behavior:**
1. Collects all inputs normally.
2. Runs the full review logic.
3. Prints the output JSON to stdout.
4. Prints the Markdown report to stdout (prefixed with `[DRY RUN]`).
5. Skips GitHub PR comment posting.
6. Skips Linear write-back comment posting.
7. Sets `merge_readiness.is_ready` to `true` (dry runs don't block).
8. Writes the evidence artifact to `.agent-runs/<run_id>/` in the working tree.

**Dry-run is useful for:**
- Testing review prompts/outputs before merging the hook code.
- CI testing of the hook against a known PR.
- Manual review of the hook's output before auto-posting.

## 9. Implementation

### File Structure

```
packages/pr-review-hook/
├── README.md           # Package readme
├── package.json        # npm wrapper (optional)
├── src/
│   ├── index.py        # Main hook script (entry point)
│   ├── review.py       # Review logic (LLM invocation, finding classification)
│   ├── github.py       # GitHub API interactions (diff fetch, comment post)
│   ├── linear.py       # Linear API interactions (write-back post)
│   ├── models.py       # Data models (pydantic)
│   └── utils.py        # Helpers (run ID generation, severity classification)
├── test/
│   ├── fixtures/
│   │   ├── pr-diff.patch           # Sample PR diff
│   │   ├── pr-metadata.json        # Sample PR metadata
│   │   ├── preflight-result.json   # Sample preflight result
│   │   └── linear-ticket.json      # Sample Linear ticket
│   ├── test_models.py              # Model validation tests
│   ├── test_review.py              # Review logic tests
│   ├── test_github.py              # GitHub interaction tests
│   ├── test_linear.py              # Linear write-back tests
│   └── test_dry_run.py             # Dry-run mode tests
└── fixtures/                       # Also at repo root for convenience
    └── pr-review-hook/
        ├── sample-pr-diff.patch
        ├── sample-pr-metadata.json
        └── sample-review-output.json
```

### GitHub Actions Workflow

A new workflow file `.github/workflows/pr-review-hook.yml` triggers the hook:

```yaml
name: PR Review Hook

on:
  pull_request_target:
    types: [opened, synchronize, ready_for_review, reopened]

concurrency:
  group: pr-review-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  pr-review:
    name: Automated PR Review
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      pull-requests: write
      issues: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Run PR Review Hook
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          PR_REVIEW_DRY_RUN: 'false'
        run: |
          python3 packages/pr-review-hook/src/index.py \
            --pr-number ${{ github.event.pull_request.number }} \
            --repo ${{ github.repository }}
```

## 10. Error Handling

| Error | Recovery |
|---|---|
| GitHub API rate limit | Retry with exponential backoff (3 attempts); skip if exhausted. Log a `low` finding. |
| Linear API failure | Retry once; if fails, write to `.agent-runs/<run_id>/linear-writeback.md` for later posting. |
| Model invocation failure (LLM timeout, error) | Fallback to a rule-based review (diff scanner). Flag the fallback as a `low` finding. |
| Missing Linear ticket key | Post a PR comment asking the author to add a `LAT-NN:` prefix. Set recommendation to `needs-human`. |
| Draft PR | Skip review; post a comment "Review will run when PR is ready for review." |
| No changed files (docs-only, merge commit) | Run a lightweight review; set recommendation to `approve` with note "no code changes." |

## 11. Non-Goals

- **Automated merge authority.** The hook does not merge PRs. It only recommends.
- **Full review bot.** The hook runs on PR events, not on every commit (that's the domain of a continuous review bot, LAT-51).
- **External communications.** Only GitHub and Linear are targeted. No Slack, Discord, email, or SMS.
- **Multi-model orchestration.** The initial implementation uses a single model (OpenAI or local). Multi-model fallback is LAT-52.
- **Review quality feedback loop.** Tracking review accuracy over time is LAT-55.

## 12. Sequencing

**Hard blockers:** none (LAT-47 merge authority doc exists; LAT-7 QA review evidence workflow exists)

**Recommended predecessors:**
- LAT-47: thread-approved merge authority (merge gate integration)
- LAT-35: coding-agent preflight (preflight cross-reference)
- LAT-7: QA review evidence workflow (severity ladder, recommendation values)
- LAT-3: Linear write-back contract (Linear output format)

**Related context:**
- LAT-45: merge train (review findings feed merge queue)
- LAT-48: branch protection (review as required check)
- LAT-49: linting/coverage (review scope includes linting results)
- LAT-53: policy scanner
- ADR-0003 (Linear contract), ADR-0007 (QA/review evidence)

**Dispatch status:** ready
**Dispatch note:** docs + Python code. The hook script is a self-contained Python module. No new npm packages required unless npm integration is desired later.

## 13. Related

- ADRs: [`0003`](decisions/0003-linear-persistence-boundary.md), [`0005`](decisions/0005-linear-dependency-and-sequencing-model.md), [`0007`](decisions/0007-qa-review-evidence-workflow.md), [`0012`](decisions/0012-integration-control-plane-software-architecture.md)
- Process: [`qa-review-evidence.md`](process/qa-review-evidence.md), [`coding-agent-preflight.md`](process/coding-agent-preflight.md), [`thread-approved-merge-authority.md`](process/thread-approved-merge-authority.md), [`operating-model.md`](process/operating-model.md), [`approval-gates-and-autonomy-rules.md`](process/approval-gates-and-autonomy-rules.md)
- Templates: [`pr-review-report.md`](templates/pr-review-report.md), [`agent-run-report.md`](templates/agent-run-report.md)
- Linear: `LAT-35` (preflight), `LAT-47` (merge authority), `LAT-45` (merge train), `LAT-48` (branch protection)
