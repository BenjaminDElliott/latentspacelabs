#!/usr/bin/env node
/**
 * CLI entrypoint for the LAT-117 control loop.
 *
 * Usage:
 *
 *   control-loop <ticket-pack.md> [--mode mock|plan|live] [--format markdown|json] [--out <path>]
 *
 * Default mode is `mock` so accidental invocation cannot spend cloud cost.
 *
 * Exit codes:
 *
 *   0  ready_for_review | planned
 *   2  refused
 *   3  checks_failed | failed
 *   64 bad CLI arguments
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runControlLoop } from "./control-loop.js";
import { formatRunSummaryJson, formatRunSummaryMarkdown } from "./format.js";
import type { RunMode, RunState } from "./types.js";

interface CliArgs {
  packPath: string | null;
  mode: RunMode;
  format: "markdown" | "json";
  outPath: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let packPath: string | null = null;
  let mode: RunMode = "mock";
  let format: "markdown" | "json" = "markdown";
  let outPath: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--mode" || a === "-m") {
      const v = argv[i + 1];
      if (v !== "mock" && v !== "plan" && v !== "live") {
        throw new Error(`--mode must be 'mock' | 'plan' | 'live', got '${v ?? ""}'`);
      }
      mode = v;
      i += 1;
    } else if (a === "--format" || a === "-f") {
      const v = argv[i + 1];
      if (v !== "markdown" && v !== "json") {
        throw new Error(`--format must be 'markdown' or 'json', got '${v ?? ""}'`);
      }
      format = v;
      i += 1;
    } else if (a === "--out" || a === "-o") {
      const v = argv[i + 1];
      if (v === undefined) throw new Error("--out requires a path argument");
      outPath = v;
      i += 1;
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (packPath === null) {
      packPath = a;
    } else {
      throw new Error(`unexpected positional argument: ${a}`);
    }
  }

  return { packPath, mode, format, outPath, help };
}

function usage(): string {
  return [
    "Usage: control-loop <ticket-pack.md> [--mode mock|plan|live] [--format markdown|json] [--out <path>]",
    "",
    "Dispatches one bounded opencode agent into a sandboxed runtime selected by --mode.",
    "Default mode is 'mock' (deterministic, offline). 'plan' runs guardrails but does not",
    "dispatch. 'live' requires CONTROL_LOOP_PROVIDER, CONTROL_LOOP_RUNTIME_ID, and",
    "CONTROL_LOOP_LIVE_ENABLED=1 in the environment.",
    "",
    "The control loop never opens a PR, never auto-merges, and never deploys.",
    "",
    "Exit codes:",
    "  0  ready_for_review | planned",
    "  2  refused (pre-flight, guardrail, or missing live config)",
    "  3  failed | checks_failed",
    "  64 bad arguments",
  ].join("\n");
}

function exitCodeFor(state: RunState): number {
  switch (state) {
    case "ready_for_review":
    case "planned":
      return 0;
    case "refused":
      return 2;
    case "failed":
    case "checks_failed":
      return 3;
    case "running":
      return 3;
  }
}

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n`);
    process.stderr.write(`${usage()}\n`);
    return 64;
  }

  if (args.help || args.packPath === null) {
    process.stdout.write(`${usage()}\n`);
    return args.help ? 0 : 64;
  }

  const summary = await runControlLoop({
    packPath: args.packPath,
    mode: args.mode,
  });

  const rendered = args.format === "json"
    ? formatRunSummaryJson(summary)
    : formatRunSummaryMarkdown(summary);

  if (args.outPath !== null) {
    await writeFile(resolve(args.outPath), `${rendered}\n`, "utf8");
    process.stdout.write(
      `control-loop summary written to ${resolve(args.outPath)} (state: ${summary.evidence.state})\n`,
    );
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  return exitCodeFor(summary.evidence.state);
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /control-loop\/(?:dist|src)\/cli\.(?:js|ts)$/.test(process.argv[1]);

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`control-loop failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(3);
    },
  );
}
