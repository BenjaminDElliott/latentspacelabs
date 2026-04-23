# @latentspacelabs/prd-tools

Repo developer tool: validates Product Requirements Documents under
`docs/prds/` for filename conventions, required frontmatter keys,
`prd_id` uniqueness, and `derived_from` resolution.

This is a repo tool, not part of the Integration Control Plane runtime. See
`docs/prds/README.md` for why PRD governance exists and what guardrails it
enforces.

## What is validated

Against every `.md` file in a target directory (default `docs/prds/`) other
than `README.md` (subdirectories are ignored):

1. Filename matches one of:
   - `root-<slug>.md` for root PRDs
   - `LAT-NN-<slug>.md` for feature PRDs
   Numeric `NNNN-*.md` ADR-style filenames are rejected.
2. Required frontmatter keys are present: `prd_id`, `title`, `status`,
   `owner`, `date`, `related_linear`, `related_adrs`, `derived_from`,
   `supersedes`, `superseded_by`.
3. `prd_id`, `title`, `status`, `owner`, `date` are non-empty.
4. `status` is one of `draft`, `in-review`, `approved`, `superseded`,
   `archived`.
5. `prd_id` equals the filename stem (without `.md`).
6. No two files share the same `prd_id`.
7. `derived_from` points at an existing root PRD in the directory:
   - Root PRDs must have empty `derived_from`.
   - Feature PRDs must set `derived_from` to a root PRD stem.
8. For feature PRDs, the `LAT-NN` filename prefix appears in
   `related_linear` (when the list is non-empty).

All errors are collected and printed in one run; the CLI exits `1` on any
failure, `0` on success.

## Commands

From the repo root:

```sh
npm run validate:prds          # validates docs/prds/
```

Or directly:

```sh
npx tsx packages/prd-tools/src/cli.ts docs/prds
```

The `check` script chains typecheck, build, ADR validation, PRD validation,
and tests.
