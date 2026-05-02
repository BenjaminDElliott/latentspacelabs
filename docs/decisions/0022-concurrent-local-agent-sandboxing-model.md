---
id: ADR-0022
title: Concurrent local agent sandboxing model
status: proposed
date: 2026-05-02
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-139
  - LAT-129
  - LAT-133
  - LAT-135
  - LAT-136
  - LAT-137
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) a second concurrent operator joins and the per-agent ticket-lease model produces contention the worktree-only isolation cannot resolve; (b) a dispatched ticket needs to execute untrusted code, run a network-egressing build, or exercise a tool surface (filesystem writes outside the worktree, host package installs, kernel features) the subprocess sandbox cannot bound; (c) RunPod or GitHub rate-limit / quota events become a recurring failure class because the resource-lock model in §"Resource locks" is too coarse; (d) a security incident — a concurrent run exfiltrating another run's secrets, a worktree leaking files outside its branch, a stuck lease blocking the queue — forces a tighter posture than worktrees + subprocesses can express; (e) the cost-class concurrency bounds in §"Concurrency bounds" stop matching real provider throughput (RunPod cold-start patterns, frontier rate limits, GitHub Actions minute caps); or (f) the fast-follow Docker/container model is needed for a routine slice rather than as a hardening track, at which point this ADR is amended or superseded by the container-model ADR.
---

# ADR-0022: Concurrent local agent sandboxing model

> File name: `docs/decisions/0022-concurrent-local-agent-sandboxing-model.md`.
> Picks the MVP isolation model for concurrent local agent runs and names the fast-follow hardening model.

## Context

ADR-0018 fixed the first ICP agent runtime (GitHub Actions + `workflow_dispatch`) and ADR-0019 amended it to make opencode + a local Qwen endpoint on a self-hosted runner the primary implementation runtime for bounded tickets. Both ADRs answered "where does the agent process run." Neither answered **what isolates one local agent run from another when more than one is in flight at the same time**.

Today the dispatcher (LAT-129) is single-ticket, single-process, single-run by design — `npm run dispatch:next` takes one `LAT_DISPATCH_ISSUE`, runs it, writes evidence, exits. The LAT-133 PRD names polling, queueing, daemon/scheduler, and concurrency as **fast-follows** the MVP must not foreclose. LAT-135 (executable shell checks vs. policy validations) and LAT-136/LAT-137 (the next slices in the local-agent loop) push the loop further toward routine use, and the moment the operator runs two tickets back-to-back — let alone in parallel — the questions this ADR answers become load-bearing:

- Where does each agent's working tree live, so two runs editing the repo do not stomp each other?
- How is a ticket "claimed" so two runs never pick the same one?
- Which shared resources (RunPod endpoint, GitHub API quota, the npm cache, the Qwen GPU, model weights) need locks, and at what granularity?
- How many runs of a given cost class / provider / risk tier are allowed at once before the system falls over (rate limits, GPU contention, GitHub Actions minute burn)?
- What gets cleaned up — and what stays — when a run crashes, hangs past a deadline, or is cancelled?
- What evidence does each run leave so a future cockpit / retro can answer "did concurrency cause this failure?"

This ADR fixes a **deliberately small** isolation model for the MVP — one that the current single-ticket dispatcher already nearly satisfies — and names the **fast-follow hardening** model for higher-risk or untrusted work. It does not promote any "useful day-to-day" feature beyond what LAT-133 already approves; it gives LAT-136 / LAT-137 / future polling a contract to build against without baking in assumptions that block the hardening path.

This is a decision ticket. It does not implement the worktree harness, the lease store, the resource-lock primitives, or the container substrate. It picks the shape those will take.

## Decision Drivers

