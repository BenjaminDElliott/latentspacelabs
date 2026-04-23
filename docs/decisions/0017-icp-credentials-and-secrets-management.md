---
id: ADR-0017
title: ICP credentials and secrets management
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-37
  - LAT-60
  - LAT-61
  - LAT-62
  - LAT-64
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) a second operator joins the pilot and per-operator credential scoping is needed, (b) a non-local execution substrate (hosted runner, scheduler, service) needs ICP credentials and the local env + CI-secret split no longer covers both, (c) a real secret is ever committed to git, pasted into a PR body, written to a log, or recorded in a run artifact, (d) the adapter surface grows past Linear + GitHub + the single Perplexity MCP bridge (e.g. a direct model-provider key, a cloud provider key) and the least-privilege table below no longer enumerates all live credentials, or (e) a rotation event materially disrupts a run because revocation semantics were not pre-agreed.
---

# ADR-0017: ICP credentials and secrets management

## Context

ADR-0008 (Open Question 4), ADR-0011, ADR-0012, ADR-0013, and ADR-0014 all defer the same decision: where do ICP credentials live, how are they loaded at runtime, and what must never enter the repo, run reports, or durable artifacts. LAT-52 shipped the first skill under a stubbed Linear adapter. LAT-60 promotes that adapter to production and binds the provider registry to real network calls; it needs a concrete credential-loading contract. LAT-61 (agent-invocation adapter) and LAT-62 (CI / sandbox execution) are blocked on the same decision. The MVP cannot take another sequencing step without closing this.

LAT-64 (`docs/prds/LAT-64-agent-environment-secret-injection.md`) is the product-requirements input to this ADR. It enumerates the six execution contexts (local dev, CI, coding-agent sandbox, future ICP runner, MCP invocations, future provider adapters), the five secret classes (Linear, GitHub, MCP / proxy, model provider, future service tokens), and the non-functional requirements the loader must meet. This ADR does not re-derive that taxonomy; it picks the MVP policy that satisfies it.

**Local environment variables are an expected residence for credentials during the pilot.** The operator keeps Linear, GitHub, MCP, and model-provider credentials in a local shell env, an OS keychain, or a dotenv outside the working tree. That is load-bearing, not a leak. The invariant that matters is narrower and harder: **real secret values must not be committed to git, included in PR bodies, echoed to logs, serialised into run reports or artifacts, or pasted into chat / Linear / Perplexity citations.** Secrets reach agent environments through explicit, context-specific injection mechanisms owned by the harness and the credential loader — not through files checked into the repo.

This is a decision ticket, not a secrets-manager implementation ticket. It does not stand up Vault, AWS Secrets Manager, or a CLI keyring integration. It names: (1) how local credentials are loaded, (2) how CI and agent sandboxes receive credentials, (3) what the repo must and must not contain (`.env.example`, `.gitignore`, `.mcp.json`), (4) least-privilege scopes per integration, (5) MVP rotation and revocation expectations, and (6) what a skill or adapter can and cannot do with a loaded credential at runtime. It closes ADR-0008 Open Question 4.

## Decision Drivers

