# @latentspacelabs/secret-guard

Local-only guardrail that blocks commits containing secret material. Delivered for LAT-63.

## What it blocks

- **`dotenv-file-staged`** (error): any staged `.env` / `.env.local` / `.env.production` / `.env.<anything>` except `.env.example`, `.env.sample`, `.env.template`, `.env.dist`.
- **Literal credential formats** (error): AWS access key ids (`AKIA…`), GitHub tokens (`ghp_…`), Slack tokens (`xox[abpr]-…`), OpenAI keys (`sk-…`), Anthropic keys (`sk-ant-…`), Google API keys (`AIza…`), Stripe live secrets (`sk_live_…`), PEM private-key blocks.
- **`credential-assignment`** (error): `FOO_KEY=` / `FOO_SECRET=` / `FOO_TOKEN=` / `FOO_PASSWORD=` assignments whose value is ≥20 chars, contains both digits and letters, and is not a placeholder (`<…>`, `${VAR}`, `changeme`, `your-…`, `xxxxx`, empty, …).

Placeholder values — `<your-key>`, `${VAR}`, `changeme`, `your-token`, empty — are explicitly allowed so `.env.example` templates pass cleanly.

### Escape hatch: `secret-guard:allow`

Put `secret-guard:allow` on the same line (typically inside a comment) to silence findings for that line. Reserved for test fixtures and documentation that legitimately need an example credential. Never use it to suppress a real secret.

## Running it

From the repo root:

```bash
# Scan specific paths
npm run secret-guard -- path/to/file.ts

# Scan staged files (what the pre-commit hook runs)
npm run secret-guard:staged
```

Exit codes: `0` clean, `1` blocking finding, `2` internal error.

## Installing the pre-commit hook

```bash
npm install
npm run build -w @latentspacelabs/secret-guard
npm run secret-guard:install-hook
```

That writes `.git/hooks/pre-commit` (or the path from `core.hooksPath` if set). The hook is idempotent — re-running refreshes a hook it previously installed; it refuses to clobber a non-secret-guard hook unless you pass `--force`, in which case the existing hook is backed up to `pre-commit.bak`.

To bypass in an emergency (document why in the PR): `git commit --no-verify`.

## Policy

Secret values must never be committed to the repo, PR body, logs, or artifacts. Templates and placeholders are fine. Real credentials live in your local shell environment or in an untracked `.env.local`. See [`docs/process/secret-commit-guardrails.md`](../../docs/process/secret-commit-guardrails.md).
