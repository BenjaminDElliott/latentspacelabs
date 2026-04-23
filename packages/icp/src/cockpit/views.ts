/**
 * Cockpit view projections (LAT-55, PRD §6.2).
 *
 * Pure functions over `CockpitInputs`. Each view cites its PRD section and
 * source of record. No I/O here: the caller reads `runs/` via `reader.ts`
 * and threads the resulting records in. Linear/GitHub snapshots are
 * optional; views that depend on them degrade to reporting a telemetry gap
 * rather than inventing data (PRD §6.5.3).
 */
import type {
  ActiveRunRow,
  BlockedWorkRow,
  CockpitInputs,
  CockpitRunRecord,
  CockpitState,
  CostRiskRow,
  FailedRunsGroup,
  GitHubPRState,
  LearningCandidate,
  NotificationEvent,
  PRReviewQueueRow,
  QAReviewReport,
  RecentCompletionRow,
} from "./types.js";

const DEFAULT_STALE_STARTED_HOURS = 2;
const DEFAULT_FAILED_WINDOW_DAYS = 7;
const DEFAULT_ACTIVE_WINDOW_HOURS = 24;
const DEFAULT_RECENT_LIMIT = 20;

/**
 * Compute all seven views + notifications + telemetry gaps from a bundle
 * of inputs. Deterministic given the inputs and `now`.
 */
export function buildCockpitState(inputs: CockpitInputs): CockpitState {
  const now = inputs.now ?? new Date();
  const staleHours = inputs.stale_started_hours ?? DEFAULT_STALE_STARTED_HOURS;
  const failedWindowDays =
    inputs.failed_window_days ?? DEFAULT_FAILED_WINDOW_DAYS;
  const activeWindowHours =
    inputs.active_runs_window_hours ?? DEFAULT_ACTIVE_WINDOW_HOURS;
  const recentLimit = inputs.recent_completions_limit ?? DEFAULT_RECENT_LIMIT;

  const runs = [...inputs.runs];
  const linearIssues = new Map(
    (inputs.linear_issues ?? []).map((i) => [i.id, i]),
  );
  const openPRs: ReadonlyArray<GitHubPRState> = inputs.open_prs ?? [];
  const qaReports: ReadonlyArray<QAReviewReport> = inputs.qa_reports ?? [];

  const active_runs = projectActiveRuns(runs, now, activeWindowHours, staleHours);
  const blocked_work = projectBlockedWork(runs, linearIssues);
  const recent_completions = projectRecentCompletions(runs, recentLimit);
  const failed_runs = projectFailedRuns(runs, now, failedWindowDays);
  const cost_and_risk_flags = projectCostRiskFlags(runs, now, failedWindowDays);
  const pr_review_queue = projectPRReviewQueue(runs, openPRs, qaReports);
  const learning_candidates = projectLearningCandidates(
    runs,
    now,
    failedWindowDays,
    qaReports,
  );

  const notifications = deriveNotifications({
    active_runs,
    blocked_work,
    cost_and_risk_flags,
    failed_runs,
    pr_review_queue,
  });

  const telemetry_gaps = deriveTelemetryGaps({
    hasLinear: (inputs.linear_issues?.length ?? 0) > 0 || linearIssues.size > 0,
    hasPRs: openPRs.length > 0,
    hasQA: qaReports.length > 0,
  });

  return {
    rendered_at: now.toISOString(),
    active_runs,
    blocked_work,
    recent_completions,
    failed_runs,
    cost_and_risk_flags,
    pr_review_queue,
    learning_candidates,
    notifications,
    telemetry_gaps,
    totals: {
      runs_seen: runs.length,
      runs_rejected: 0,
      runs_in_window: runs.filter((r) =>
        withinDays(r.ended_at || r.started_at, now, failedWindowDays),
      ).length,
    },
  };
}

/* ------------------------- 6.2.1 Active runs --------------------------- */
function projectActiveRuns(
  runs: ReadonlyArray<CockpitRunRecord>,
  now: Date,
  windowHours: number,
  staleHours: number,
): ReadonlyArray<ActiveRunRow> {
  const rows: ActiveRunRow[] = [];
  for (const r of runs) {
    if (r.status !== "started") continue;
    if (!withinHours(r.started_at, now, windowHours)) continue;
    rows.push({
      run_id: r.run_id,
      agent_type: r.agent_type,
      linear_issue_id: r.linear_issue_id,
      autonomy_level: r.autonomy_level,
      cost_band: r.cost.band,
      started_at: r.started_at,
      stale: !withinHoursSince(r.started_at, now, staleHours),
    });
  }
  rows.sort((a, b) => cmpDateDesc(a.started_at, b.started_at));
  return rows;
}

