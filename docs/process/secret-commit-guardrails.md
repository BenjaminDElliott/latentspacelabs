# Secret-commit guardrails

Local pre-commit defence against accidentally committing credentials. Landed for **LAT-63**; complements the not-yet-merged credentials policy work in LAT-37 / PR #37.

## Policy

- **Secret values must never be committed** to the repo, PR body, logs, or artifacts.
- **Templates and placeholders are fine.** `.env.example`, `<your-api-key>`, `${VAR}`, `changeme`, `your-token`, empty — all expected.
- **Local credentials belong in local environment variables** (your shell profile) or an untracked `.env.local`. Having them present on your machine is not a leak. The guardrail exists to make sure they never get staged.
- `git commit --no-verify` is an emergency bypass only. Document why in the PR body if used.

## How it is enforced

1. `.gitignore` already excludes `.env` and `.env.*` but whitelists `.env.example`, so local dotenv files can exist on disk without ever being tracked.
2. `@latentspacelabs/secret-guard` (under `packages/secret-guard`) provides a staged-file scanner that blocks:
   - any staged `.env` / `.env.<anything>` except `.env.example`, `.env.sample`, `.env.template`, `.env.dist`;
   - literal credentials matching well-known formats (AWS, GitHub, Slack, OpenAI, Anthropic, Google, Stripe live, PEM private key);
   - generic `*_KEY=` / `*_SECRET=` / `*_TOKEN=` / `*_PASSWORD=` assignments whose value looks like a credible high-entropy token (≥20 chars, mixed digits + letters, not a placeholder).
3. A local git pre-commit hook runs the scanner against the staged set on every `git commit`.
4. Test fixtures and documentation examples that legitimately need a fake credential can opt out of a single line with a `secret-guard:allow` trailing comment. Never apply this to a real secret.

The scanner runs only on staged content, is TypeScript/Node only, and has no runtime dependencies outside Node's stdlib and `git`. Fully self-contained, following the same pattern as `@latentspacelabs/policy-scanner`.

## Setup (per clone)

Git hooks are not installed by `npm install` — each engineer opts in explicitly so nothing is written into `.git/` without consent. From the repo root:

```bash
npm install
npm run build -w @latentspacelabs/secret-guard
npm run secret-guard:install-hook
```

This writes `.git/hooks/pre-commit` (or the path from `core.hooksPath` if you've configured one). Re-running refreshes the hook idempotently. It refuses to overwrite a pre-existing unrelated hook unless you pass `--force`, in which case the old hook is backed up to `pre-commit.bak`.

## Manual invocations

```bash
# Scan specific paths (useful when tidying a change before `git add`)
npm run secret-guard -- path/to/file.ts .env.example

# Scan the staged set without committing
npm run secret-guard:staged
```

Exit codes: `0` clean, `1` blocking finding, `2` internal error.

## What to do when the guardrail blocks you

1. Read the message — it names the rule, file, and line.
2. If it is a real secret: unstage (`git restore --staged <file>`), rotate the credential (treat it as exposed the moment it hit a file on disk), and move the value to your shell environment or `.env.local`.
3. If it is a placeholder that tripped the heuristic: replace the literal with an obvious placeholder form (`<your-key>`, `${VAR}`, `changeme`, `your-…`, etc.) and re-stage.
4. If the scanner is wrong often enough to be a pain, open a ticket — tightening patterns or adding an allowlist is cheap, but we should not widen the escape hatch casually.

## Why a hook, not just CI

A CI check catches leaks after they are already in git history, which is the worst moment. The pre-commit hook keeps the window between "type the secret" and "revoke it because it hit disk inside a tracked file" as short as possible. CI-level enforcement can layer on later; LAT-63 delivers the local-only first line.

## Related

- LAT-37 / PR #37 — credentials policy (held for ADR renumbering / policy wording); this doc is compatible with its direction.
- `@latentspacelabs/policy-scanner` — sister local-guardrail package; same TypeScript/Node pattern.
