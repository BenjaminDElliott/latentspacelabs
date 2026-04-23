#!/usr/bin/env node
import { resolve } from "node:path";
import {
  scanRepository,
  loadConfigFromFile,
  formatResult,
  hasBlockingFindings,
} from "./scan.js";

interface CliArgs {
  root: string;
  warnOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const rest: string[] = [];
  let warnOnly = false;
  for (const a of argv) {
    if (a === "--warn-only") warnOnly = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else rest.push(a);
  }
  return { root: resolve(rest[0] ?? "."), warnOnly };
}

function usage(): string {
  return [
    "Usage: policy-scan [root] [--warn-only]",
    "",
    "Scans the repo for architecture-policy drift:",
    "  - disallowed package manager artifacts (pnpm, yarn)",
    "  - executable Python repo tooling",
    "  - hand-maintained shared Markdown index hotspots (warn)",
    "",
    "Exits non-zero when any error-severity finding is emitted. Use",
    "--warn-only to downgrade all findings to warnings (exit 0 except",
    "on internal errors). Config overrides come from .repo-policy.json",
    "at the root.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configFromFile = await loadConfigFromFile(args.root);
  const result = await scanRepository({
    root: args.root,
    ...(configFromFile ? { config: configFromFile } : {}),
  });
  const output = formatResult(result);
  if (!args.warnOnly && hasBlockingFindings(result)) {
    process.stderr.write(output + "\n");
    process.exit(1);
  }
  process.stdout.write(output + "\n");
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`policy-scan: ${(err as Error).message}\n`);
  process.exit(2);
});
