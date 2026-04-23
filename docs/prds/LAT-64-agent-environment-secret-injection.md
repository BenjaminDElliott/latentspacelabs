---
prd_id: LAT-64-agent-environment-secret-injection
title: Agent environment secret injection
status: draft
owner: Ben Elliott
date: 2026-04-23
related_linear:
  - LAT-64
  - LAT-37
  - LAT-61
  - LAT-62
  - LAT-63
related_adrs:
  - ADR-0001
  - ADR-0003
  - ADR-0006
  - ADR-0008
  - ADR-0012
  - ADR-0013
  - ADR-0014
  - ADR-0016
derived_from:
  - root-agentic-development-flywheel
supersedes:
superseded_by:
---

# PRD: Agent environment secret injection

## 1. Problem Statement

The pilot already runs against real credentials — a Linear API key, a GitHub token, the Perplexity MCP proxy bearer token in `.mcp.json`, model-provider keys inside the coding-agent sandbox — and the operator (Ben) correctly keeps those credentials in his local environment. The problem is **not** that local env vars exist; those are expected and load-bearing during the pilot. The problem is that the architecture has **no deliberate model** for how those credentials reach each execution context (local dev, CI, Perplexity-spawned coding-agent sandboxes, the future ICP runner, MCP tool invocations, and future provider adapters), nor any explicit invariants that keep them out of the repo, PR bodies, agent logs, run reports, and durable artefacts. ADR-0013 names a "credential loader" as the point of enforcement but defers its scope; ADR-0008 open question 4 still leaves authentication mode and credential residence for Linear undecided; the MCP proxy bearer token is inlined in `.mcp.json` today without a refuse-to-load rule if the file is committed; and the ADR-0014 "`runs/` contains no secrets or PII" rule is a review-time convention with no structural enforcement. Without a PRD that fixes the contexts, secret classes, and non-functional requirements now, each new surface (MCP, ICP runner, future provider) will re-derive its own ad hoc discipline, and the first leak — into a PR body, a committed config, a run report, or a Perplexity citation — will land before anyone noticed the gap.

## 2. Goals

1. Enumerate the **execution contexts** that consume credentials today or in the near-term pilot — local dev, CI, Perplexity / coding-agent sandboxes, the future ICP runner, MCP tool invocations, future provider adapters — and state, per context, how secrets must enter and how they must not.
2. Enumerate the **secret classes** in scope — Linear, GitHub, MCP / proxy, model-provider, future service tokens — and fix per-class expectations for residence, shape at the consumer, and rotation/revocation posture.
3. Define **non-functional requirements** for injection: least privilege, no-repo-commit invariant, auditability, rotation, revocation, local ergonomics, failure / refusal behaviour, and non-logging / non-artefact persistence.
4. Separate **policy from mechanism**: name what LAT-37 owns as an ADR / policy surface (where secrets may live, who may mint them, what the minimum contract is at the ICP invocation seam) from what LAT-61 / LAT-62 / LAT-63 implement (the credential loader, the CI / sandbox plumbing, the scrubbing hooks). This PRD does not pick a production secret manager.
5. Produce **acceptance criteria** concrete enough that the implementing tickets (LAT-61 / LAT-62 / LAT-63) can cite them directly in their agent-ready bodies — and that a future reviewer can check without re-reading this PRD in full.

## 3. Non-Goals

1. **No production secret-manager choice.** Vault vs. 1Password vs. AWS/GCP KMS vs. GitHub Environments vs. a hybrid is left to an ADR (candidate: LAT-37 follow-up or a sibling). This PRD fixes invariants, not vendors.
2. **No implementation of secret injection.** No credential loader code, no CI wiring, no sandbox hook, no scrubbing filter ships under this PRD. Those are LAT-61 / LAT-62 / LAT-63 and downstream tickets.
3. **No mandate to store secrets in the repo.** The PRD is explicit: no secret class lands in the repo, ever, including in frontmatter, fixtures, snapshots, examples, test data, or docs. This is a non-goal of committing; it is a **requirement** of not committing.
4. **No treatment of local environment variables as leaks by default.** Ben's local shell env is an expected, legitimate source during the pilot. The PRD governs how credentials move from that source through each context — not whether they may be there.
5. **No replacement of ADR-0008 / ADR-0013 / ADR-0014 gates.** The existing Stop rules on "change secrets, tokens, connector permissions" (see `docs/process/approval-gates-and-autonomy-rules.md`) remain in force. This PRD refines *how* secrets flow within those gates, not what the gates are.
6. **No coverage of human-to-human secret sharing, onboarding, or offboarding workflows.** Out of scope during the solo-operator pilot.
7. **No scope over PII, customer data, or data-residency regimes.** Credentials only. PII handling is a separate concern and already flagged by ADR-0014.
8. **No cryptographic key-management specification** (HSM policy, signing keys, TLS pinning). Out of scope; revisit if a future agent type introduces signing responsibilities.

