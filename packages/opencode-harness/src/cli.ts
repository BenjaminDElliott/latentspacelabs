#!/usr/bin/env node
/**
 * CLI for the opencode + Qwen dry-run harness (LAT-105).
 *
 * Usage:
 *
 *   opencode-dry-run <path-to-ticket-pack.md> [--format markdown|json] [--out <path>]
 *
 * The CLI is offline-only by construction — it does not read any environment
 * variable that names an endpoint, a token, or a hostname; it does not call
 * `gh`, `git`, or any network service. The exit code maps the harness status:
 *
 *   0 — `ready` (dry-run pass; the runtime would proceed)
 *   2 — `blocked` | `needs_clarification` | `too_large` (refusal; the runtime would not start)
 *   3 — `harness_error` (could not read the pack, or other internal failure)
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { dryRun } from "./dry-run.js";
import { formatSummaryJson, formatSummaryMarkdown } from "./format.js";
import type { HarnessStatus } from "./types.js";

interface CliArgs {
  packPath: string | null;
  format: "markdown" | "json";
  outPath: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let packPath: string | null = null;
  let format: "markdown" | "json" = "markdown";
  let outPath: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--help" || a === "-h") {
      help = true;
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

  return { packPath, format, outPath, help };
}

function usage(): string {
  return [
    "Usage: opencode-dry-run <ticket-pack.md> [--format markdown|json] [--out <path>]",
    "",
    "Reads a ticket pack (per docs/templates/opencode-ticket-pack.md), validates it",
    "against the LAT-104 contract, and prints a Linear-ready run summary.",
    "",
    "The harness never invokes opencode, the local Qwen endpoint, GitHub, or Linear.",
    "It does not require any endpoint URL, token, or other secret material.",
    "",
    "Exit codes:",
    "  0  ready       (dry-run pass; the runtime would start)",
    "  2  refused     (blocked | needs_clarification | too_large)",
    "  3  harness     (internal failure such as unreadable pack)",
  ].join("\n");
}

function exitCodeFor(status: HarnessStatus): number {
  switch (status) {
    case "ready":
      return 0;
    case "blocked":
    case "needs_clarification":
    case "too_large":
      return 2;
    case "harness_error":
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

  const result = await dryRun(args.packPath);
  const rendered = args.format === "json"
    ? formatSummaryJson(result.summary)
    : formatSummaryMarkdown(result.summary);

  if (args.outPath !== null) {
    await writeFile(resolve(args.outPath), `${rendered}\n`, "utf8");
    process.stdout.write(
      `dry-run summary written to ${resolve(args.outPath)} (status: ${result.summary.status})\n`,
    );
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  return exitCodeFor(result.summary.status);
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /opencode-harness\/(?:dist|src)\/cli\.(?:js|ts)$/.test(process.argv[1]);

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`opencode-dry-run failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(3);
    },
  );
}
