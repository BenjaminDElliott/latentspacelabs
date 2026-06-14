# Pre-commit & Pre-push Hooks (LAT-122)

Local Git quality gates powered by [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged).

## Quick start

After cloning the repo and installing dependencies:

```bash
npm install          # installs Husky, Prettier, lint-staged
npx husky install    # reads .husky/ directory; run automatically via "prepare" script
```

The `prepare` script in `package.json` runs `husky` on every `npm install`, so hooks are installed automatically.

## Pre-commit hook

**Runs on every `git commit`.** Checks only **staged** files for speed.

| Check | Tool | Scope |
|-------|------|-------|
| Prettier formatting | `prettier --check --cache` | `packages/**/*.{ts,js,md}` |
| ESLint | `eslint` | Staged `.ts/.js/.tsx/.jsx` files |
| Secret guard | `npm run secret-guard:staged` | Staged files |

The pre-commit hook **blocks** if any check fails.

### Generated / fixture file exemptions

- **Prettier** respects `.prettierignore` (skips `dist/`, `node_modules/`, `coverage/`).
- **ESLint** ignores `**/dist/**`, `**/node_modules/**`, `**/*.d.ts` via `eslint.config.js`.
- **Secret-guard** skips files listed in `.gitignore` and known fixture patterns.

If you generate files (build output, test snapshots, fixtures) and want them excluded from pre-commit checks:
- Add them to `.prettierignore` or `.gitignore`.
- For secret-guard exclusions, add patterns to the secret-guard config or add a `// secret-guard-ignore` comment on the offending line.

### Bypass policy

In emergencies (CI-only deployment, large bulk commit, etc.):

```bash
git commit --no-verify -m "skip pre-commit checks"
# or with short flag:
git commit -nm "skip pre-commit checks"
```

## Pre-push hook

**Runs on every `git push`.** Checks the entire branch for correctness.

| Check | Tool | Scope |
|-------|------|-------|
| TypeScript typecheck | `npm run typecheck` | All workspaces |
| Tests + coverage | `tsx --test` | Changed packages (vs. `main`) or all packages in CI |

### Package change detection

The pre-push hook compares `HEAD` against `origin/main` to identify which packages under `packages/` have changed. Only those packages' tests are run. If no remote exists or we're in CI (`CI=true`), all packages are tested.

### Bypass policy

```bash
git push --no-verify
```

## CI compatibility

`npm run check` runs the full quality gate suite **without** requiring any local hook state:

```bash
npm run check   # lint → typecheck → build → validate → secret-guard → coverage
```

This is the command used in CI (`.github/workflows/check.yml`) and works regardless of whether Husky is installed locally.

## Prettier setup

Prettier is configured via `.prettierrc` at the repo root:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

To format all files:

```bash
npm run format
```

To check formatting without writing:

```bash
npm run format:check
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `husky` command not found | Run `npm install` — the `prepare` script installs hooks |
| Pre-commit hook runs slowly | It only checks staged files; ensure you `git add` before committing |
| ESLint can't find config | `eslint.config.js` must exist at the repo root |
| Secret-guard fails on `.env.local` | Add `.env.*` to secret-guard exclusions in its config |
| Want to skip hooks temporarily | Use `--no-verify` as shown above |

## Files added by this change

| File | Purpose |
|------|---------|
| `.husky/pre-commit` | Pre-commit hook script |
| `.husky/pre-push` | Pre-push hook script |
| `.prettierrc` | Prettier configuration |
| `.prettierignore` | Prettier exclusion patterns |
| `package.json` | Added Husky, Prettier, lint-staged; new scripts: `format`, `format:check`, `lint:staged`, `prepare` |
| `docs/process/pre-commit-hooks.md` | This documentation |