## 4. Primary Users

1. **Ben (operator / sole pilot user).** Needs local ergonomics that do not force him to re-enter credentials per run or manage a baroque secret-manager UX during a solo pilot. Needs confidence that no credential he holds locally can leak into a committed file, a PR body, a durable run report, or a Perplexity citation. Is the current approver for all Stop-category changes to secrets per `approval-gates-and-autonomy-rules.md`.
2. **ICP skill runner and agent invocation adapter.** Per ADR-0012 / ADR-0013, the skill runner is the single enforcement point for invocation policy. The credential loader is the invocation-side mechanism the runner calls so that skill inputs, run reports, and Linear write-backs never carry credential *values* — only credential *identity*.
3. **Coding / QA / PR-review / future agents (sandboxed runners).** Consume a minimal, least-privileged set of env vars the loader injects at the sandbox boundary. They never read credentials from files in the repo, from `runs/`, or from prompt text Perplexity renders.
4. **Perplexity (as cognition front door).** Is **not** an agent invoker (ADR-0008 / ADR-0013). Any secret Perplexity needs to trigger an ICP run must come from the ICP credential loader at invocation time — not from prompt context, not from pasted tokens, not from connector state Perplexity persists across threads.
5. **CI (`npm run check` on `main` and PRs).** Is a constrained runner: read-only on most surfaces during the pilot, writes only green-check status back. Any credential CI needs (none today beyond what GitHub Actions provides intrinsically) must enter via GitHub Actions secrets, never via the checked-in repo.
6. **Future human collaborators (post-pilot).** Must be able to read the PRD and the future ADR and understand which context consumes which class of credential, without trawling `.mcp.json`, CI YAML, and the credential loader source simultaneously.

## 5. Operating Model / Workflow

Secret injection sits underneath the Perplexity → Linear → repo flow defined in `docs/process/operating-model.md`. It does not introduce a new approval gate; it binds existing gates to structural invariants at the consumer.

- **Intake and triage (Perplexity, Linear).** Unchanged. Perplexity reads Linear, drafts tickets, does not hold or pass secrets into skill inputs.
- **Dispatch (ICP skill runner).** Per ADR-0012 / ADR-0013, every invocation flows through the skill runner. The runner calls the credential loader for the subset of secrets the invoked skill declares; unknown or undeclared secret requests are refused, per ADR-0013's "isolation and safety expectations" section. Credential *values* never appear in skill inputs, run reports, or Linear write-backs; credential *identity* (names, scopes, provider) may be referenced in `agent_metadata.runtime.harness` or equivalent.
- **Execution (agent runner sandbox).** The agent invocation adapter materialises the minimum set of env vars or equivalent injection handles in the sandbox, scoped to the run, and tears them down when the run ends. No credential persists in the sandbox after the run, and nothing in the sandbox's filesystem image or process state is exfiltrated into `runs/`, PR bodies, or Perplexity citations.
- **Evidence (run report, Linear write-back, PR).** The ADR-0006 envelope, the ADR-0007 QA/review reports, the ADR-0003 write-back, and the PR body are all **credential-value-free** by construction. The run recorder, write-back formatter, and PR description template are bound to refuse rendering any field whose value matches a known secret pattern.
- **Approval gates (unchanged).** Changing secrets, tokens, or connector permissions remains Stop per `docs/process/approval-gates-and-autonomy-rules.md`. The credential loader does not mint, rotate, or revoke credentials autonomously. A rotation is a human action; the loader only *uses* the credentials a human (or a provisioning tool) has already placed in the sanctioned residence.
- **Autonomy.** No autonomy level — including a future L4 — unblocks a write to a credential residence or a serialisation of a credential value into a durable artefact.

