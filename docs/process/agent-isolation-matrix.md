# Agent Isolation Matrix

> Defines the isolation boundaries per agent type: secrets, filesystem, and network.
> This document is the single source of truth for what each agent type can read,
> write, and reach. Consumed by the dispatcher (secrets injection, worktree layout,
> env scrub), the policy evaluator (pre-run checks), and the runtime (post-run
> evidence validation).
>
> File name: `docs/process/agent-isolation-matrix.md`.
> Related Linear: LAT-179.

## Context

The ICP dispatches multiple agent types (`coding`, `qa`, `review`, `sre`, `pm`,
`research`, `observability`; see ADR-0006). Each type runs inside a sandboxed
worktree with an injected secret set and a bounded network surface. Without a
shared matrix, the dispatcher, the policy evaluator, and the runtime would each
hard-code different boundaries, leading to drift, over-permissive runs, or
blocked legitimate actions.

This matrix answers three questions for each agent type:

1. **Secrets:** Which credential classes are injected, and how (env var, file, header)?
2. **Filesystem:** Which paths can the agent read, write, or both?
3. **Network:** Which hosts/ports/endpoints can the agent reach, and in which direction?

The matrix is **append-only additive** — adding a new field to a row is non-breaking;
renaming or removing a column requires an ADR. See the *Revisit trigger* section.

## Matrix

### Coding agent (`coding`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read + write issues/comments/labels/states), GitHub (S2: `contents:read/write`, `pull-requests:read/write`, `issues:read/write` on the single repo). Injected via env vars. |
| **Filesystem — read** | Entire repo worktree, `.env` (git-ignored local residence), `.mcp.json` (env-var references). Read access to `docs/` for context. |
| **Filesystem — write** | Paths declared in the ticket-pack `files-in-scope` allowlist on the **agent worktree branch** only. The parent repo is read-only. No writes to `docs/` or `.github/`. |
| **Network** | GitHub API (PR creation, branch push, issue comments), Linear API (ticket read/write, comment post), Perplexity MCP bridge (inference). **No network outside CI** — the agent's direct socket connections are restricted to these three surfaces. Outbound HTTP to arbitrary hosts is blocked by the worktree subprocess's `--network=none` policy (or equivalent CI network filter). |
| **Autonomy level** | L2–L3 (propose / with-approval) |
| **Notes** | The coding agent's primary write surface is a `git` branch (`agent/LAT-NN/<lease-id>`). It never pushes to `main` directly. PR creation is a deterministic dispatcher step after the agent exits (ADR-0021). |

### QA agent (`qa`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read issues, comments, labels; write comments only — no state transitions), test-environment URL (S5: deploy URL, injected as `QA_DEPLOY_URL`). No write to Linear state. |
| **Filesystem — read** | Entire repo worktree (for test scripts, configs, fixtures), run-artifact directory (`runs/`), test-results directory (e.g., `test-results/`, coverage output). |
| **Filesystem — write** | Test-results artifacts (`test-results/`, coverage reports, evidence files). **No write to source code or `docs/`.** Write-back comment on the Linear issue via the adapter. |
| **Network** | Deploy URL (HTTP GET: health check, smoke test, UI interaction), Linear API (comment post), any test endpoint declared in the ticket pack. **No write to source repos.** |
| **Autonomy level** | L1 (read-only) |
| **Notes** | The QA agent evaluates a pre-existing branch or PR. It reads deploy URL, runs test scripts, and writes results. It never modifies source code or creates PRs. |

### PR review agent (`review`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read issues/comments/labels, write comments), GitHub (S2: `contents:read`, `pull-requests:read` on the single repo). No `write` scope. |
| **Filesystem — read** | Entire repo worktree (for source, diffs, ticket pack, ADRs/PRDs for context). |
| **Filesystem — write** | PR review report (`docs/templates/pr-review-report.md` rendered output), Linear comment via adapter. **No branch modification, no commits, no file writes on the worktree.** |
| **Network** | GitHub API (PR diff read, comment post, status check), Linear API (comment post, issue read). **No branch push, no repo write.** |
| **Autonomy level** | L1 (read-only with write-back comment) |
| **Notes** | The review agent analyses a PR diff or patch, cross-references it against ADRs/PRDs, and writes a structured review. It never modifies the branch or creates new commits. |

### SRE agent (`sre`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read issues, write comments), GitHub (S2: read-only), cloud provider (S5: infra config, deploy status — injected as `SRE_CLOUD_TOKEN`). Full credential set for the target infrastructure. |
| **Filesystem — read** | Entire repo worktree (infra configs, deployment manifests, ADRs), cloud provider config (injected, not committed), existing run artifacts. |
| **Filesystem — write** | Deploy status (written to Linear issue via adapter), infra-state artifacts (`infra-status/`), run reports. No source-code changes. |
| **Network** | **Full network to targets** — cloud provider APIs, deployment pipelines, monitoring/alerting endpoints, database endpoints. The SRE agent can reach any host declared in its `targets` list in the ticket pack. No network restriction outside the target set. |
| **Autonomy level** | L2–L3 (propose deploy / with-approval) |
| **Notes** | The SRE agent's primary write surface is deploy status on the Linear issue. It can trigger deploys, check infra health, and write back evidence. It never modifies source code or creates PRs. |

### PM agent (`pm`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read + write issues/comments/labels/states). No cloud provider keys. |
| **Filesystem — read** | Entire repo worktree (PRDs, ADRs, ticket packs). |
| **Filesystem — write** | PM artifacts (`pm/` directory, if it exists), Linear issues/comments. No source code or CI config changes. |
| **Network** | Linear API only. No cloud provider or deploy endpoints. |
| **Autonomy level** | L1 (read-only with Linear write-back) |
| **Notes** | The PM agent manages backlogs, prioritises tickets, and writes summaries. It does not touch code, deploys, or infrastructure. |