/* ------------------------- 6.2.2 Blocked work -------------------------- */
function projectBlockedWork(
  runs: ReadonlyArray<CockpitRunRecord>,
  linearIssues: Map<string, { id: string; status: string }>,
): ReadonlyArray<BlockedWorkRow> {
  const rows: BlockedWorkRow[] = [];
  for (const r of runs) {
    if (r.status !== "needs_human" && r.status !== "failed" && r.status !== "cancelled") {
      continue;
    }
    const reason = r.decisions[0] ?? r.errors[0] ?? "(no reason recorded)";
    const next = r.next_actions[0] ?? "(no next action recorded)";
    rows.push({
      run_id: r.run_id,
      agent_type: r.agent_type,
      linear_issue_id: r.linear_issue_id,
      status: r.status as BlockedWorkRow["status"],
      reason,
      next_action: next,
      linear_status: linearIssues.get(r.linear_issue_id)?.status ?? null,
    });
  }
  rows.sort((a, b) => {
    const runA = runs.find((r) => r.run_id === a.run_id);
    const runB = runs.find((r) => r.run_id === b.run_id);
    return cmpDateDesc(runA?.ended_at ?? "", runB?.ended_at ?? "");
  });
  return rows;
}

/* --------------------- 6.2.3 Recent completions ------------------------ */
function projectRecentCompletions(
  runs: ReadonlyArray<CockpitRunRecord>,
  limit: number,
): ReadonlyArray<RecentCompletionRow> {
  const terminal = runs.filter(
    (r) =>
      r.status === "succeeded" ||
      r.status === "failed" ||
      r.status === "cancelled" ||
      r.status === "needs_human",
  );
  terminal.sort((a, b) => cmpDateDesc(a.ended_at, b.ended_at));
  return terminal.slice(0, limit).map((r) => ({
    run_id: r.run_id,
    agent_type: r.agent_type,
    linear_issue_id: r.linear_issue_id,
    status: r.status,
    summary: r.summary,
    pr_url: r.correlation.pr_url,
    ended_at: r.ended_at,
  }));
}

/* ----------------------- 6.2.4 Failed runs ----------------------------- */
function projectFailedRuns(
  runs: ReadonlyArray<CockpitRunRecord>,
  now: Date,
  windowDays: number,
): CockpitState["failed_runs"] {
  const failed = runs.filter(
    (r) => r.status === "failed" && withinDays(r.ended_at, now, windowDays),
  );

  const byAgent = new Map<string, CockpitRunRecord[]>();
  const byIssue = new Map<string, CockpitRunRecord[]>();
  for (const r of failed) {
    push(byAgent, r.agent_type, r);
    if (r.linear_issue_id) push(byIssue, r.linear_issue_id, r);
  }

  const by_agent_type = mapGroups(byAgent, "by_agent_type");
  const by_linear_issue = mapGroups(byIssue, "by_linear_issue");

  return {
    by_agent_type,
    by_linear_issue,
    window_days: windowDays,
  };
}

function mapGroups(
  m: Map<string, CockpitRunRecord[]>,
  kind: FailedRunsGroup["kind"],
): ReadonlyArray<FailedRunsGroup> {
  const groups: FailedRunsGroup[] = [];
  for (const [key, rs] of m) {
    rs.sort((a, b) => cmpDateDesc(a.ended_at, b.ended_at));
    const first = rs[0];
    if (!first) continue;
    groups.push({
      kind,
      key,
      count: rs.length,
      most_recent_error: first.errors[0] ?? "(no error recorded)",
      run_ids: rs.map((r) => r.run_id),
      retrospective_candidate: rs.length >= 2,
    });
  }
  groups.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return groups;
}