- **Anti-astronautics (`docs/decisions/README.md`).** One operator, one repo, one runner host today. An isolation model that requires standing infrastructure, a container daemon as a hard prerequisite, or a multi-host scheduler is overbuilt for the pilot slice. The MVP must work on an unprivileged developer machine.
- **Bounded blast radius (ADR-0008 Stop list, ADR-0013 boundary, ADR-0017 Rule 2).** A second concurrent run must not be able to read or overwrite the first run's working tree, scratch artifacts, or in-flight credentials. The Stop list (no workflow edits, no ADR/PRD edits from non-PRD tickets, no deploy, no force-push) is enforced *at every layer*; the sandbox is a backstop, not a substitute.
- **Determinism over cleverness (ADR-0021 dispatcher synthesis boundary).** Concurrency control — claiming a ticket, picking a lane, releasing a lock — is deterministic and auditable. The agent inside the sandbox does not negotiate its own concurrency; the dispatcher does.
- **Stay on Node/TS/npm and on the runner the operator already has (ADR-0011, ADR-0019).** The MVP isolation primitive must be `git`, `node`, and the operating system the operator runs. No required dependency on Docker, k8s, Firecracker, or a second language runtime in the MVP.
- **Evidence is the durable artifact (ADR-0006, ADR-0014, LAT-133 §6.2).** Every run records what it claimed, where it ran, what it locked, why it released, and how it cleaned up. ADR-0014 redaction applies; no endpoint URLs, pod ids, or secret values leak through evidence.
- **Cost-class concurrency interacts with cost bands (ADR-0009, ADR-0020).** A `runaway_risk` halt in any lane is a Stop in every lane (ADR-0009); the local-fallback lane does not silently absorb a `runpod_frontline` overflow (ADR-0020). The concurrency bounds in this ADR do not relax either rule.
- **Ticket-pack scope is the file-conflict boundary (ADR-0013, ADR-0019, LAT-104 ticket-pack contract).** Two runs whose ticket packs declare overlapping `files-in-scope` cannot run concurrently in the MVP. The dispatcher refuses the second one rather than mediating an in-flight merge.
- **Reversibility.** The MVP isolation model must be reversible in a single PR (delete the worktree directory, drop the lease store, remove the lock files). The fast-follow container model is a deliberate, ADR-gated extension; it does not become the default by drift.
- **No bypass of approval gates.** Approval surfaces (ADR-0008 pilot posture, LAT-133 §6.7) are enforced *outside* the sandbox. A run that completes inside its sandbox still produces a PR for human review; the sandbox does not auto-merge, auto-deploy, or escalate autonomy. The Stop list applies inside and outside.

## Considered Options

1. **Single-tree, single-run only (status quo).** Keep LAT-129's one-ticket-per-process contract; refuse a second invocation while the first holds the repo. Simple, but forecloses the LAT-133 fast-follow surface (polling, queue, multi-ticket dispatch) and forces every concurrency design to start by undoing the assumption.
2. **Shared working tree + cooperative file locks.** Multiple runs in the same checkout, coordinating via advisory locks on `files-in-scope`. Rejected: too easy for an agent to break the convention (touching a file outside its declared scope), no structural barrier between runs, and merge conflicts inside one checkout become an in-band failure mode the dispatcher cannot reason about.
3. **`git worktree`-per-agent + per-agent subprocess + ticket lease (chosen MVP).** Each accepted dispatch creates a fresh worktree under `.icp/worktrees/<lease-id>/` on a branch named after the ticket; the agent runs as a subprocess scoped to that worktree; a small file-backed (or SQLite-backed) lease store records the active claim on the ticket and on shared resources. Worktrees are pruned on success, on failure, on timeout, and at startup. Cheap, structurally isolating for filesystem state, and within reach of LAT-129 + LAT-136 + LAT-137 without new substrate.
4. **Container-per-agent (Docker/OCI) as the MVP.** Each run executes inside a container with a bind-mounted worktree and an injected, scoped credential set. Strong isolation, but introduces a hard dependency on a container runtime on every host, complicates secrets injection (ADR-0017 Rule 4 surfaces), and is overbuilt for the bounded local-implementation work that dominates the LAT-133 MVP. Rejected as MVP, **adopted as the fast-follow hardening model** for higher-risk or untrusted work.
5. **VM-per-agent (Firecracker / microVM / cloud VM).** Strongest isolation, highest operational cost. Out for the same anti-astronautics reasons as Option 4, *more so*. Not adopted now or as a fast-follow; if the threat model demands it, that is a superseding ADR.

## Decision

**Accepted: Option 3 as the MVP, Option 4 as the named fast-follow hardening model.**

For the MVP local agent dispatch loop, the isolation model is:

> **`git worktree`-per-agent + per-agent subprocess + ticket lease**, with deterministic cleanup, bounded concurrency by cost class / provider / risk, and resource locks on the small set of shared services the loop touches.

For higher-risk or untrusted work — anything outside a LAT-104 ticket pack's bounded `files-in-scope` allowlist, anything touching a tool surface the subprocess sandbox does not bound (network-egressing builds, host package installs, untrusted code execution), or a future slice where the threat model warrants it — the fast-follow hardening model is **container-per-agent (Docker/OCI)** under a separate, ADR-gated PR. The MVP must not foreclose that fast-follow.