- **Repo is a publication surface (ADR-0001, ADR-0014).** Anything committed to `main` is effectively public. A committed real credential is not a bug to fix later — it is an incident that requires rotation.
- **Local env vars are not leaks (LAT-64 §3, §6.1 C1).** The pilot explicitly permits the operator to keep credentials in an OS keychain, a dotenv outside the repo, or a shell env. The discipline is about what moves from that residence into durable or shared surfaces, not about the residence itself.
- **Anti-astronautics (`docs/decisions/README.md`).** The MVP has one operator and three live integrations (Linear, GitHub, the Perplexity MCP bridge). A full secrets manager is unjustified; a disciplined local-env + CI-secret split with a typed loader is.
- **Uniform config/secret loading (ADR-0011 §1, ADR-0013 §Secrets, LAT-64 §6.3.1).** Skills must not read `process.env` directly — they receive credentials through a typed loader the runtime owns. The loader is the single choke point for redaction, identity-only logging, and "fail closed on missing".
- **Least privilege by default (LAT-64 §6.3.1, ADR-0007 §critical).** Every token the pilot issues itself is scoped to the narrowest API surface the ICP actually uses today. Scope creep requires an ADR amendment or supersession, not a quiet token upgrade.
- **No secret value in a run report, PR, chat, or Linear comment (ADR-0013 §Secrets, ADR-0014 §redaction, LAT-64 §6.3.3).** The write surfaces are unchanged; this ADR makes the rule binding on the credential loader itself.
- **One operator, Node/TS/npm only (task guardrails, ADR-0011).** Any tooling choice that implies Python, pnpm, yarn, or a second runtime is out.
- **CI is public-visible.** `npm run check` must pass without any of the integration secrets. The guardrails (typecheck, build, ADR/PRD validators, policy-scan, tests) were chosen in prior ADRs precisely because they are offline. This ADR must not regress that.
- **Sandbox agents are ephemeral (ADR-0013, LAT-64 §6.1 C3).** A coding subagent spawned for one ticket must not retain credentials past the run. Credential material reaches the sandbox through the harness's environment, not through committed files.

## Considered Options

1. **Keep deferring; let each integration ticket (LAT-60, LAT-61, LAT-62) invent its own loader.** Rejected: every downstream ticket picks a different shape, the loader duplicates itself, and the "no secret value in run report" rule is enforced three different ways or not at all. This is exactly the trap ADR-0011 §1 names.
2. **Stand up a secrets manager (Vault, Doppler, 1Password CLI, AWS Secrets Manager) now.** Rejected for MVP: one operator, three integrations, no multi-environment requirement yet. The operational cost (account, rotation automation, bootstrap chicken-and-egg) exceeds the risk it reduces at this stage. Noted in the revisit trigger for when that changes. LAT-64 §3 pins this as an explicit non-goal for the PRD.
3. **Commit raw credential values in `.mcp.json` or similar, relying on repo privacy.** Rejected outright: the repo is public-visible per ADR-0001/ADR-0014, and "private repo" is not a secrets boundary even when the repo is private. This is the incident path, not a decision path.
4. **Local residence (OS keychain, dotenv outside repo, shell env, or workspace `.env` that is git-ignored) loaded by a typed ICP config module; CI secrets via GitHub Actions `secrets.*`; `.mcp.json` committed with `${VAR}` placeholders only; least-privilege scopes enumerated here; rotation on a calendar + on-leak; revocation semantics named.** *Chosen.*

## Decision

The pilot adopts six rules. All are enforceable at review time against the repo and the loader; none requires new infrastructure. The rules map directly to LAT-64 §6.1 – §6.3.

### Rule 1 — Local dev: credentials in a sanctioned local residence, loaded by a typed ICP config module

- Operators keep credentials in a sanctioned local residence: an OS keychain, a dotenv file outside the working tree, a shell env exported from a provisioning profile, **or** a workspace-root `.env` that is git-ignored. LAT-64 §6.1 C1 names these as the allowed residences; precedence between them is a LAT-64 §9 open question owned by the loader implementation.
- The ICP exposes a single typed config module (introduced by the LAT-60 / LAT-61 work; shape owned by this ADR) that:
  - loads the sanctioned residence once at process start,
  - validates required keys with a Zod-shaped schema per declared integration,
  - exposes credentials only as opaque handles (`{ linear: LinearCredential, github: GithubCredential, ... }`) to skills,
  - never returns a raw string through its public API — skills pass the handle to an adapter, and the adapter is the only module that resolves the handle to a header value,
  - fails closed on missing required keys with a message naming the missing var and linking to `.env.example`, never with the key value itself redacted-to-empty.
- Skills and runtime code MUST NOT read `process.env` directly for integration credentials. The policy scanner (`packages/policy-scanner`) gains an allowlist for the config module as the sole permitted reader (implementation in LAT-61 / LAT-63; the rule is binding from this ADR forward).
- `.env.example` is committed at the workspace root, enumerates every key the loader recognises with a short inline comment naming its integration and its expected scope, and contains only placeholder values (`*_CHANGEME`, `example-token-only`). It is the single source of truth for "what does a working local env need."