/* --------------------- 6.2.5 Cost and risk flags ----------------------- */
function projectCostRiskFlags(
  runs: ReadonlyArray<CockpitRunRecord>,
  now: Date,
  windowDays: number,
): ReadonlyArray<CostRiskRow> {
  const rows: CostRiskRow[] = [];
  for (const r of runs) {
    if (!withinDays(r.ended_at || r.started_at, now, windowDays)) continue;
    const costFlag = r.cost.band === "elevated" || r.cost.band === "runaway_risk";
    const riskFlag = r.risk_level === "high" || r.risk_level === "critical";
    if (!costFlag && !riskFlag) continue;
    const reason = r.decisions[0] ?? r.errors[0] ?? "(flagged by band only)";
    rows.push({
      run_id: r.run_id,
      agent_type: r.agent_type,
      linear_issue_id: r.linear_issue_id,
      cost_band: r.cost.band,
      risk_level: r.risk_level ?? "unknown",
      reason,
      spent_usd: r.cost.spent_usd,
      model: r.agent_metadata?.model ?? null,
      severity_rank: rankSeverity(r.cost.band, r.risk_level ?? null),
    });
  }
  rows.sort(
    (a, b) => b.severity_rank - a.severity_rank || a.run_id.localeCompare(b.run_id),
  );
  return rows;
}

function rankSeverity(
  band: CockpitRunRecord["cost"]["band"],
  risk: CockpitRunRecord["risk_level"] | null,
): number {
  // runaway_risk / critical first, then elevated / high, else zero.
  let n = 0;
  if (band === "runaway_risk") n += 20;
  else if (band === "elevated") n += 5;
  if (risk === "critical") n += 20;
  else if (risk === "high") n += 5;
  return n;
}

/* ----------------------- 6.2.6 PR review queue ------------------------- */
function projectPRReviewQueue(
  runs: ReadonlyArray<CockpitRunRecord>,
  prs: ReadonlyArray<GitHubPRState>,
  qaReports: ReadonlyArray<QAReviewReport>,
): ReadonlyArray<PRReviewQueueRow> {
  const rows: PRReviewQueueRow[] = [];
  const qaByPr = new Map(qaReports.map((q) => [q.pr_number, q]));

  // Path 1: open PRs in the GitHub snapshot with a LAT-* key.
  for (const pr of prs ?? []) {
    if (pr.state !== "open") continue;
    const lat = pr.lat_key ?? extractLatKey(pr.title);
    if (!lat) continue; // PRD §9.3: dispatch-backed only.
    const run = runs.find(
      (r) => r.linear_issue_id === lat || r.correlation.pr_url === pr.url,
    );
    const qa = qaByPr.get(pr.number);
    rows.push({
      pr_number: pr.number,
      pr_url: pr.url,
      pr_title: pr.title,
      lat_key: lat,
      author: pr.author ?? null,
      qa_findings_by_severity: qa?.findings_by_severity ?? null,
      risk_level: run?.risk_level ?? "unknown",
      cost_band: run?.cost.band ?? "unknown",
      run_id: run?.run_id ?? null,
    });
  }

  // Path 2: runs carry a PR URL but caller supplied no GitHub snapshot.
  // Surface `started` or `needs_human` rows so the operator is not blind;
  // terminal `succeeded`/`failed`/`cancelled` rows belong in Recent Completions
  // or Failed Runs, not the review queue.
  if (!prs || prs.length === 0) {
    for (const r of runs) {
      const url = r.correlation.pr_url;
      if (!url) continue;
      if (!r.linear_issue_id) continue;
      if (r.status !== "needs_human" && r.status !== "started") continue;
      rows.push({
        pr_number: null,
        pr_url: url,
        pr_title: null,
        lat_key: r.linear_issue_id,
        author: null,
        qa_findings_by_severity: null,
        risk_level: r.risk_level ?? "unknown",
        cost_band: r.cost.band,
        run_id: r.run_id,
      });
    }
  }

  rows.sort((a, b) => {
    const aw = prSortWeight(a);
    const bw = prSortWeight(b);
    if (aw !== bw) return bw - aw;
    return (a.pr_number ?? 0) - (b.pr_number ?? 0);
  });
  return rows;
}

function prSortWeight(r: PRReviewQueueRow): number {
  const f = r.qa_findings_by_severity;
  if (f) {
    if ((f["critical"] ?? 0) > 0) return 100;
    if ((f["high"] ?? 0) > 0) return 50;
  }
  if (r.risk_level === "critical") return 80;
  if (r.risk_level === "high") return 40;
  return 0;
}

function extractLatKey(title: string | null): string | null {
  if (!title) return null;
  const m = title.match(/\bLAT-\d+\b/);
  return m ? m[0] : null;
}

