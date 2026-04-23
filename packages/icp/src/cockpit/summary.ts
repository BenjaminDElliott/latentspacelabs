/**
 * Perplexity-facing summary renderer (LAT-55, PRD §6.5).
 *
 * Deterministic Markdown renderer over `CockpitState`. Every claim cites a
 * `run_id`, `LAT-NN`, or PR URL. Views whose source is "requires future
 * telemetry" are marked explicitly rather than fabricating an answer
 * (PRD §6.5.3). Synchronous-page notifications appear first (PRD §6.5.6).
 *
 * The output is a bounded Markdown document that fits a two-minute mobile
 * read (PRD §6.5.1) at pilot volume. It is never itself a source of truth
 * (PRD §6.5.5); regenerate it from the same inputs on demand.
 */
import type {
  ActiveRunRow,
  BlockedWorkRow,
  CockpitState,
  CostRiskRow,
  FailedRunsGroup,
  LearningCandidate,
  PRReviewQueueRow,
  RecentCompletionRow,
} from "./types.js";

export interface SummaryOptions {
  /** Repo-relative URL prefix for run report links, e.g. `runs/`. */
  runs_href?: string;
  /** Optional Linear team key for nicer issue references. Default "LAT". */
  linear_team?: string;
}

export function renderCockpitSummary(
  state: CockpitState,
  options: SummaryOptions = {},
): string {
  const runsHref = options.runs_href ?? "runs/";
  const lines: string[] = [];

  lines.push("# ICP observability cockpit — briefing");
  lines.push("");
  lines.push(`_Rendered at ${state.rendered_at}. Source: repo-committed runs/ tree (+ Linear/GitHub where supplied). PRD: docs/prds/LAT-28-icp-observability-cockpit.md._`);
  lines.push("");

  // §6.5.6: synchronous-page triggers first.
  const sync = state.notifications.filter((n) => n.tier === "synchronous_page");
  const ambient = state.notifications.filter((n) => n.tier === "ambient_queue");

  lines.push("## Synchronous-page events");
  lines.push("");
  if (sync.length === 0) {
    lines.push("- none");
  } else {
    for (const ev of sync) {
      lines.push(
        `- **${ev.reason}** — run \`${ev.run_id}\` on ${ev.linear_issue_id} (see *${humanView(ev.source_view)}* view)`,
      );
    }
  }
  lines.push("");

  lines.push("## Ambient queue");
  lines.push("");
  if (ambient.length === 0) {
    lines.push("- none");
  } else {
    for (const ev of ambient) {
      lines.push(
        `- ${ev.reason} — run \`${ev.run_id}\` on ${ev.linear_issue_id} (*${humanView(ev.source_view)}*)`,
      );
    }
  }
  lines.push("");

  lines.push("## Active runs (PRD §6.2.1, source: runs/*.json)");
  lines.push("");
  if (state.active_runs.length === 0) {
    lines.push("- none");
  } else {
    for (const r of state.active_runs) renderActive(lines, r, runsHref);
  }
  lines.push("");

  lines.push("## Blocked work (PRD §6.2.2, source: runs/*.json + Linear)");
  lines.push("");
  if (state.blocked_work.length === 0) {
    lines.push("- none");
  } else {
    for (const r of state.blocked_work) renderBlocked(lines, r, runsHref);
  }
  lines.push("");

  lines.push("## Recent completions (PRD §6.2.3, source: runs/*.json + GitHub)");
  lines.push("");
  if (state.recent_completions.length === 0) {
    lines.push("- none");
  } else {
    for (const r of state.recent_completions) renderRecent(lines, r, runsHref);
  }
  lines.push("");

  lines.push(
    `## Failed runs (PRD §6.2.4, last ${state.failed_runs.window_days}d, source: runs/*.json)`,
  );
  lines.push("");
  lines.push("### Grouped by agent_type");
  if (state.failed_runs.by_agent_type.length === 0) {
    lines.push("- none");
  } else {
    for (const g of state.failed_runs.by_agent_type) renderFailedGroup(lines, g, runsHref);
  }
  lines.push("### Grouped by linear_issue_id");
  if (state.failed_runs.by_linear_issue.length === 0) {
    lines.push("- none");
  } else {
    for (const g of state.failed_runs.by_linear_issue) renderFailedGroup(lines, g, runsHref);
  }
  lines.push("");

  lines.push("## Cost and risk flags (PRD §6.2.5, source: runs/*.json)");
  lines.push("");
  if (state.cost_and_risk_flags.length === 0) {
    lines.push("- none");
  } else {
    for (const r of state.cost_and_risk_flags) renderCostRisk(lines, r, runsHref);
  }
  lines.push("");

  lines.push("## PR review queue (PRD §6.2.6, source: GitHub + runs/*.json + ADR-0007 reports)");
  lines.push("");
  if (state.pr_review_queue.length === 0) {
    lines.push("- none");
  } else {
    for (const r of state.pr_review_queue) renderPR(lines, r);
  }
  lines.push("");

  lines.push("## Learning candidates (PRD §6.2.7, source: runs/*.json + ADR-0007 reports)");
  lines.push("");
  if (state.learning_candidates.length === 0) {
    lines.push("- none");
  } else {
    for (const c of state.learning_candidates) renderLearning(lines, c, runsHref);
  }
  lines.push("");

  lines.push("## Telemetry gaps (PRD §6.3 routing, PRD §6.5.3)");
  lines.push("");
  for (const gap of state.telemetry_gaps) {
    lines.push(`- ${gap}`);
  }
  lines.push("");

  return lines.join("\n");
}