### Rule 2 — CI and agent sandbox: environment variables from the harness

- CI (`.github/workflows/check.yml`) runs `npm run check`. `npm run check` MUST remain offline — it MUST NOT exercise any integration that requires a secret. All credentialled operations (live Linear writes, live GitHub PR actions beyond `gh` auth, MCP bridge calls) are invoked outside `check.yml` or behind an explicit `--live` flag that is not part of `check`.
- When a future workflow or scheduled job needs a credential, it reads from GitHub Actions `secrets.*` and exports it as an env var for the step. The ICP config module loads from the sanctioned residence (local) or `process.env` (CI) through the same interface — one loader, two contexts.
- Coding agent sandboxes (Claude Code or successor) receive credentials via the harness's environment at spawn time (LAT-64 §6.1 C3). The agent MUST NOT read committed repo files for credential values and MUST NOT persist credentials to run artifacts, chat transcripts, Perplexity threads, or the run report. When the agent exits, the credential is gone with the process; sandbox teardown unsets materialised env vars before any artifact-shipping step (LAT-64 §6.3.10).
- Long-running or scheduled agents are out of scope for this ADR; when they land they inherit Rule 2 or open a superseding ADR.

### Rule 3 — `.env.example` and `.gitignore` expectations

- `.gitignore` MUST ignore `.env` and `.env.*` while allowing `.env.example` (current state; this ADR ratifies it). A PR that weakens this pattern is a review block.
- `.env.example` MUST exist at the workspace root and MUST list every key read by the config module. Adding a new integration is a two-part diff: loader schema + `.env.example` entry, in the same PR.
- `.env.example` MUST NOT contain values that look like real tokens. Placeholders are literal strings like `lin_api_CHANGEME`, `ghp_CHANGEME`, `agp_CHANGEME`. Secret scanners (push protection, GitHub secret scanning) are allowed to block on real-looking prefixes; this rule is what keeps them from firing.
- No file tracked in the repo — including `.mcp.json`, fixtures, test snapshots, run reports, ADRs, PRDs, docstrings — may contain a real credential value. This is the structural invariant from LAT-64 §6.3.2 and §6.3.3: real secrets do not belong in git, PR bodies, logs, artifacts, or run reports, in any shape (raw, base64, hex, prefix, length, or derived hash).

### Rule 4 — Least-privilege scopes per integration

The ICP runs with the minimum token scopes that satisfy its live calls. The loader schema documents each. The class taxonomy matches LAT-64 §6.2 (S1 – S5).

| Integration | Credential kind | Scope granted today | Scope explicitly NOT granted | Notes |
|---|---|---|---|---|
| Linear (S1) | Personal API key | Read + write issues, comments, relations, labels, states in the `LAT` team only. | Admin, billing, team creation, integration installation, webhook management. | The adapter writes back per ADR-0003's five-element contract and reads dispatch inputs. OAuth app is deferred until a second operator or hosted runner appears (revisit trigger). |
| GitHub (S2) | Fine-grained PAT (or `gh` CLI OAuth for interactive use) | `contents:read/write`, `pull-requests:read/write`, `issues:read/write` on the single `BenjaminDElliott/latentspacelabs` repository. | Admin, workflow edit, org-level actions, access to any other repository, `write:packages`. | The PAT is repo-scoped, not user-scoped. Workflow YAML edits are not agent-authorised (ADR-0008 Stop list); the scope here enforces that at the API layer too. |
| Perplexity / MCP bridge (S3) | Bearer token | Exactly the scope the Perplexity agent proxy issues; no additional inference. | Anything the proxy does not issue; no reuse as a generic API key for other Perplexity products. | Loaded from `AUTH_TOKEN` env var and interpolated into `.mcp.json` by the harness. `.mcp.json` tracks only the `${AUTH_TOKEN}` reference — never a literal. |
| Model providers (S4) | API key (Anthropic, etc.) | None held by the ICP repo today — model calls happen via the harness the operator runs (`claude-code`, Perplexity). | Any direct provider key checked into this repo. | If a skill ever needs a direct provider key, open a follow-up ADR; do not add a new env var silently. |
| Future service tokens (S5) | Per-provider | Declared per-skill via `credentials_required`; scope minimised to the skill's need. | Any capability beyond what the skill declares. | Adding a class requires a PRD row edit (LAT-64 §6.2) and a loader change. |

