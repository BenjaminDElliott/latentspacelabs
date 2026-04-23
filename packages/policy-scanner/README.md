# @latentspacelabs/policy-scanner

Local- and CI-runnable scanner that catches toolchain and repo-rule drift before it merges.

The scanner enforces the policies captured in [`docs/process/coding-agent-preflight.md`](../../docs/process/coding-agent-preflight.md) and ADR-0011. It was added because several coding-agent runs drifted from `accepted` policy: Python tooling after the TypeScript/Node decision, `pnpm` artifacts after the LAT-25 switch to npm workspaces, and hand-maintained Markdown indexes in shared hubs after LAT-33.

## What it checks

- **`package-manager`** (error): Any `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `yarn.lock`, `.yarnrc`, or `.yarnrc.yml` file outside `node_modules` / `.git`. The monorepo uses npm workspaces; these files indicate a regression.
- **`python-tooling`** (error): `.py` files in executable-tooling locations — repo root, `scripts/`, `tools/`, `bin/`, `.github/scripts/`, `.github/workflows/`, or anywhere under `packages/`. Python files under `docs/` are treated as documentation illustrations and not flagged.
- **`markdown-index-hotspot`** (warn): Shared hubs (`docs/README.md`, `docs/process/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`) that contain a Markdown table with 3+ data rows or a bulleted list with 6+ consecutive link entries. This is intentionally heuristic — the signal is "someone is re-introducing the hand-maintained index that LAT-33 removed"; exact cases go via override.

Only `error` severities fail the process. The hotspot rule is intentionally a `warn` so it does not block merges on false positives.

## Running it

Locally, from the repo root:

```
npm run policy-scan
```

It is also invoked as part of `npm run check`.

Directly:

```
npx policy-scan           # scans the current directory
npx policy-scan <root>    # scans a specific root
npx policy-scan --warn-only  # never exit non-zero
```

## Allowlist / override

Drop a `.repo-policy.json` at the repo root to override any default, e.g. to allow a specific forbidden file or a specific Python script:

```json
{
  "allowedPackageManagerFiles": [],
  "allowedPythonPaths": []
}
```

Every allowlist entry must be a repo-relative path. The expectation is that each entry is accompanied by an ADR or a Linear ticket explaining the exception.

## Known limitations

- The Markdown-index detector is heuristic. It cannot tell a legitimate comparison table from a hand-maintained index; tuning lives in `.repo-policy.json` (`markdownIndexTableMinRows`, `markdownIndexListMinLinks`).
- The scanner only inspects file names and a small number of shared-hub files. It does not execute `.py` shebang detection in arbitrary directories today; add the directory to `pythonToolingDirectories` if needed.
- The scanner does not read Git history; adding or removing files under `node_modules/` in a feature branch does not affect results.
