/**
 * runs/*.json reader for the ICP observability cockpit (LAT-55).
 *
 * Minimal-dependency reader: scans a directory of ADR-0006 run report JSON
 * files, parses each defensively, and returns well-formed `CockpitRunRecord`s
 * plus a count of rejected files. Malformed files are skipped (not thrown)
 * so the cockpit can still render a partial state — a malformed envelope is
 * a signal for the operator, not a reason to halt the read.
 *
 * The reader does not validate every ADR-0006 field; it enforces the required
 * core (PRD §6.6.3 / ADR-0006 "Required core fields") and projects the
 * optional fields the cockpit actually surfaces. Unknown top-level keys pass
 * through untouched per ADR-0006's extensibility contract.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CockpitRunRecord } from "./types.js";
import type {
  AgentType,
  AutonomyLevel,
  RunReport,
  RunReportStatus,
  TriggeredBy,
} from "../runtime/contract.js";

const REQUIRED_AGENT_TYPES: ReadonlyArray<AgentType> = [
  "coding",
  "qa",
  "review",
  "sre",
  "pm",
  "research",
  "observability",
];

const REQUIRED_STATUSES: ReadonlyArray<RunReportStatus> = [
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "needs_human",
];

const REQUIRED_AUTONOMY: ReadonlyArray<AutonomyLevel> = [
  "L1-read-only",
  "L2-propose",
  "L3-with-approval",
  "L4-autonomous",
];

const TRIGGERED_BY: ReadonlyArray<TriggeredBy> = [
  "user",
  "linear_status",
  "schedule",
  "webhook",
  "agent",
  "github_comment",
  "hook",
  "mcp",
];

export interface ReaderResult {
  runs: ReadonlyArray<CockpitRunRecord>;
  rejected: ReadonlyArray<{ path: string; reason: string }>;
}

/**
 * Read every `runs/*.json` under `runsDir` into typed records. Missing dir
 * is treated as "no runs" — a fresh clone with no dispatches should not
 * throw. Markdown siblings are ignored; the JSON is the machine-readable
 * envelope (ADR-0014 §"What `runs/` stores").
 */
export async function readRunsDir(runsDir: string): Promise<ReaderResult> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return { runs: [], rejected: [] };
    throw err;
  }

  const jsonFiles = entries.filter((e) => e.endsWith(".json"));
  const runs: CockpitRunRecord[] = [];
  const rejected: { path: string; reason: string }[] = [];

  for (const name of jsonFiles) {
    const path = join(runsDir, name);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      rejected.push({ path, reason: `read failed: ${String(err)}` });
      continue;
    }
    const parsed = parseRunJson(raw, path);
    if (!parsed.ok) {
      rejected.push({ path, reason: parsed.reason });
      continue;
    }
    runs.push({ ...parsed.record, source_path: path });
  }

  return { runs, rejected };
}

/**
 * Exposed for tests and for callers that already hold an envelope string
 * (e.g. the dispatch skill's `json` return value).
 */
export function parseRunJson(
  raw: string,
  path: string,
): { ok: true; record: CockpitRunRecord } | { ok: false; reason: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `invalid JSON: ${String(err)}` };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, reason: "envelope is not a JSON object" };
  }
  const env = obj as Record<string, unknown>;

  const schemaVersion = str(env["schema_version"]);
  const runId = str(env["run_id"]);
  const agentType = str(env["agent_type"]);
  const status = str(env["status"]);
  const triggeredBy = str(env["triggered_by"]);
  const linearIssueId = str(env["linear_issue_id"]);
  const autonomyLevel = str(env["autonomy_level"]);
  const startedAt = str(env["started_at"]);
  const endedAt = str(env["ended_at"]);

  if (!schemaVersion) return { ok: false, reason: "missing schema_version" };
  if (!runId) return { ok: false, reason: "missing run_id" };
  if (!agentType || !REQUIRED_AGENT_TYPES.includes(agentType as AgentType)) {
    return { ok: false, reason: `invalid agent_type: ${String(agentType)}` };
  }
  if (!status || !REQUIRED_STATUSES.includes(status as RunReportStatus)) {
    return { ok: false, reason: `invalid status: ${String(status)}` };
  }
  // triggered_by and linear_issue_id are "strongly recommended" in ADR-0006.
  // The cockpit tolerates absent/invalid triggered_by by defaulting to "user"
  // (the minimum RunReport the runtime writes today) to avoid rejecting
  // otherwise-useful records.
  const tb: TriggeredBy = TRIGGERED_BY.includes(triggeredBy as TriggeredBy)
    ? (triggeredBy as TriggeredBy)
    : "user";
  const au: AutonomyLevel = REQUIRED_AUTONOMY.includes(
    autonomyLevel as AutonomyLevel,
  )
    ? (autonomyLevel as AutonomyLevel)
    : "L3-with-approval";

  const cost = pickCost(env["cost"]);
  const correlation = pickCorrelation(env["correlation"]);

  const record: CockpitRunRecord = {
    schema_version: schemaVersion,
    run_id: runId,
    agent_type: agentType as AgentType,
    status: status as RunReportStatus,
    triggered_by: tb,
    linear_issue_id: linearIssueId || "",
    autonomy_level: au,
    started_at: startedAt ?? "",
    ended_at: endedAt ?? "",
    summary: str(env["summary"]) ?? "",
    decisions: strArray(env["decisions"]),
    next_actions: strArray(env["next_actions"]),
    errors: strArray(env["errors"]),
    cost,
    correlation,
  };

  const riskLevel = str(env["risk_level"]);
  if (
    riskLevel === "low" ||
    riskLevel === "medium" ||
    riskLevel === "high" ||
    riskLevel === "critical"
  ) {
    record.risk_level = riskLevel;
  }

  const meta = env["agent_metadata"];
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    const mm = meta as Record<string, unknown>;
    const model = str(mm["model"]);
    if (model) record.agent_metadata = { ...mm, model };
    else record.agent_metadata = { ...mm };
  }

  return { ok: true, record };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function strArray(v: unknown): ReadonlyArray<string> {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function pickCost(v: unknown): RunReport["cost"] {
  const empty: RunReport["cost"] = {
    band: "unknown",
    budget_cap_usd: null,
    spent_usd: null,
    band_unavailable_reason: null,
  };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return empty;
  const c = v as Record<string, unknown>;
  const band = str(c["band"]);
  const bandSafe: RunReport["cost"]["band"] =
    band === "normal" ||
    band === "elevated" ||
    band === "runaway_risk" ||
    band === "unknown"
      ? band
      : "unknown";
  const reason = c["band_unavailable_reason"];
  return {
    band: bandSafe,
    budget_cap_usd: typeof c["budget_cap_usd"] === "number" ? c["budget_cap_usd"] : null,
    spent_usd: typeof c["spent_usd"] === "number" ? c["spent_usd"] : null,
    band_unavailable_reason:
      typeof reason === "string" && reason.length > 0 ? reason : null,
  };
}

function pickCorrelation(v: unknown): RunReport["correlation"] {
  const empty: RunReport["correlation"] = {
    pr_url: null,
    pr_branch: null,
    commit_sha: null,
    linear_comment_url: null,
  };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return empty;
  const c = v as Record<string, unknown>;
  return {
    pr_url: str(c["pr_url"]) ?? null,
    pr_branch: str(c["pr_branch"]) ?? null,
    commit_sha: str(c["commit_sha"]) ?? null,
    linear_comment_url: str(c["linear_comment_url"]) ?? null,
  };
}
