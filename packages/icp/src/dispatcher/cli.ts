#!/usr/bin/env node
/**
 * LAT-129 polling dispatcher CLI.
 *
 * Usage:
 *
 *   icp-dispatch-next [--mode mock|plan|live] [--dry-run]
 *
 * Reads configuration from process.env exactly once and delegates to
 * `runDispatcherFromEnv`. Intentionally tiny: this file exists so the
 * orchestration in `dispatch.ts` is independently testable without a
 * process boundary.
 *
 * Exit codes:
 *
 *   0  ready_for_review (issue promoted, comment posted)
 *   2  refused | no eligible issue | config_error (recoverable)
 *   3  failed | checks_failed
 *   64 bad CLI arguments
 */

import { fileURLToPath } from "node:url";

import {
  defaultControlLoopCliPath,
  defaultRepoRoot,
  runDispatcherFromEnv,
} from "./dispatch.js";
import type { DispatchOutcome } from "./types.js";

interface CliArgs {
  mode: "mock" | "plan" | "live" | null;
  help: boolean;
  dryRun: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs | null {
  const out: CliArgs = { mode: null, help: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--mode") {
      const v = argv[i + 1];
      if (v !== "mock" && v !== "plan" && v !== "live") return null;
      out.mode = v;
      i += 1;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else {
      return null;
    }
  }
  return out;
}

function helpText(): string {
  return [
    "icp-dispatch-next — LAT-129 polling dispatcher MVP",
    "",
    "Usage: icp-dispatch-next [--mode mock|plan|live] [--dry-run]",
    "",
    "Selects one eligible Linear ticket (LAT_DISPATCH_ISSUE override required",
    "for MVP), generates a bounded ticket pack, invokes the control-loop CLI",
    "once, posts sanitised evidence back to Linear, and promotes to In Review",
    "only on READY_FOR_REVIEW.",
    "",
    "Required env: LINEAR_API_KEY, LAT_DISPATCH_ISSUE.",
    "Optional env: LAT_DISPATCH_MODE (default mock), LAT_LINEAR_IN_REVIEW_STATE_ID.",
    "",
    "The dispatcher never opens PRs, never auto-merges, and never deploys.",
  ].join("\n");
}

function exitCodeFor(outcome: DispatchOutcome): number {
  switch (outcome) {
    case "ready_for_review":
      return 0;
    case "no_eligible_issue":
    case "refused":
    case "planned":
    case "config_error":
      return 2;
    case "checks_failed":
    case "failed":
      return 3;
  }
}

export async function main(
  argv: ReadonlyArray<string>,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
  env: Readonly<Record<string, string | undefined>>,
  meta: { importMetaUrl: string },
): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    stderr.write(helpText() + "\n");
    return 64;
  }
  if (args.help) {
    stdout.write(helpText() + "\n");
    return 0;
  }

  const repoRoot = defaultRepoRoot(meta.importMetaUrl);
  const controlLoopCliPath = defaultControlLoopCliPath(repoRoot);

  const envWithOverrides: Record<string, string | undefined> = { ...env };
  if (args.mode) envWithOverrides["LAT_DISPATCH_MODE"] = args.mode;

  if (args.dryRun) {
    stdout.write(
      [
        "icp-dispatch-next: --dry-run resolved to:",
        `  repoRoot:           ${repoRoot}`,
        `  controlLoopCliPath: ${controlLoopCliPath}`,
        `  mode:               ${envWithOverrides["LAT_DISPATCH_MODE"] ?? "mock"}`,
        `  dispatchIssue:      ${envWithOverrides["LAT_DISPATCH_ISSUE"] ?? "(unset)"}`,
        `  linearKeyPresent:   ${envWithOverrides["LINEAR_API_KEY"] ? "yes" : "no"}`,
        "",
        "No Linear or control-loop calls were made.",
      ].join("\n") + "\n",
    );
    return 2;
  }

  const report = await runDispatcherFromEnv({
    env: envWithOverrides,
    repoRoot,
    controlLoopCliPath,
  });

  stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.outcome === "ready_for_review") {
    stdout.write(`OK ${report.issueIdentifier ?? ""}: ${report.message}\n`);
  } else {
    stderr.write(`dispatch ${report.outcome}: ${report.message}\n`);
  }
  return exitCodeFor(report.outcome);
}

/* c8 ignore start */
const invokedDirectly = (() => {
  try {
    const arg1 = process.argv[1];
    if (!arg1) return false;
    const here = fileURLToPath(import.meta.url);
    return here === arg1;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  const code = await main(
    process.argv.slice(2),
    process.stdout,
    process.stderr,
    process.env,
    { importMetaUrl: import.meta.url },
  );
  if (code !== 0) process.exit(code);
}
/* c8 ignore stop */