### Research agent (`research`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read issues, write comments), model provider keys (S4: Perplexity, Anthropic — injected as env vars). |
| **Filesystem — read** | Entire repo worktree for context, external URLs fetched from Perplexity/model provider. |
| **Filesystem — write** | Research artifacts (`research/` directory, or `docs/research/`). Linear comment via adapter. No source code or CI config changes. |
| **Network** | Model provider APIs (inference), external URLs fetched for research. **No write to source repos or cloud deploy endpoints.** |
| **Autonomy level** | L1 (read-only with write-back) |
| **Notes** | The research agent fetches external information, analyses options, and writes reports. It does not modify code or trigger deploys. |

### Observability agent (`observability`)

| Dimension | Boundary |
|---|---|
| **Secrets** | Linear (S1: read issues, write comments), telemetry backend (S5: if applicable, injected as `OBS_TELEMETRY_TOKEN`). |
| **Filesystem — read** | Run artifacts (`runs/`), logs, metrics data. |
| **Filesystem — write** | Observability reports, metrics summaries. Linear comment via adapter. No source code changes. |
| **Network** | Telemetry backend APIs, Linear API. **No write to source repos or cloud deploy endpoints.** |
| **Autonomy level** | L1 (read-only) |
| **Notes** | The observability agent reads run metrics and produces summaries. It does not modify code or trigger deploys. |

## Summary table

| Agent type | Secrets scope | Filesystem read | Filesystem write | Network scope | Autonomy |
|---|---|---|---|---|---|
| `coding` | Linear (RW), GitHub (RW) | Full worktree | Worktree `files-in-scope` only | 3 surfaces: GitHub, Linear, MCP. No arbitrary network. | L2–L3 |
| `qa` | Linear (R+comment), deploy URL | Full worktree | Test results, evidence | Deploy URL, Linear, test endpoints | L1 |
| `review` | Linear (R+comment), GitHub (R) | Full worktree | PR review report, Linear comment | GitHub (R), Linear (R+comment). No branch push. | L1 |
| `sre` | Linear (R+comment), GitHub (R), cloud provider | Full worktree + infra config | Deploy status, infra artifacts | Full network to declared targets | L2–L3 |
| `pm` | Linear (RW) | Full worktree | PM artifacts, Linear | Linear only | L1 |
| `research` | Linear (R+comment), model providers (S4) | Full worktree | Research reports, Linear | Model providers, external URLs | L1 |
| `observability` | Linear (R+comment), telemetry (S5) | Run artifacts | Reports, Linear | Telemetry backend, Linear | L1 |

## How the matrix is enforced

### Secrets injection

The dispatcher reads the agent type from the ticket-pack frontmatter and selects the
credential set per the *Secrets* column. It builds the subprocess environment by
starting with the scrubbed base env (ADR-0017 Rule 4) and adding only the variables
declared for that agent type. The policy scanner validates that no secret value leaks
into committed files or run reports (ADR-0017 Rule 3).

### Filesystem isolation

The worktree model (ADR-0022) ensures the agent's `cwd` is its worktree directory,
which is on a separate branch. Writes outside the ticket-pack `files-in-scope` are
caught at the ADR-0021 deterministic gate. The policy scanner (`packages/policy-scanner`)
validates file-write actions against the `files-in-scope` allowlist.

### Network isolation

The agent subprocess is spawned with a network policy derived from the *Network* column:

- `coding`: `--network=three` (GitHub, Linear, MCP bridge)
- `qa`: `--network=two` (deploy URL, Linear)
- `review`: `--network=two` (GitHub, Linear), read-only
- `sre`: `--network=targets` (full connectivity to declared target list)
- `pm`: `--network=one` (Linear only)
- `research`: `--network=external` (model providers, external URLs)
- `observability`: `--network=two` (telemetry, Linear)

This is implemented by the agent-invocation adapter (ADR-0013) and enforced by the
harness's subprocess launcher. Future container-based hardening (ADR-0022 fast-follow)
will enforce this at the iptables/Docker-network level.

## Revisit trigger

Revisit this matrix when:

1. A new agent type is added that does not fit the existing pattern (e.g., a `deploy`
   agent with autonomous merge-and-deploy capability).
2. The network surface grows — a new integration requires a fourth or fifth network
   endpoint for an existing agent type.
3. A secret class is added (e.g., a new cloud provider) that changes the injection
   model for multiple agent types.
4. The filesystem boundary model changes (e.g., `files-in-scope` allowlist is replaced
   with a denylist, or container-based filesystem ACLs are adopted).
5. An agent type's autonomy level shifts outside its declared range (e.g., `qa` gains
   write capability).
6. The policy scanner or dispatcher implementation reveals that the declared boundaries
   do not match runtime behaviour.

## Links

- Related Linear: **LAT-179** (this decision), LAT-129 (dispatcher), LAT-133 (useful dispatch loop)
- Related ADRs: ADR-0006 (run visibility schema — agent types enum), ADR-0013 (invocation boundaries — secrets), ADR-0017 (credentials management — injection), ADR-0021 (dispatcher synthesis — deterministic gates), ADR-0022 (concurrent sandboxing — worktree isolation)
- Related PRD: LAT-64 (secret injection — credential classes), LAT-133 (dispatch loop — concurrency)
- Implementation: `packages/icp/src/runtime/contract.ts` (`AgentType` enum, `AgentInvocationRequest`), `packages/icp/src/dispatcher/` (credential injection, worktree management)
