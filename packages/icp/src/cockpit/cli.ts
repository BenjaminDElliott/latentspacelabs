#!/usr/bin/env node
/**
 * Minimal cockpit CLI (LAT-55).
 *
 * `icp-cockpit [--runs-dir <path>] [--json] [--stale-hours N]`
 *
 * Reads the repo-committed `runs/` tree (ADR-0014), projects the seven MVP
 * views (PRD §6.2), and renders either a Markdown briefing (default) or the
 * raw JSON state (`--json`). Callers that want Linear/GitHub/QA joins can
 * import `buildCockpitState()` directly — the CLI only reads what lives in
 * the repo to keep the command hermetic for pilot use.
 */
import { fileURLToPath } from "node:url";
import { readRunsDir } from "./reader.js";
import { buildCockpitState } from "./views.js";
import { renderCockpitSummary } from "./summary.js";

interface CliOptions {
  runsDir: string;
  json: boolean;
  staleHours: number | null;
  failedWindowDays: number | null;
  activeWindowHours: number | null;
}

export async function main(argv: ReadonlyArray<string>, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Promise<number> {
  const opts = parseArgs(argv);
  if (!opts) {
    stderr.write(helpText() + "\n");
    return 64;
  }
  const result = await readRunsDir(opts.runsDir);
  const state = buildCockpitState({
    runs: result.runs,
    ...(opts.staleHours !== null ? { stale_started_hours: opts.staleHours } : {}),
    ...(opts.failedWindowDays !== null
      ? { failed_window_days: opts.failedWindowDays }
      : {}),
    ...(opts.activeWindowHours !== null
      ? { active_runs_window_hours: opts.activeWindowHours }
      : {}),
  });

  // Thread the rejected-count into the totals so the operator sees it.
  const totalsWithRejected = {
    ...state.totals,
    runs_rejected: result.rejected.length,
  };
  const finalState = { ...state, totals: totalsWithRejected };

  if (opts.json) {
    stdout.write(JSON.stringify(finalState, null, 2) + "\n");
  } else {
    stdout.write(renderCockpitSummary(finalState) + "\n");
    if (result.rejected.length > 0) {
      stderr.write(
        `\n[cockpit] ${result.rejected.length} run file(s) rejected:\n` +
          result.rejected.map((r) => `  - ${r.path}: ${r.reason}`).join("\n") +
          "\n",
      );
    }
  }
  return 0;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions | null {
  const opts: CliOptions = {
    runsDir: "runs",
    json: false,
    staleHours: null,
    failedWindowDays: null,
    activeWindowHours: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return null;
    if (a === "--json") {
      opts.json = true;
    } else if (a === "--runs-dir") {
      const v = argv[++i];
      if (!v) return null;
      opts.runsDir = v;
    } else if (a === "--stale-hours") {
      const v = argv[++i];
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      opts.staleHours = n;
    } else if (a === "--failed-window-days") {
      const v = argv[++i];
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      opts.failedWindowDays = n;
    } else if (a === "--active-window-hours") {
      const v = argv[++i];
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      opts.activeWindowHours = n;
    } else {
      return null;
    }
  }
  return opts;
}

function helpText(): string {
  return [
    "icp-cockpit — ICP observability cockpit MVP (LAT-55)",
    "",
    "Usage: icp-cockpit [--runs-dir <path>] [--json] [--stale-hours N]",
    "                  [--failed-window-days N] [--active-window-hours N]",
    "",
    "Reads ADR-0006 run reports from <runs-dir> (default: ./runs) and renders",
    "the seven MVP cockpit views defined in docs/prds/LAT-28-icp-observability-cockpit.md.",
    "",
    "Never edits Linear, GitHub, or the runs/ tree. Linear/GitHub/QA joins are",
    "available via the `buildCockpitState()` programmatic API.",
  ].join("\n");
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
  const code = await main(process.argv.slice(2), process.stdout, process.stderr);
  if (code !== 0) process.exit(code);
}
/* c8 ignore stop */