A scope increase on any of the above requires a PR that (a) updates this table, (b) updates `.env.example` if the key shape changes, (c) justifies the increase in the PR body against the least-privilege driver. "The adapter got a 403" is not a justification without naming the specific call that failed and why it is in-scope for the MVP.

### Rule 5 — MVP rotation and revocation expectations

- **Calendar rotation.** Each credential in the table above is rotated at least every 90 days. The operator sets a recurring reminder; this ADR does not mandate automation.
- **On-leak rotation.** A leak is a real credential value that has crossed into a durable or shared surface: a commit on any branch, a pushed artifact, a CI log, a PR body, a Linear comment, a Perplexity thread that is not known-private, or a shared sandbox that outlived its expected lifetime. When a leak occurs the credential is **immediately revoked** at the issuing surface (Linear settings, GitHub token settings, Perplexity proxy console) and re-issued with the same scope. The PR or Linear comment that records the incident names which credential, when revoked, when re-issued, and which surfaces were updated — and records no further detail about the credential. Rotation order is revoke-then-reissue.
- **Local workspace hygiene is not a leak event.** A credential sitting in an operator's local shell env, in a workspace-root `.env` that is git-ignored, in a local stash, or in an untracked working-tree file is **not** a leak under this rule. Those residences are sanctioned by Rule 1 / LAT-64 §6.1 C1. Local workspace hygiene (clearing stashes, tearing down sandboxes, unsetting shell env) is owned by the harness's sandbox teardown and the operator's secret-injection process (LAT-64 §6.3.10), not by repo policy.
- **Departure / handoff.** When the operator changes, every credential in the table is revoked and reissued under the new operator's identity. There is no shared credential in MVP; there is also no "service account" until a second operator or hosted runner lands (revisit trigger).
- **Run-report reference, never value.** Per ADR-0013, ADR-0014, and LAT-64 §6.3.4, run artifacts reference credential *identity* (e.g. "Linear personal API key for operator X") and never the value, a prefix, a length, or a derived hash. This ADR makes that binding on the loader: the loader's public surface has no method that returns the raw string outside the adapter module that uses it.
- **No grace period for committed secrets.** A PR that would commit a real credential is rejected at review; if a real value ever lands anyway, that is a Rule 5 leak event and the credential is rotated immediately per the on-leak path above. Force-push is a Stop action per ADR-0008 — rotation, not history rewriting, is the primary defence.

### Rule 6 — `.mcp.json` is committed with env-var references only

- `.mcp.json` at the workspace root MAY be committed. It is useful to operators and to review. It is the harness's config, not a secret.
- `.mcp.json` MUST contain only `${VAR}`-style references for any credential field. The harness interpolates from the operator's environment at load time. A literal bearer token, API key, or password MUST NOT appear in `.mcp.json` on any branch, at any commit.
- Operators who need a locally-interpolated `.mcp.json` (e.g. for a harness that does not support `${VAR}` resolution) keep that locally-modified copy out of git via `.gitignore`; the tracked file stays sanitised. This is the C5 injection shape from LAT-64 §6.1: env var reference resolved at launch, never a literal `args[]` argument and never a literal `env` value in tracked config.

## Consequences

Good:

- ADR-0008 Open Question 4 closes. LAT-60, LAT-61, LAT-62 unblock against a concrete loader contract and scope table.
- LAT-64's policy-surface requirements (§6.4) are satisfied at the ADR level: loader interface, sanctioned residences, per-class scope policy, rotation policy, MCP residence, and ADR-0008 OQ4 all decided here.
- The "no secret value in a run report / PR / chat" rule becomes enforceable at the loader, not only at review time (ADR-0013, ADR-0014, LAT-64 §6.3.3).
- `.mcp.json` is safe to commit with placeholders, which lets operators onboard from a clean clone + local residence rather than hand-editing a local-only tracked file.
- Least-privilege scopes are written down and auditable. Scope creep shows up as a PR diff to this ADR, which is exactly where review should see it.
- CI remains offline. `npm run check` is unaffected; the guardrails continue to run without any integration secret.
- No new infrastructure. One operator, three integrations, a typed loader, a calendar reminder.

Bad / open:

- Manual rotation is a discipline, not a control. A missed 90-day reminder is invisible until an audit. The revisit trigger names the conditions under which this stops being acceptable.
- The loader is specified by contract here but built in LAT-60 / LAT-61. Between merge of this ADR and merge of LAT-60 / LAT-61, the binding rule "skills don't read `process.env`" is a review-time convention. ADR-0013 and LAT-64 §6.3 already treat pre-loader secrets discipline as a review-time convention, so this is consistent with prior work.
- Fine-grained GitHub PATs have shorter max lifetimes than classic PATs; the 90-day cadence is compatible with current GitHub limits but could be shortened to 30–60 days without disruption if GitHub tightens defaults.
- The Perplexity MCP bearer token is issued by the proxy with scopes the ICP does not control. "Least privilege" for that integration means "we do not request additional proxy capabilities" rather than a fine-grained token — Rule 4 documents this honestly.
- `.env.example` drift is a real failure mode: a new key lands in the loader schema without a matching `.env.example` entry. The binding rule names this but does not yet have a CI check. LAT-63 is the candidate ticket for a loader-vs-example cross-check under `npm run check`.
- Precedence between residences (OS keychain vs dotenv outside repo vs workspace `.env`) is not pinned here. LAT-64 §9 open question 2 defers this to the implementation in LAT-62; the loader's public interface is identical across them.

## Confirmation

The decision is working when:

- `.mcp.json` on `main` contains only `${VAR}` references, not literal tokens; CI continues to pass; operators can clone, populate a local residence from `.env.example`, and run the ICP with no further editing of tracked files.
- The LAT-60 adapter, the LAT-61 agent-invocation adapter, and the LAT-62 CI / sandbox work all consume the same config module and pass its credential handles — not raw env reads — through their skills.
- Review can answer "what credentials does the ICP hold, at what scope?" by reading this ADR's table, and that table matches the loader schema.
- Run reports under `runs/`, PR bodies, and Linear write-backs reviewed at random contain no credential values, prefixes, or derived metadata — only identities (spot-checked in the LAT-54 retrospective loop per ADR-0010; LAT-63 adds structural scrubbing).
- Rotation events, when they occur, are recorded in a Linear comment or PR body naming the credential, the revoke time, the re-issue time, and the surfaces updated — and nothing else about the credential.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest path to revisiting is a single committed-secret incident despite these rules; the next shortest is onboarding a second operator.

## Links

- Related Linear issue(s): LAT-37 (this decision), LAT-60 (Linear adapter promotion, consumes the loader), LAT-61 (agent-invocation adapter, consumes the loader), LAT-62 (CI / sandbox execution, consumes Rule 2), LAT-64 (PRD input for secret-injection requirements).
- Related PRD: `docs/prds/LAT-64-agent-environment-secret-injection.md` — the product-requirements input. This ADR is the policy surface LAT-64 §6.4 identifies as LAT-37's scope.
- Related ADRs: ADR-0001 (control-plane substrates), ADR-0007 (QA critical-severity rule for exposed secrets), ADR-0008 (agent control layer — Open Question 4 closed here), ADR-0011 (uniform config/secret loading), ADR-0012 (skill runner hosts the loader), ADR-0013 (secrets never in skill inputs or run reports — made binding at the loader here), ADR-0014 (run-report redaction — reaffirmed and extended to derived metadata), ADR-0016 (skill directory and adapter layering — the loader is an adapter in that layering).