## 6. Requirements

### 6.1 Execution contexts (must)

The PRD fixes, for each context, the sanctioned residence of secrets, the injection shape at the consumer, and the strict prohibitions. A future ADR may narrow any of these; a future ticket may extend the set by adding a new context row — not by changing the invariants on the existing rows without a PRD revision.

| # | Context | Who uses it | Sanctioned residence of secrets | Injection shape at consumer | Must NEVER |
|---|---|---|---|---|---|
| C1 | Local dev (Ben's shell) | The operator invoking skills, scripts, `npm run` tasks | OS keychain, dotenv file **outside** the repo, or shell env exported from a provisioning profile. Never inside the working tree. | Process env vars scoped to the invoking shell. | Commit a `.env` inside the repo; paste tokens into code comments, fixtures, snapshots, or PR bodies. |
| C2 | CI (`npm run check` on PRs / `main`) | GitHub Actions runner | GitHub Actions **repository / environment secrets**, scoped to the minimum set of jobs that need them. | Env vars materialised by GitHub Actions into the job's process env. | Check in a CI secret in a workflow file; echo a secret to the job log (`::add-mask::` or equivalent scrubbing is required if any interpolation risk exists); persist a secret to artefacts, caches, or re-usable workflows without equivalent scoping. |
| C3 | Perplexity / coding-agent sandbox | The agent runner Perplexity spawns for an ICP-Routed invocation | The credential loader, invoked by the ICP skill runner at dispatch time. In the pilot the loader's backing store is Ben's local credential residence (C1) plus CI's secret store (C2) depending on where the ICP runs from; the loader's **interface** is fixed here and the backing store is a future ADR. | Env vars materialised into the sandbox at invocation, scoped to the run and torn down on run exit. | Accept credentials in skill *inputs*; read credentials from files checked into the repo; serialise credentials into `agent_metadata`, `correlation`, the run report narrative, or the Linear write-back; log credentials via the agent runner's stdout / stderr stream that is captured into the run record. |
| C4 | ICP runner (future, post-pilot) | The ICP deployed as a long-running service, dispatching skills on demand | A production secret manager (choice deferred to a future ADR). The loader interface defined by LAT-37 and implemented by LAT-61 is the same; only the backing store changes. | Env vars materialised into the skill runner's process env (or a stricter handle, e.g. a fetch-on-demand client) and propagated to sandboxes per C3. | Persist credentials in the ICP's working filesystem; log credentials to the structured log stream; cache credentials beyond their declared lifetime; share a credential across skills that did not each declare it. |
| C5 | MCP tool invocations (e.g. `.mcp.json` / `agent_handler`) | The MCP proxy (today `https://agent-proxy.perplexity.ai/merge_mcp`) and future MCP servers | The credential loader provides the bearer via an env var placeholder that the MCP runtime interpolates at process start; the raw token never sits in the checked-in `.mcp.json`. | Env var reference (`Bearer ${AUTH_TOKEN}` shape) resolved at launch. | Commit a raw bearer token inside `.mcp.json` or any other MCP descriptor; pass a secret as a literal argument in `args[]`; leave the token in shell history or exported profiles without rotation policy. |
| C6 | Future provider adapters (new model vendor, new Linear-like surface, new deploy provider) | Adapter code invoked from skills | Same loader interface as C3 / C4; the adapter declares which credential classes it needs and the loader resolves them. | Env vars scoped to the adapter's call, or a fetch-on-demand client handle; shape declared in the skill's `credentials_required` (see §6.3). | Ship an adapter that reads credentials directly from `process.env` without declaring them; hard-code credentials into adapter source; bypass the loader "just for local testing." |

Local env vars are explicitly allowed as a *residence* for C1 during the pilot; they are **not** allowed as an undeclared *injection path* for C3 / C4 / C6. An adapter that reads `process.env.LINEAR_API_KEY` without declaring the credential to the loader is a defect, even if the env var happens to be present.

### 6.2 Secret classes (must)

Every credential in the pilot falls into exactly one class. New classes require a PRD revision (small edit, not a new PRD) and a matching loader change.

| # | Class | Examples | Expected scope | Expected rotation posture | Notes |
|---|---|---|---|---|---|
| S1 | **Linear** | Linear personal API key (pilot) or OAuth app token (future, per ADR-0008 open question 4) | Read + write on the `LAT` team only. Not organisation-wide admin. | Revocable from the Linear UI; rotated on any suspicion of leak or contractor change; rotation is a human action per `approval-gates-and-autonomy-rules.md`. | ADR-0003 write-back depends on this; ADR-0008 open question 4 is the residence question. |
| S2 | **GitHub** | Personal access token or GitHub App installation token for this repo | Repo-scoped; the minimum of `contents:read/write`, `pull_requests:read/write`, and `issues:read/write` needed by the active skills. No org-admin, no workflow write, no package or release write unless a skill declares it. | Rotatable from GitHub settings; App installation tokens expire by construction and are preferred over PATs for longer-lived use. | `thread-approved-merge-authority.md` already makes secret/credential changes Stop-category; this class inherits that gate. |
| S3 | **MCP / proxy** | Perplexity MCP proxy bearer (`AUTH_TOKEN` in `.mcp.json`); future MCP server credentials | Scoped per MCP server; bearer rotates when the proxy issues a new one. | Rotated by regenerating the bearer on the proxy side and re-placing the value in the C1 / C4 residence. | The current `.mcp.json` literal is a pilot workaround; §6.3.4 requires it to move out of the repo. |
| S4 | **Model provider** | Anthropic / other LLM API keys consumed by the agent runner inside the coding-agent sandbox | Scoped to the provider account used for the pilot; usage-capped at the provider level where possible. | Rotated on suspicion, or on each discrete billing-boundary change; rotation is a human action. | Never appears in the ICP skill runner's env; lives only in the agent runner sandbox (C3), materialised at dispatch. |
| S5 | **Future service tokens** | A deploy provider, an SRE surface, a second Linear-like tool, an analytics sink, etc. | Declared per-skill via `credentials_required`; scope minimised to the skill's need. | Matches the provider's rotation affordances; documented in the skill's `README` and in the future ADR when the provider is onboarded. | Adding a class requires a PRD revision row here plus a loader change; a future agent type that needs a new class cannot silently extend the set. |

A skill's `credentials_required` declaration (introduced by LAT-37 at the ADR level and implemented by LAT-61) must name the *class* and the *scope*, not the value. The loader rejects any requested class that is not in the table above without a PRD amendment.

### 6.3 Non-functional requirements (must unless flagged)

1. **Least privilege.** Each skill declares the minimum set of secret classes and scopes it needs; the loader refuses any other. A skill that does not declare `credentials_required` defaults to **no credentials** — not to a "pilot convenience" global set. This closes the silent-extension failure mode where an adapter accidentally picks up a token from process env.
2. **No repo commits (invariant).** No credential of any class, in any shape (raw string, base64, hex, test fixture, snapshot) lands in the working tree. This is a structural invariant, not a review-time convention. The policy scanner (`npm run policy-scan`) should grow a secret-pattern sweep; the credential loader must refuse to read from any path inside the repo. The existing `.mcp.json` pattern (C5) is explicitly called out as needing remediation under LAT-62.
3. **No logging / no-artefact persistence (invariant).** Credential *values* never appear in run reports (`runs/*.json`, `runs/*.md`), Linear write-backs (ADR-0003), PR bodies, Perplexity citations, the agent runner's captured stdout / stderr, structured logs, or cached artefacts. The run recorder, the write-back formatter, and any log shipper must scrub on write, not on read.
4. **Auditability (must).** Every invocation's run report names which *classes* of credentials it requested (not values), via `agent_metadata.runtime.harness` or a sibling field, so that a reader can answer "did this run have access to GitHub write? to Linear write? to model-provider keys?" without opening the loader's source. This is the *read-side* complement to §6.3.1's declaration.
5. **Rotation support (must).** The loader interface must not pin skills to a specific credential *value*; rotation is a redeploy-free operation on the loader's backing store. Skills re-fetch on the next invocation. No caching longer than the lifetime of a single run.
6. **Revocation behaviour (must).** When a credential is revoked at source (Linear, GitHub, MCP proxy, model provider), the next invocation that requests it fails closed, with a refusal mapped to ADR-0013's invocation-refusal shape (Stop at the skill runner; no retry storm; the run report captures the refusal class, not the credential identity in a way that would confirm its value).
7. **Local ergonomics (should).** A solo-operator local loop is the expected primary usage during the pilot. The loader's default backing store for C1 is a conventional residence (OS keychain or a single dotenv outside the repo) that Ben can populate with a one-time setup and not touch again until rotation. A hostile UX that requires a password prompt per invocation is explicitly a failure mode to avoid — the goal is frictionless local runs alongside hard invariants, not the inverse.
8. **Failure and refusal behaviour (must).** A missing credential class declared in `credentials_required` is a pre-flight refusal, not a mid-run crash. The skill runner never partially invokes an agent missing a declared credential. Refusal semantics conform to ADR-0013's Stop / Proposed classification: missing secret is a Stop at the invocation boundary; malformed secret (e.g. expired token, wrong scope) is a Stop that the run report captures under `errors[]` with class `credential_unavailable` or `credential_insufficient_scope` (no value, no token prefix, no hash stored).
9. **Non-logging of request metadata that would reconstruct secrets (must).** Token prefixes, last-N-characters, length, or any metadata that narrows a guess are treated as credential-value-equivalent for persistence purposes. The ADR-0014 "no secrets in `runs/`" rule is extended here to cover partial / derived representations.
10. **Sandbox teardown (must).** At run exit, the agent runner's materialised env vars are unset before any artefact shipping step. If an artefact shipper ever needs to re-authenticate (e.g. to push a run report to a remote telemetry backend post-ADR-0014), it requests a fresh credential via the loader; it does not re-use the sandbox's materialised copy.
11. **Scope of Perplexity context (must).** Perplexity threads never carry credential values. Any time Ben pastes a token into a Perplexity thread "to test something," that token is treated as compromised and rotated. This is a human-side discipline backed by §6.3.2 / §6.3.3 on the system side.
12. **CI parity (should).** CI's credential surface (C2) should be a strict subset of the local dev surface (C1). If the pilot ever grows a CI-only credential, it is added to S5 with a matching PRD row and loader change — not silently smuggled into a workflow file.
13. **Boundary clarity with Stop gates (must).** Editing a secret's residence, raising a credential scope, or adding a new backing store is a Stop per `approval-gates-and-autonomy-rules.md`. This PRD reaffirms — it does not extend — that gate.

### 6.4 What LAT-37 decides (ADR / policy surface)

LAT-37 is the correct home for the durable, architecture-level decisions this PRD points at but does not itself make. Expected ADR scope:

1. **Credential loader interface.** The minimum API between the skill runner / adapters and the loader: declaration shape (`credentials_required`), resolution function (sync vs async, env-var materialisation vs fetch-on-demand handle), refusal errors, and rotation semantics.
2. **Sanctioned residences and precedence.** Per context (C1 – C6), which backing stores are allowed and which takes precedence when multiple are present (e.g. OS keychain > dotenv outside repo > shell env).
3. **Per-class scope policy.** For S1 – S5, the minimum-scope baseline; mechanisms for narrowing (e.g. GitHub App installation vs PAT); and the rule that a skill cannot request a scope above the class baseline without ADR amendment.
4. **Rotation policy.** Frequency expectations per class; rotation actors (human-only, per existing Stop gate); loader-side refresh behaviour.
5. **The MCP / `.mcp.json` residence question.** Whether the pilot's `AUTH_TOKEN` lives in the OS keychain, a dotenv outside the repo, or a per-user shell profile — and the exact hand-off from that residence into the MCP runtime's env.
6. **Resolution of ADR-0008 open question 4.** Linear API authentication mode (personal API key vs OAuth app) and its residence. This PRD makes the question visible; LAT-37 closes it.
7. **Boundary with future production secret manager.** The non-goal stance here is explicit; LAT-37 must either keep it a non-goal or, when the ICP runner (C4) becomes real, name a candidate and the migration path — without re-opening the loader interface.

### 6.5 What LAT-61 / LAT-62 / LAT-63 implement (mechanism)

These implementation tickets cite this PRD and the LAT-37 ADR. Exact slicing between the three is the implementers' call, but the scope of work split across them is:

1. **LAT-61 (credential loader + skill declaration plumbing).** Implements the loader interface ADR defined by LAT-37; wires `credentials_required` into the skill registry / runner; emits the `agent_metadata.runtime.harness` credential-identity field into run reports; owns the refusal paths for missing / malformed / out-of-scope credentials.
2. **LAT-62 (context plumbing for C1 / C2 / C3 / C5).** Implements the local dev residence convention; migrates the current `.mcp.json` literal (`AUTH_TOKEN = agp_...`) out of the repo into the sanctioned C5 residence; wires GitHub Actions secrets into `npm run check`'s minimum surface; materialises sandbox env vars at C3 invocation time and tears them down on exit.
3. **LAT-63 (scrubbing, scanning, and evidence invariants).** Implements the run-recorder / write-back-formatter / PR-description-template scrubbing hooks; adds a secret-pattern sweep to `npm run policy-scan` (`packages/policy-scanner`); extends the run-report validator to refuse rendering credential-shaped substrings; fixes the `runs/` no-secrets rule (ADR-0014) in code, not only in docs.

A ticket that claims to close LAT-64's acceptance criteria must cite the ADR from LAT-37; a PR that implements a scrubber must cite this PRD's §6.3.3. The split above is the default sequencing, not a hard gate: LAT-37 (ADR) is the hard predecessor; LAT-61 / LAT-62 / LAT-63 can be done in parallel once the ADR is merged.

## 7. Acceptance Criteria

- [ ] **Context coverage.** The six execution contexts (C1 – C6) are each named with a sanctioned residence, an injection shape, and an explicit prohibition list. A reader can look up "how do credentials enter CI?" and get one row, not a paragraph of exceptions.
- [ ] **Class coverage.** The five secret classes (S1 – S5) are each named with scope, rotation posture, and a reference to the gate that governs their change. Adding a class requires a row edit and a loader change — surfaced as the structural extension point.
- [ ] **No-commit invariant is structural.** The PRD states the no-repo-commit rule as an invariant (not a convention), names the `.mcp.json` residence as a pilot workaround slated for remediation (LAT-62), and requires the policy scanner to grow a secret-pattern sweep (LAT-63).
- [ ] **No-leak-to-artefact invariant is structural.** The PRD forbids credential values — and credential-derived metadata (prefix, length, hash) — from run reports, Linear write-backs, PR bodies, Perplexity citations, and structured logs. Scrubbing is on write, not on read. The run recorder / write-back formatter / PR description template are explicitly named as enforcement points.
- [ ] **Least-privilege declaration.** Each skill declares `credentials_required` by class and scope; an undeclared credential is refused by the loader. "Default to no credentials" is the stated posture.
- [ ] **Rotation and revocation.** The PRD names rotation as a human action under the existing Stop gate, names revocation as a fail-closed path at the loader, and forbids caching across runs.
- [ ] **Auditability.** Run reports include credential *identity* (classes + scopes requested) without credential *values*. A reader can answer "did this run have GitHub-write?" from the run report alone.
- [ ] **Policy / mechanism split is explicit.** LAT-37's ADR surface is named (loader interface, residence precedence, per-class scope, rotation policy, MCP residence, ADR-0008 OQ4, future-manager posture). LAT-61 / LAT-62 / LAT-63's mechanism scope is named (loader + skill plumbing; context plumbing and `.mcp.json` migration; scrubbing / scanning / evidence invariants). A reader can pick up any of the four tickets and trace their scope back here.
- [ ] **Local ergonomics stated as a positive requirement.** The PRD explicitly rules that solo-operator local runs must not require a password prompt per invocation; hostile UX is a failure mode.
- [ ] **Non-goals honoured.** The PRD does not select a production secret manager, does not require storing secrets in the repo, does not implement injection, and does not treat local env vars as leaks by default.
- [ ] **Gate compatibility.** Nothing in the PRD softens the "change secrets, tokens, connector permissions → Stop" row in `docs/process/approval-gates-and-autonomy-rules.md`. Autonomy level does not override this.
- [ ] **Classifying a new context / class.** The PRD's tables are written so a new row (context or class) can be added in a PRD revision without rewriting the invariants — the extension path is explicit.

## 8. Success Metrics

**Product metrics** (outcome-visible):

- **Secret leak incidents.** Number of PRs, run reports, Linear write-backs, Perplexity citations, or logs that contain a credential value (or credential-derived metadata) post-implementation. Target: **zero** across any pilot cycle once LAT-61 / LAT-62 / LAT-63 are live.
- **Skill–credential surface drift.** Share of ICP skills whose actual credential access (observed at the loader) equals their declared `credentials_required`. Target: **100%**; a drift is a defect, not a warning.
- **`.mcp.json` remediation.** The checked-in `AUTH_TOKEN` literal is removed from the repo after LAT-62 lands; the MCP runtime interpolates from the sanctioned residence. Target: confirmed removed with no regression in MCP tool use.

**Workflow metrics** (process-visible):

- **Local-setup friction.** Time from a fresh clone to a working local run, measured by Ben once after LAT-62 lands. Target: a one-time credential-placement step, no password prompts per invocation.
- **Rotation latency.** From "a credential is rotated at source" to "the next invocation uses the new value without code change." Target: single-run latency (no redeploy, no restart of the skill runner in C4 when it exists).
- **Reviewer load.** Frequency with which PR review agents (ADR-0007) flag a secret-handling defect after LAT-63 lands. Target: trend to zero as scrubbing becomes structural; any flagged defect is a blocker at `medium+` per `qa-review-evidence.md`.

## 9. Open Questions

1. **Production secret-manager candidate for C4.** Explicit non-goal now; belongs to a future ADR when the ICP runner materialises. Noted so implementers do not silently pick one.
2. **Dotenv-outside-repo vs OS keychain for C1 default.** LAT-37 decides; the PRD requires a single recommended path for Ben's local loop, not both.
3. **MCP `AUTH_TOKEN` residence mechanics.** Whether the MCP runtime can resolve `${AUTH_TOKEN}` from an OS keychain via a shell wrapper, or whether a per-invocation resolver is needed, is a LAT-62 implementation question informed by LAT-37's residence precedence.
4. **Linear authentication mode.** ADR-0008 open question 4 (personal API key vs OAuth app). LAT-37 closes this.
5. **Scrubbing scope for numeric / short-form secrets.** Numeric API keys (rare) and short-form MCP bearers are harder to regex-match without false positives. LAT-63 decides the pattern set; the PRD requires that coverage gaps are documented, not hidden.
6. **Artefact encryption at rest for `runs/`.** Out of scope for this PRD (the `no secrets in runs/` rule obviates it for the pilot). If a future telemetry substrate lands (ADR-0014 open question), the substrate ADR inherits this question.
7. **Credential handling across agent handoffs (ADR-0015).** Whether a resumed run inherits the previous run's materialised credentials or re-requests from the loader. Lean: always re-request; confirm in LAT-37.

## 10. Risks

**Product risk:**

- **Hostile UX drives Ben to paste tokens into places he shouldn't.** Mitigation: §6.3.7 makes ergonomics a positive requirement; LAT-62's C1 plumbing must land before stricter scrubbing is enforced operationally.
- **Scrubber is a black-box and masks real errors.** A scrubber that turns a malformed token error into a generic "credential error" hurts debuggability. Mitigation: refusal classes (`credential_unavailable`, `credential_insufficient_scope`) are explicit in §6.3.8; logs carry the *class*, never the *value* or *prefix*.
- **Skills silently pick up local env vars.** An adapter that does `process.env.LINEAR_API_KEY` without declaration works by accident in local dev and fails in C4. Mitigation: §6.3.1 default is "no credentials"; the loader-only path is structural. A lint or a process-env shim may be a LAT-63 follow-up; not mandated here.

**Process / cost risk:**

- **PRD over-specifies and slows implementation.** Mitigation: non-goals explicitly exclude mechanism choice and secret-manager selection. The PRD fixes invariants and contracts, not vendors.
- **Drift between PRD, ADR (LAT-37), and loader code.** Mitigation: the policy / mechanism split in §6.4 / §6.5 is explicit; every implementation PR must cite this PRD and the LAT-37 ADR.
- **Secret-pattern sweep false positives block merges.** Mitigation: LAT-63 decides the pattern set; the PRD requires documented gaps over silent gaps, and the scanner is additive (a warning path exists before it becomes a hard fail).

**Security risk:**

- **A leak happens before LAT-61 / LAT-62 / LAT-63 land.** Mitigation: the invariant is written now, so any leak during the gap is a clear regression, not an "unspecified" situation. The `.mcp.json` `AUTH_TOKEN` literal is called out in §6.1 / §6.2 as a pilot workaround pending LAT-62.
- **Rotation is human-only and therefore slow.** Mitigation: this is deliberate — credential changes are Stop per `approval-gates-and-autonomy-rules.md`. The loader's responsibility is to pick up a rotated value on next invocation without redeploy; it is not to mint or revoke.

## 11. Dependencies

**Hard blockers (must land first):**

- `LAT-37` — the ADR closing credential loader interface, residence precedence, per-class scope policy, rotation policy, and ADR-0008 open question 4. No implementation ticket may land without this.

**Recommended predecessors (preferred order, not gates):**

- `LAT-39` / ADR-0016 — the skill directory and adapter layering decision. Already merged; the credential loader is an adapter in that layering.
- `LAT-21` / ADR-0013 — agent invocation and integration boundaries. Already proposed; this PRD refines the "Secrets" invocation-side responsibility called out there.
- `LAT-18` / ADR-0014 — state, persistence, and telemetry. Already merged; the "`runs/` contains no secrets" rule is extended here to cover derived metadata.
- `LAT-8` / ADR-0003 — Linear persistence boundary. Already merged; the write-back formatter is an enforcement point in §6.3.3.

**External:**

- Linear, GitHub, Perplexity / MCP, and model-provider accounts — already in use; no new provider is required by this PRD.
- CI (GitHub Actions) — already in use; no new runner is required.

## 12. Approval & Autonomy

- **Reading** this PRD and its tables is read-only at every autonomy level.
- **Changing credential residences, scopes, rotation policies, or the loader interface** requires the ADR from LAT-37 or a superseding ADR. These are Stop per `docs/process/approval-gates-and-autonomy-rules.md` and remain so at every autonomy level.
- **Implementing mechanism** (LAT-61 / LAT-62 / LAT-63) follows the pilot's L3-with-approval default per ADR-0008 / ADR-0013. The skill runner enforces the minimum run contract at each step.
- **Rotation of an individual credential** is a human action; no agent, at any level, mints or revokes credentials.

## 13. Definition of Done

- [ ] Goals met and acceptance criteria checked.
- [ ] Context table (C1 – C6) and class table (S1 – S5) complete; new rows framed as extension points.
- [ ] Policy / mechanism split explicit: LAT-37 scope distinct from LAT-61 / LAT-62 / LAT-63 scope.
- [ ] Non-goals honoured: no production secret manager chosen, no implementation shipped, no repo-committed secret implied or required.
- [ ] Cross-links resolve: ADR-0001 / ADR-0003 / ADR-0006 / ADR-0008 / ADR-0012 / ADR-0013 / ADR-0014 / ADR-0016 exist; `docs/process/approval-gates-and-autonomy-rules.md` and `docs/process/operating-model.md` exist.
- [ ] Linear `LAT-64` and this PRD cross-linked; `LAT-37`, `LAT-61`, `LAT-62`, `LAT-63` cited in frontmatter.
- [ ] No credential value, token, or credential-derived metadata appears anywhere in this PRD.

## 14. Links

- Linear issues: `LAT-64` (this PRD), `LAT-37` (ADR / policy predecessor), `LAT-61` / `LAT-62` / `LAT-63` (implementation tickets).
- Related ADRs:
  - `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`
  - `docs/decisions/0003-linear-persistence-boundary.md`
  - `docs/decisions/0006-agent-run-visibility-schema.md`
  - `docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md`
  - `docs/decisions/0012-integration-control-plane-software-architecture.md`
  - `docs/decisions/0013-agent-invocation-and-integration-boundaries.md`
  - `docs/decisions/0014-icp-state-persistence-and-telemetry.md`
  - `docs/decisions/0016-icp-skill-directory-and-adapter-layering.md`
- Process docs:
  - `docs/process/operating-model.md`
  - `docs/process/approval-gates-and-autonomy-rules.md`
  - `docs/process/qa-review-evidence.md`
  - `docs/process/thread-approved-merge-authority.md`
- Templates:
  - `docs/templates/prd.md`
  - `docs/templates/agent-run-report.md`
- Prior art / research: none beyond the ADRs and process docs cited above.