/* --------------------- 6.2.7 Learning candidates ----------------------- */
function projectLearningCandidates(
  runs: ReadonlyArray<CockpitRunRecord>,
  now: Date,
  windowDays: number,
  qaReports: ReadonlyArray<{ pr_number: number; finding_classes: ReadonlyArray<string> }>,
): ReadonlyArray<LearningCandidate> {
  const failedInWindow = runs.filter(
    (r) => r.status === "failed" && withinDays(r.ended_at, now, windowDays),
  );

  const out: LearningCandidate[] = [];

  // Repeated errors[0] class across ≥2 runs.
  const byErr = new Map<string, CockpitRunRecord[]>();
  for (const r of failedInWindow) {
    const klass = r.errors[0];
    if (!klass) continue;
    push(byErr, klass, r);
  }
  for (const [klass, rs] of byErr) {
    if (rs.length < 2) continue;
    rs.sort((a, b) => cmpDateAsc(a.ended_at, b.ended_at));
    const first = rs[0]!;
    const last = rs[rs.length - 1]!;
    out.push({
      kind: "repeated_error_class",
      cluster_key: klass,
      count: rs.length,
      span: { start: first.ended_at, end: last.ended_at },
      run_ids: rs.map((r) => r.run_id),
      retro_intake_hint:
        "candidate for ADR-0010 retro intake: repeated errors[0] class across runs",
    });
  }

  // ≥2 consecutive failed runs for the same agent_type (chronological order).
  const byAgent = new Map<string, CockpitRunRecord[]>();
  for (const r of runs) {
    if (!r.ended_at) continue;
    push(byAgent, r.agent_type, r);
  }
  for (const [agentType, rs] of byAgent) {
    rs.sort((a, b) => cmpDateAsc(a.ended_at, b.ended_at));
    let streakStart = -1;
    let streakLen = 0;
    let longest: { start: number; len: number } = { start: -1, len: 0 };
    for (let i = 0; i < rs.length; i++) {
      if (rs[i]!.status === "failed") {
        if (streakLen === 0) streakStart = i;
        streakLen += 1;
        if (streakLen > longest.len) longest = { start: streakStart, len: streakLen };
      } else {
        streakLen = 0;
      }
    }
    if (longest.len >= 2) {
      const slice = rs.slice(longest.start, longest.start + longest.len);
      const first = slice[0]!;
      const last = slice[slice.length - 1]!;
      out.push({
        kind: "consecutive_failed_agent",
        cluster_key: agentType,
        count: longest.len,
        span: { start: first.ended_at, end: last.ended_at },
        run_ids: slice.map((r) => r.run_id),
        retro_intake_hint:
          "candidate for ADR-0010 retro intake: consecutive failures for the same agent_type",
      });
    }
  }

  // Recurring PR-review finding class across ≥2 PRs.
  const byFinding = new Map<string, number[]>();
  for (const q of qaReports) {
    for (const klass of q.finding_classes) {
      push(byFinding, klass, q.pr_number);
    }
  }
  for (const [klass, prNums] of byFinding) {
    const unique = Array.from(new Set(prNums));
    if (unique.length < 2) continue;
    out.push({
      kind: "recurring_pr_finding",
      cluster_key: klass,
      count: unique.length,
      span: { start: "", end: "" },
      run_ids: [],
      retro_intake_hint:
        "candidate for ADR-0010 retro intake: recurring PR-review finding class",
    });
  }

  out.sort((a, b) => b.count - a.count || a.cluster_key.localeCompare(b.cluster_key));
  return out;
}