The sub-sections below fix the contracts the MVP must satisfy. LAT-136 and LAT-137 (and any successor implementation tickets) consume them.

### Per-agent workspace layout

- Each accepted dispatch creates a fresh `git worktree` under a stable, repo-relative root: **`.icp/worktrees/<lease-id>/`**.
  - `<lease-id>` is the deterministic identifier of the lease (see *Ticket lease / claim semantics* below). It is *not* the ticket id alone, so a re-dispatch of the same ticket gets its own directory and never collides with a stale tree.
  - The root `.icp/worktrees/` is gitignored. It is **not** a tracked path.
  - A single, repo-local lease store lives at **`.icp/leases/`** (file-backed JSON or, if the implementer prefers, a small embedded SQLite db). This path is also gitignored. ADR-0014 redaction applies to anything written here that may leave the host.
- The worktree's branch is created off the dispatcher's chosen base ref (default: `main` at the time of claim). Branch naming is fixed in *Branch naming* below.
- The agent subprocess runs with **`cwd` set to the worktree directory**. The subprocess does not chdir into the parent repo; the parent repo is read-only relative to the agent.
- The subprocess inherits a **scrubbed environment**: only the variables ADR-0017 Rule 4 lists for the lane (e.g. `ANTHROPIC_API_KEY` for the frontier path, the RunPod / opencode set for ADR-0019), plus a small lease-context block (`LAT_LEASE_ID`, `LAT_TICKET_ID`, `LAT_LANE`). Everything else is filtered. The dispatcher's existing scrub pass is the floor.
- Files-in-scope (the LAT-104 ticket pack's allowlist) are the **only** paths the agent is permitted to write inside the worktree. Writes outside that allowlist are caught at the ADR-0021 deterministic gate (Stop list) and at PR review; the sandbox does not enforce this with kernel ACLs in the MVP — that is part of the fast-follow.
- Worktrees are **fungible**: nothing about a run depends on a worktree surviving. Restarts, host reboots, and crashed dispatchers all converge to "delete the worktree, refuse or re-dispatch the lease" rather than "rescue the worktree."

### Branch naming

- Branch name shape: **`agent/<ticket-id>/<lease-id>`** — e.g. `agent/LAT-136/01HKX…`. Lower-case, dashed inside segments. The `agent/` prefix marks the namespace; the ticket id keeps the branch greppable; the lease id keeps re-dispatches distinct.
- Branches are created by the dispatcher, not the agent. The agent commits onto the branch but does not create or rename it.
- The agent never pushes to or rebases onto `main`. It pushes only its own `agent/<ticket-id>/<lease-id>` branch (PR creation is a deterministic step run by the dispatcher after the agent exits, per ADR-0021).
- Force-push to `main` (or any protected ref) is on the ADR-0008 Stop list and is enforced outside the sandbox; the agent's credentials are scoped so it cannot do it.
- Branches whose lease is closed (success or failure) are deleted as part of *Cleanup / prune policy* below; branches whose PR has merged are pruned by the normal post-merge cleanup. Stale `agent/*` branches on the remote are a signal of a missed cleanup, not state to preserve.

### Cleanup / prune policy

- **On success** (agent exited 0, evidence written, PR opened or refusal recorded): the lease is closed, the worktree directory is removed (`git worktree remove --force` followed by directory delete), and the local branch is deleted. The remote branch is left alive only if a PR was opened against it; otherwise it is also deleted.
- **On failure** (agent exited non-zero, including timeout, OOM, signal): same cleanup as success, plus a structured failure record in evidence (see *Failure cleanup*). Cleanup is **idempotent**: re-running it after a partial cleanup must converge.
- **On dispatcher startup**: the dispatcher prunes any worktree whose lease is `released` or whose lease is `expired`. Worktrees whose lease is `active` but whose pid is not alive are treated as crashed (lease is force-released, evidence is annotated, worktree is pruned). This handles host reboots and orphaned trees from earlier crashes.
- **On lease timeout**: a lease that has been active longer than its declared deadline (default sane, override in ticket frontmatter, hard ceiling per cost class) is force-released and the worktree is pruned. The run is recorded as `lease_timeout` in evidence; the dispatcher does not auto-retry — re-dispatch is a fresh routing decision per LAT-133 §6.6.
- **No orphan retention.** The MVP does not keep worktrees "for inspection." A failure that needs human inspection records the diff (and optionally a tarball of the worktree) into a redacted evidence artifact *before* the worktree is pruned. ADR-0014 applies; no endpoint URLs / pod ids / secret values in retained artifacts.
- **No cross-run reuse.** Worktrees and branches are not reused between runs even for the same ticket. A re-dispatch is a new lease, a new directory, a new branch. This is what makes the lease id, not the ticket id, the path key.

### Ticket lease / claim semantics

- A **lease** is the single source of truth for "this ticket is being worked on right now." It records: `lease_id`, `ticket_id`, `lane`, `cost_class`, `risk_tag`, `pid`, `started_at`, `deadline`, `state` (`active` | `released` | `expired` | `force_released`), `worktree_path`, `branch_name`, `resource_locks` (see below), and a redacted snapshot of the ticket pack's `files-in-scope`.
- The dispatcher **claims** by atomically creating the lease record (rename-into-place on a file-backed store, or `INSERT … RETURNING` on SQLite). Claim collisions on the same ticket id resolve in favor of the first writer; the loser refuses with `ticket_already_leased` (a structured refusal under LAT-133 §6.6, additive to the §6.2 vocabulary — see *Open: refusal vocabulary additions* below).
- Leases are **single-writer per ticket**. A second dispatch for the same ticket id while the first lease is `active` refuses; it does not queue inside the dispatcher. Queueing is the LAT-133 fast-follow.
- Leases are **scoped to the host**. Two operators on two hosts each have their own lease store; this ADR does not promise cross-host claim safety. When a second host or a second operator becomes load-bearing, that is revisit trigger (a) and a follow-up ADR (a shared-lease backend, likely Linear-issue-state-backed or a small remote store).
- Lease state transitions are **append-only in evidence**: the run record carries every transition (`claim`, `start`, `release`, `force_release`, `expire`) with timestamps. This is what makes "did concurrency cause this failure?" answerable from evidence alone.
- The lease record is **never** the place credentials live. ADR-0017 residence rules are not relaxed; the lease holds *references* to the credential set the lane needs (e.g. `lane: runpod_frontline`), not values.

### File-scope conflict prevention

- The dispatcher reads each candidate dispatch's LAT-104 ticket pack `files-in-scope` allowlist before claiming. If the union of files-in-scope across active leases overlaps with the candidate's files-in-scope, the candidate **refuses with `files_in_scope_conflict`** (additive to LAT-133 §6.2). It does not queue, does not merge, does not auto-rebase.
- Overlap is computed on the path patterns the ticket pack already declares (LAT-104). Wildcards expand to their literal path set at claim time; a `**` allowlist is treated as "the entire repo" and conflicts with any other active lease (and is itself a smell the ticket pack should not have shipped).
- This is a **deterministic refusal**, per ADR-0021 — the synthesis layer may suggest a different ticket; the gate decides. The MVP does not attempt a "find a compatible ticket" search; the dispatcher refuses the specific candidate and exits.
- Two leases whose files-in-scope are disjoint may run concurrently subject to the *Concurrency bounds* below. Disjoint leases do not coordinate at the filesystem layer; their worktrees are physically separate trees.
- The agent inside the sandbox is **not** trusted to honor `files-in-scope` on its own. Writes outside the allowlist are caught (a) by the ADR-0021 deterministic gate before commit, (b) by the policy scanner pre-commit (where applicable), and (c) by PR review. The sandbox is a backstop here, not the primary control.

### Resource locks for RunPod / GitHub / cache

The MVP recognises a small, enumerated set of shared resources. Each has a lock granularity, a holder, and a release condition. Locks live in the same lease store (or alongside it) and are released as part of normal *Cleanup / prune policy*.

- **RunPod endpoint slot.** Granularity: per-endpoint. The dispatcher refuses a `runpod_frontline` claim whose endpoint slot is exhausted (`lane_unhealthy`, per LAT-133 §6.3). The MVP does not pool multiple endpoints; that is a fast-follow.
- **Local Qwen GPU slot.** Granularity: per-host (the operator's box). At most **one** active `local_dev_fallback` lease at a time in the MVP. A second `local_dev_fallback` candidate refuses with `lane_unhealthy`. The Qwen process is itself a single-tenant resource on the host; this preserves that.
- **GitHub API quota.** Granularity: per-token (the runner's GitHub token). The dispatcher does **not** mint per-run tokens in the MVP; it relies on the existing runner credential and a coarse bound (see *Concurrency bounds*). Rate-limit pressure surfaces as a structured failure (`github_rate_limit`), not as a silent stall. Per-run / per-PR token isolation is part of the fast-follow.
- **npm / package cache.** Granularity: per-host. The cache is **read-shared, write-locked**. Two runs may read in parallel; a write (e.g. `npm ci` adding a previously-unseen package) takes a short-lived host-wide lock. The MVP achieves this via the operating system's existing file lock primitives (e.g. `flock`-style); it does not implement a custom cache server.
- **Repo `.git` index of the parent checkout.** Worktrees give each run its own index file, so this is structurally not shared. The lease store *is* shared and is the place lock contention shows up; it must use atomic file operations (rename-into-place, O_EXCL, or a transactional store).
- **Linear issue write surface.** Granularity: per-issue. The dispatcher serialises Linear writes for a given issue across runs (only the lease holder writes the run-evidence comment). Cross-issue Linear writes do not contend.

Lock acquisition is **try-then-refuse**, never block-and-wait, in the MVP. A run that cannot acquire its locks at claim time refuses with the structured reason; the operator (or a future poller) decides whether to re-dispatch later. This avoids deadlock by construction and keeps the dispatcher's behaviour deterministic.

### Concurrency bounds by cost class / provider / risk

The MVP enforces the following bounds, expressed in terms of ADR-0009 cost bands, ADR-0020 lanes, and an `architecture_risk` flag derived from LAT-134 tags. These are *defaults*; they are tunable per host (env var or local config) but **not** tunable per ticket.

- **Global active-lease cap (host-wide):** `≤ 4` active leases at once. Hard ceiling for the MVP. Beyond this, claims refuse with `concurrency_cap`.
- **Per-lane caps:**
  - `runpod_frontline`: `≤ 3` concurrent (subject to RunPod endpoint slot — typically the binding constraint).
  - `local_dev_fallback`: `≤ 1` concurrent (single-GPU host).
  - `frontier_reasoning`: `≤ 2` concurrent (rate-limit-bounded; protects ADR-0009 spend).
- **Per-cost-band caps:**
  - `low`: `≤ 4` (does not raise the global cap).
  - `normal`: `≤ 2`.
  - `high`: `≤ 1` — single-track, even if the lane has slot.
  - `runaway_risk`: `0`. ADR-0009 forbids running. The dispatcher refuses with `runaway_risk`; ADR-0008 Stop applies.
- **Per-risk-tag caps:**
  - `architecture_risk: low`: governed by the lane / cost-band caps above.
  - `architecture_risk: high` (cross-cutting refactors, ADR/PRD-shaped tickets that escaped classification): `≤ 1` host-wide, regardless of lane. Anything tagged `architecture_risk: high` *and* on `runpod_frontline` / `local_dev_fallback` was a routing miss (LAT-133 §6.4) and is a separate refusal.
- **Provider-specific caps:**
  - RunPod: per the endpoint slot above.
  - GitHub API: bound by the global cap (4) plus the per-token rate limit. The MVP does not split the token; the bound is achieved by capping concurrency.
- **Bounds compose by `min`.** A `runpod_frontline` × `high` × `architecture_risk: low` claim takes the most restrictive of the applicable caps. The dispatcher records which cap bound the decision in evidence (`concurrency_bound_by`).
- **No queueing.** Past the cap, the dispatcher refuses (`concurrency_cap`) and the operator decides. This is intentional — the LAT-133 PRD makes a queue a fast-follow, and this ADR does not pre-empt that design.

These numbers are starting points sized to the current single-host pilot. Revisit trigger (e) covers tightening or relaxing them.

### Failure cleanup

- **Process death.** If the agent subprocess dies (exit non-zero, signal, OOM-kill), the dispatcher detects on `wait()` and runs the *Cleanup / prune policy* path for the lease, with `lease.state = released`, `outcome = process_died`, and a redacted tail of the agent's stderr captured in evidence (ADR-0014 redaction).
- **Dispatcher death.** If the dispatcher itself dies, its leases are not cleaned up immediately. The next dispatcher startup runs the prune-on-startup path: any lease whose `pid` is not alive is `force_released`, its worktree is pruned, and its evidence record gains an `interrupted` annotation. Leases whose `pid` is still alive (e.g. the dispatcher restarted but the agent kept running) are left alone — the agent's eventual exit drains via the same `wait()` path on a re-attached supervisor, or expires via the deadline.
- **Lease deadline overrun.** A lease past `deadline` is `force_released`; SIGTERM is sent to the subprocess, then SIGKILL after a short grace period. Worktree is pruned. Evidence records `lease_timeout`.
- **Lock contention as failure.** A lock that cannot be acquired refuses; a lock held past a run's lifetime is force-released as part of the lease release. The MVP does not attempt deadlock detection — try-then-refuse makes deadlocks impossible by construction.
- **Partial PR creation.** If the agent has pushed its branch but the PR-creation step fails, the lease still releases and the worktree still prunes; the orphaned remote branch is logged in evidence and a deterministic post-cleanup step (idempotent) attempts to either complete the PR or delete the branch on the next dispatcher startup. The MVP does not leave the operator to clean these up by hand.
- **Non-clean refusal**. A refusal at claim time (no lease ever became `active`) writes a refusal record but creates **no** worktree, **no** branch, and **no** locks. This is the cheapest path through the system and is what `concurrency_cap`, `files_in_scope_conflict`, `ticket_already_leased`, and `lane_unhealthy` typically take.
- **Approval-gate violations are not "cleanup."** If the agent attempts a Stop-listed action (push to `main`, edit `.github/workflows/**`, edit ADR/PRD outside a PRD ticket, deploy), the run fails the deterministic gate; the lease is closed as a refusal, not as a successful run that needed cleanup. ADR-0008 / ADR-0021 govern; this ADR does not relax them.

### Evidence fields

Each run / refusal writes the LAT-133 §6.2 envelope plus the following, redacted per ADR-0014:

- `lease_id`, `ticket_id`, `worktree_path` (relative, not absolute), `branch_name`.
- `lease_state_transitions[]`: array of `{ state, ts, reason }` entries from `claim` through `release` / `force_release` / `expire`.
- `concurrency_snapshot_at_claim`: counts per lane / cost band / risk tag at the moment of claim, plus the global active count.
- `concurrency_bound_by`: which cap (if any) bound the decision; `null` for an accepted claim that did not approach a cap.
- `resource_locks_acquired[]`: ordered list of locks taken (`runpod_endpoint_slot`, `local_qwen_gpu_slot`, `github_api_quota`, `npm_cache_write`, `linear_issue_<id>_write`).
- `resource_lock_failures[]`: ordered list of `{ lock, reason }` for any lock that refused acquisition.
- `cleanup_outcome`: `clean` | `interrupted` | `timeout` | `partial_pr` | `refusal_only`.
- `files_in_scope_overlap[]`: when the refusal is `files_in_scope_conflict`, the overlapping path globs vs. the conflicting `lease_id` (the conflicting lease's *id*, not its credential or its prompt).
- `interrupted_by`: when `cleanup_outcome` is `interrupted`, the reason (`dispatcher_restart`, `host_reboot`, `signal`, `unknown`).
- No endpoint URLs, no RunPod pod ids, no tokens, no env-var values. ADR-0014 redaction is the floor.

### Interaction with related Linear work

- **LAT-129 (ICP-owned Linear polling dispatcher MVP, on `main`).** This ADR is additive to LAT-129's contract. The single-ticket invocation shape (`npm run dispatch:next` with `LAT_DISPATCH_ISSUE`) is unchanged. Adding the worktree / lease / lock layer is an internal implementation detail of the dispatcher; the CLI surface, the refusal vocabulary (extended additively), and the evidence envelope all preserve their current shape. LAT-129's redactor (`redactOutput`) remains the floor for ADR-0014 redaction in the new evidence fields.
- **LAT-133 (PRD: useful local agent dispatch loop MVP).** This ADR consumes LAT-133 §6.1 (canonical loop contract), §6.2 (evidence schema), §6.6 (refusal vocabulary), §6.7 (approval points), and §6.8 (MVP scope vs fast-follow). It adds three structured refusal classes — `ticket_already_leased`, `files_in_scope_conflict`, `concurrency_cap` — that LAT-133 §6.2 should be amended to enumerate (a small PRD diff, owned by the LAT-133 / LAT-59 follow-up — see *Open questions*). The MVP fast-follow surface (polling, queue, daemon, cockpit, auto-review) is preserved verbatim — this ADR does not promote any of them.
- **LAT-135 (executable shell checks vs. policy validations, on `main`).** LAT-135 separated `npm run check`'s shell-executable parts from its policy validations. This ADR does **not** add new work to `npm run check`. The lease store and the worktree directory are gitignored runtime state; they are not validated by `check`. ADR validation (`validate:adrs`) catches this file's frontmatter and ID, which is the only `check`-visible surface this PR adds.
- **LAT-136 / LAT-137 (next implementation slices in the local-agent loop).** These are the implementation tickets that consume this ADR. LAT-136 is the natural owner of the worktree harness + lease store; LAT-137 is the natural owner of the resource-lock primitives + concurrency bounds. The fast-follow container model is *not* their scope — it gets its own ticket and its own ADR before landing.
- **ADR-0008 Stop list, ADR-0009 cost bands, ADR-0017 secrets, ADR-0018/0019 runtimes, ADR-0020 routing, ADR-0021 deterministic gates.** All hold as written. This ADR does not relax any of them; it picks the substrate on which they are enforced for concurrent runs.

### What this ADR does *not* decide

- The implementation of the worktree harness, the lease store, or the lock primitives. Owned by LAT-136 / LAT-137.
- The polling, queue, daemon/scheduler, dashboard, and auto-review surfaces. They remain LAT-133 fast-follows; this ADR shapes them but does not implement them.
- The container fast-follow model. It is named here so the MVP does not foreclose it; the actual container ADR is a separate PR with its own decision drivers (image policy, registry, signing, network egress posture, secret-injection contract under ADR-0017 Rule 4).
- Cross-host concurrency. The MVP is host-scoped; revisit trigger (a) names when cross-host becomes load-bearing.
- The exact numeric concurrency caps as immutable values. They are starting points; tightening or loosening them is a tunable, not a new ADR — but a structural change (e.g. introducing a queue, splitting a lane) is.

## Consequences

Good:

- LAT-136 / LAT-137 land against a concrete substrate (worktree-per-agent + lease + locks) that is achievable on the operator's existing host with no new dependency.
- LAT-129's single-ticket contract is preserved; the new layer is internal. LAT-133's MVP scope and fast-follow surface are unchanged.
- The fast-follow container model is named, so a future "untrusted code" or "network-egressing build" slice can be designed against it without re-architecting the MVP.
- Concurrency questions ("how many at once?", "what blocks?", "what cleans up?") have deterministic, evidence-recorded answers. ADR-0021 holds: synthesis recommends, gates decide.
- File-scope conflicts become a structured refusal rather than an in-flight merge problem. Ticket packs already declare `files-in-scope`; the dispatcher consumes them.
- ADR-0008 Stop list, ADR-0009 cost bands, ADR-0017 secrets residence, and ADR-0020 routing all flow through unchanged. The sandbox is a backstop; the gates upstream of it are the primary controls.
- Cleanup is uniform across success, failure, timeout, and dispatcher restart. No "rescue the worktree" path; everything converges to delete + record.

Bad / open:

- **Worktrees and subprocesses are not strong isolation.** A misbehaving agent can still consume host resources, write outside its declared `files-in-scope` (caught at the gate, not at the syscall), or attempt network egress the host permits. The fast-follow container model is the answer when the threat model demands more.
- **Host-scoped lease store.** A second operator or a second host today would not see each other's claims. Revisit trigger (a) names this; until then, "two hosts" is out of scope by construction.
- **Try-then-refuse on locks** trades throughput for determinism. Operator-felt: a transient lock contention surfaces as a refusal the operator must re-dispatch. This is intentional for the MVP — see LAT-133 §6.6 — but is one of the things a fast-follow queue would smooth.
- **Concurrency cap of 4 host-wide is a guess.** It is shaped to keep RunPod, GitHub rate limit, and the operator's GPU within bounds today. Revisit trigger (e) covers re-sizing; LAT-133 §8 success metrics will surface whether 4 is too high or too low.
- **Refusal-vocabulary additions** (`ticket_already_leased`, `files_in_scope_conflict`, `concurrency_cap`) are not yet in LAT-133 §6.2's enumeration. A small PRD diff is owed (see *Open questions*).
- **Per-run GitHub tokens are not minted in the MVP.** The runner's existing token is used for all runs. This is fine at concurrency 4 with a single PAT; it is **not** fine if a future slice needs per-PR token isolation. Fast-follow.
- **GPU contention on `local_dev_fallback`** is hard-capped at 1 per host. If the operator wants two `local_dev_fallback` runs in parallel, the answer is not a config tweak — it is a different runtime ADR (multiple Qwen endpoints, a remote endpoint pool).
- **The container fast-follow** has its own decisions to make (image policy, registry, signing, secrets injection contract, network egress posture). Naming it here does not pre-empt those; it commits us to writing them down before the container model lands.
- **Approval bypass risk.** A poorly-scrubbed env, a leaky lease record, or a worktree that escaped `files-in-scope` would let a sandbox run land work that should have required human approval. The defence-in-depth is the gate (ADR-0021), the Stop list (ADR-0008), the secret-guard (ADR-0017), and PR review — all upstream of the sandbox. This ADR adds the sandbox as a backstop; it does not remove any prior layer.

## Confirmation

The decision is working when:

- LAT-136 / LAT-137 land an implementation that creates `agent/<ticket-id>/<lease-id>` branches under `.icp/worktrees/<lease-id>/`, claims via the lease store, releases on success / failure / timeout / restart, and writes the evidence fields above. Two back-to-back dispatches of disjoint-scope tickets run cleanly with no shared filesystem state.
- A second dispatch attempt on a ticket whose lease is `active` refuses with `ticket_already_leased`, leaves no worktree behind, and records the refusal in evidence.
- A dispatch whose `files-in-scope` overlaps an active lease refuses with `files_in_scope_conflict`, records the overlap and the conflicting `lease_id`, and creates no worktree.
- Concurrency caps are observed: a 5th claim refuses with `concurrency_cap`; a 2nd `local_dev_fallback` claim refuses with `lane_unhealthy`; a `runaway_risk` claim refuses with `runaway_risk` regardless of any other state.
- A killed agent process or a killed dispatcher leaves no orphan worktrees or orphan branches after the next dispatcher startup. The cleanup-on-startup path is exercised in tests (mock host reboot).
- `npm run check` remains offline and lane-independent (LAT-135, LAT-133 §6.11). The lease store and worktree directory are gitignored and do not appear in any tracked path.
- No endpoint URLs, RunPod pod ids, GitHub tokens, or env-var values appear in any evidence field added by this ADR. ADR-0014 redaction is the floor.
- A scope increase on the sandboxing model — a queue, a daemon, cross-host claims, the container model — lands as a PR diff to this ADR or as a superseding ADR, not as a quiet implementation change.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest path to the container fast-follow is a slice that needs to run untrusted code or a network-egressing build; the next is a security incident the worktree model could not contain.

## Open Questions

These do not block accepting this ADR but should be closed before LAT-136 / LAT-137 land:

1. **Lease store backend.** File-backed JSON with rename-into-place, or a small embedded SQLite db? Both satisfy atomicity; SQLite gives easier query for the dispatcher startup prune. Owned by LAT-136.
2. **Refusal-vocabulary diff to LAT-133 §6.2.** Adding `ticket_already_leased`, `files_in_scope_conflict`, `concurrency_cap` — small PRD diff. Owned by the LAT-133 follow-up.
3. **Lease deadline defaults.** Per-cost-class deadline — `normal` ≈ 30 min? `high` ≈ 60 min? `low` ≈ 15 min? — needs a number. ADR-0009 does not commit one. Candidate ADR or a small policy doc owned by LAT-137.
4. **Tarball-on-failure retention policy.** Whether to keep a redacted worktree tarball on failure for human inspection, and for how long. Defaults to "no" today; revisit if QA retros (ADR-0010) want it.
5. **Container fast-follow ADR.** When does it land? Concretely: the first slice that runs untrusted code, executes a network-egressing build, or processes attacker-controlled inputs. Until then, this ADR's MVP holds.
6. **Per-run GitHub tokens.** The shape under which the dispatcher would mint per-PR tokens (GitHub App installation tokens? fine-grained PATs?) is the right thing to design with the container fast-follow, not now.

## Links

- Related Linear issue(s): LAT-139 (this ADR), LAT-129 (dispatcher MVP, on `main`), LAT-133 (PRD: useful local agent dispatch loop MVP), LAT-135 (executable shell checks vs. policy validations, on `main`), LAT-136 (next implementation slice — worktree harness + lease store), LAT-137 (resource-lock primitives + concurrency bounds).
- Related ADRs: ADR-0006 (run-evidence envelope), ADR-0008 (control layer & Stop list), ADR-0009 (cost bands & runaway-cost interrupt), ADR-0011 (ICP language/runtime — Node/TS/npm), ADR-0013 (agent invocation boundary), ADR-0014 (telemetry redaction), ADR-0017 (credentials & secrets residence), ADR-0018 (first ICP runtime — frontier path), ADR-0019 (opencode + Qwen runtime), ADR-0020 (cost-class inference routing policy), ADR-0021 (dispatcher synthesis boundary and deterministic hard stops — proposed on a parallel branch; this ADR consumes its "synthesis recommends, gates decide" frame).
- Related PRD: `docs/prds/LAT-133-useful-local-agent-dispatch-loop.md` (proposed on a parallel branch).
- Related prototype / spike: none — this ADR codifies the MVP shape before the harness lands. LAT-136 / LAT-137 are the implementation slices.
