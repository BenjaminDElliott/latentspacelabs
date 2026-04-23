#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { scanPaths, formatResult, hasBlockingFindings } from "./scan.js";

interface CliArgs {
  staged: boolean;
  paths: string[];
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const paths: string[] = [];
  let staged = false;
  let help = false;
  for (const a of argv) {
    if (a === "--staged") staged = true;
    else if (a === "--help" || a === "-h") help = true;
    else paths.push(a);
  }
  return { staged, paths, help };
}

function usage(): string {
  return [
    "Usage: secret-guard [--staged] [paths...]",
    "",
    "Blocks commits that would include local .env files or obvious literal",
    "API keys / tokens. With --staged, reads the staged file list from git",
    "(added/copied/modified/renamed, relative to repo root). Without it,",
    "scans the paths passed on the argv.",
    "",
    "Exits 0 on clean, 1 on blocking finding, 2 on internal error.",
    "",
    "See docs/process/secret-commit-guardrails.md for setup and policy.",
    "",
  ].join("\n");
}

function gitRepoRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git rev-parse --show-toplevel failed: ${r.stderr.trim()}`);
  }
  return r.stdout.trim();
}

function stagedFiles(repoRoot: string): string[] {
  const r = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`git diff --cached failed: ${r.stderr.trim()}`);
  }
  return r.stdout
    .split("\u0000")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((rel) => resolve(repoRoot, rel));
}

function stagedBlob(repoRoot: string, relPath: string): string | null {
  const r = spawnSync("git", ["show", `:${relPath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (r.status !== 0) return null;
  return r.stdout;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  let files: string[];
  let reader: ((path: string) => Promise<string>) | undefined;
  if (args.staged) {
    const root = gitRepoRoot();
    files = stagedFiles(root);
    reader = async (abs: string) => {
      const rel = abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs;
      const blob = stagedBlob(root, rel);
      if (blob === null) {
        // fall back to on-disk read
        return readFile(abs, "utf8");
      }
      return blob;
    };
  } else {
    if (args.paths.length === 0) {
      process.stderr.write(usage());
      process.exit(2);
    }
    files = args.paths.map((p) => resolve(p));
  }

  const result = await scanPaths(reader ? { files, readFile: reader } : { files });
  const output = formatResult(result);
  if (hasBlockingFindings(result)) {
    process.stderr.write(output + "\n");
    process.stderr.write(
      "\nCommit blocked by secret-guard. If this is a placeholder, edit the value " +
        "(e.g. use <your-key> or ${VAR}). If you need to commit a template, rename to " +
        ".env.example / .env.template. To investigate locally: npm run secret-guard -- <path>.\n",
    );
    process.exit(1);
  }
  process.stdout.write(output + "\n");
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`secret-guard: ${(err as Error).message}\n`);
  process.exit(2);
});