/* ----------------------- Notification tiering -------------------------- */
function deriveNotifications(args: {
  active_runs: ReadonlyArray<ActiveRunRow>;
  blocked_work: ReadonlyArray<BlockedWorkRow>;
  cost_and_risk_flags: ReadonlyArray<CostRiskRow>;
  failed_runs: CockpitState["failed_runs"];
  pr_review_queue: ReadonlyArray<PRReviewQueueRow>;
}): ReadonlyArray<NotificationEvent> {
  const out: NotificationEvent[] = [];

  // PRD §6.4.1 synchronous-page triggers.
  for (const row of args.cost_and_risk_flags) {
    if (row.cost_band === "runaway_risk") {
      out.push({
        tier: "synchronous_page",
        reason: "runaway_risk cost band (ADR-0009 halt event)",
        run_id: row.run_id,
        linear_issue_id: row.linear_issue_id,
        source_view: "cost_and_risk_flags",
      });
    } else if (row.risk_level === "critical") {
      out.push({
        tier: "synchronous_page",
        reason: "risk_level=critical (PRD §6.4.1)",
        run_id: row.run_id,
        linear_issue_id: row.linear_issue_id,
        source_view: "cost_and_risk_flags",
      });
    }
  }
  for (const row of args.blocked_work) {
    if (row.status === "needs_human") {
      out.push({
        tier: "synchronous_page",
        reason: "needs_human halt (ADR-0008 approval gate)",
        run_id: row.run_id,
        linear_issue_id: row.linear_issue_id,
        source_view: "blocked_work",
      });
    }
  }
  for (const pr of args.pr_review_queue) {
    const crit = pr.qa_findings_by_severity?.["critical"] ?? 0;
    if (crit > 0) {
      out.push({
        tier: "synchronous_page",
        reason: "PR review queue: critical QA/PR-review finding",
        run_id: pr.run_id ?? "unknown",
        linear_issue_id: pr.lat_key,
        source_view: "pr_review_queue",
      });
    }
  }
  for (const active of args.active_runs) {
    if (active.stale) {
      out.push({
        tier: "synchronous_page",
        reason: "stale started run (exceeded stale_started threshold)",
        run_id: active.run_id,
        linear_issue_id: active.linear_issue_id,
        source_view: "active_runs",
      });
    }
  }

  // PRD §6.4.2 ambient-queue triggers.
  for (const row of args.cost_and_risk_flags) {
    if (row.cost_band === "elevated" && row.risk_level !== "critical") {
      out.push({
        tier: "ambient_queue",
        reason: "elevated cost band",
        run_id: row.run_id,
        linear_issue_id: row.linear_issue_id,
        source_view: "cost_and_risk_flags",
      });
    }
  }
  for (const group of args.failed_runs.by_linear_issue) {
    if (group.count >= 2) {
      out.push({
        tier: "ambient_queue",
        reason: `repeated failure on ${group.key} (${group.count} runs)`,
        run_id: group.run_ids[0] ?? "unknown",
        linear_issue_id: group.key,
        source_view: "learning_candidates",
      });
    }
  }
  for (const pr of args.pr_review_queue) {
    const high = pr.qa_findings_by_severity?.["high"] ?? 0;
    if (high > 0 && (pr.qa_findings_by_severity?.["critical"] ?? 0) === 0) {
      out.push({
        tier: "ambient_queue",
        reason: "PR review queue: high-severity QA finding",
        run_id: pr.run_id ?? "unknown",
        linear_issue_id: pr.lat_key,
        source_view: "pr_review_queue",
      });
    }
  }

  return out;
}

function deriveTelemetryGaps(args: {
  hasLinear: boolean;
  hasPRs: boolean;
  hasQA: boolean;
}): ReadonlyArray<string> {
  const gaps: string[] = [
    "step-level / live progress — requires future telemetry",
    "full prompt/response traces — requires future telemetry",
    "cross-run aggregates beyond pilot volume — requires future telemetry",
  ];
  if (!args.hasLinear) {
    gaps.push("Linear issue state not supplied — Blocked work `linear_status` unresolved");
  }
  if (!args.hasPRs) {
    gaps.push("GitHub PR state not supplied — PR review queue degrades to run-report PR URLs only");
  }
  if (!args.hasQA) {
    gaps.push("ADR-0007 QA/PR-review reports not supplied — QA finding counts omitted");
  }
  return gaps;
}

/* ------------------------------- helpers ------------------------------- */
function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function parseDate(s: string): number {
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

function cmpDateDesc(a: string, b: string): number {
  return parseDate(b) - parseDate(a);
}

function cmpDateAsc(a: string, b: string): number {
  return parseDate(a) - parseDate(b);
}

function withinHours(ts: string, now: Date, hours: number): boolean {
  const t = parseDate(ts);
  if (!t) return false;
  return now.getTime() - t <= hours * 3600_000;
}

function withinHoursSince(ts: string, now: Date, hours: number): boolean {
  const t = parseDate(ts);
  if (!t) return false;
  return now.getTime() - t <= hours * 3600_000;
}

function withinDays(ts: string, now: Date, days: number): boolean {
  const t = parseDate(ts);
  if (!t) return false;
  return now.getTime() - t <= days * 86_400_000;
}