function renderActive(lines: string[], r: ActiveRunRow, runsHref: string): void {
  const stale = r.stale ? " **[stale]**" : "";
  lines.push(
    `- [\`${r.run_id}\`](${runsHref}${r.run_id}.md) · ${r.agent_type} · ${r.linear_issue_id} · ${r.autonomy_level} · cost=${r.cost_band} · started ${r.started_at}${stale}`,
  );
}

function renderBlocked(lines: string[], r: BlockedWorkRow, runsHref: string): void {
  const linear = r.linear_status ? ` · linear=${r.linear_status}` : "";
  lines.push(
    `- [\`${r.run_id}\`](${runsHref}${r.run_id}.md) · ${r.agent_type} · ${r.linear_issue_id}${linear} · status=${r.status} · reason: ${r.reason} · next: ${r.next_action}`,
  );
}

function renderRecent(lines: string[], r: RecentCompletionRow, runsHref: string): void {
  const pr = r.pr_url ? ` · PR ${r.pr_url}` : "";
  lines.push(
    `- [\`${r.run_id}\`](${runsHref}${r.run_id}.md) · ${r.agent_type} · ${r.linear_issue_id} · ${r.status} · ${truncate(r.summary, 140)}${pr}`,
  );
}

function renderFailedGroup(
  lines: string[],
  g: FailedRunsGroup,
  runsHref: string,
): void {
  const refs = g.run_ids
    .map((id) => `[\`${id}\`](${runsHref}${id}.md)`)
    .join(", ");
  const mark = g.retrospective_candidate ? " · **retro candidate**" : "";
  lines.push(
    `- ${g.key}: ${g.count} failure${g.count === 1 ? "" : "s"} · latest err: ${truncate(g.most_recent_error, 120)}${mark} · runs: ${refs}`,
  );
}

function renderCostRisk(lines: string[], r: CostRiskRow, runsHref: string): void {
  const spent = r.spent_usd !== null ? ` · spent=$${r.spent_usd}` : "";
  const model = r.model ? ` · model=${r.model}` : "";
  lines.push(
    `- [\`${r.run_id}\`](${runsHref}${r.run_id}.md) · ${r.agent_type} · ${r.linear_issue_id} · cost=${r.cost_band} · risk=${r.risk_level ?? "unknown"}${spent}${model} · ${truncate(r.reason, 140)}`,
  );
}

function renderPR(lines: string[], r: PRReviewQueueRow): void {
  const prLabel = r.pr_number !== null ? `PR #${r.pr_number}` : "PR (unknown #)";
  const href = r.pr_url ? ` — ${r.pr_url}` : "";
  const qa = r.qa_findings_by_severity
    ? ` · findings=${formatFindings(r.qa_findings_by_severity)}`
    : " · findings=requires future telemetry";
  const run = r.run_id ? ` · run=\`${r.run_id}\`` : "";
  lines.push(
    `- ${prLabel}${href} · ${r.lat_key} · risk=${r.risk_level ?? "unknown"} · cost=${r.cost_band}${qa}${run}`,
  );
}

function renderLearning(
  lines: string[],
  c: LearningCandidate,
  runsHref: string,
): void {
  const refs =
    c.run_ids.length > 0
      ? " · runs: " +
        c.run_ids.map((id) => `[\`${id}\`](${runsHref}${id}.md)`).join(", ")
      : "";
  const span =
    c.span.start || c.span.end ? ` · span: ${c.span.start} → ${c.span.end}` : "";
  lines.push(
    `- **${c.kind}** \`${c.cluster_key}\` · count=${c.count}${span}${refs} · ${c.retro_intake_hint}`,
  );
}

function formatFindings(
  f: Readonly<Record<string, number>>,
): string {
  const order = ["critical", "high", "medium", "low"];
  const parts: string[] = [];
  for (const k of order) {
    const v = f[k];
    if (typeof v === "number" && v > 0) parts.push(`${k}=${v}`);
  }
  if (parts.length === 0) return "none";
  return parts.join(",");
}

function humanView(v: string): string {
  return v.replace(/_/g, " ");
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
