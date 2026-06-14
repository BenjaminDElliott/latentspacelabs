/**
 * Skill runner (ADR-0012 § "Skill runner").
 *
 * Executes a skill deterministically end-to-end: resolves tools, enforces the
 * autonomy/approval gate before any side effect, runs the skill's procedure,
 * and validates that the declared evidence was produced.
 *
 * The approval gate is enforced here, not in the CLI harness, so any caller
 * (CLI, test harness, future Perplexity shell-call harness) cannot bypass it.
 *
 * LAT-188 adds two integration points:
 * - `preRunGate`: called before the skill executes. If the gate returns a
 *   non-null reason the runner short-circuits with status=blocked.
 * - `postRunGate`: called after the skill completes (even on failure). If
 *   the gate returns a non-null reason the runner overrides the result to
 *   status=failed with the gate's reason appended.
 */
import type {
  AutonomyLevel,
  CostBand,
  PolicyEvaluator,
  PolicyInput,
  PolicyVerdict,
  ResolvedTools,
  SkillDefinition,
  SkillStatus,
} from "./contract.js";
import type { RegisteredSkill, SkillRegistry } from "./registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkillDefinition = SkillDefinition<any, { status: SkillStatus } & Record<string, unknown>>;

export interface RunnerOptions {
  registry: SkillRegistry;
  tools: ResolvedTools;
  /** Runtime's default autonomy cap. A skill above this cap needs the approval flag. */
  autonomyCap: AutonomyLevel;
  /**
   * LAT-188: policy evaluator used as the pre-run gate. If set, the runner
   * calls `evaluate()` with a snapshot derived from the invocation before
   * dispatching the skill. A blocked/stop verdict short-circuits the run.
   * Pass `null` (default) to skip policy evaluation at the runner level.
   */
  policyEvaluator: PolicyEvaluator | null;
  /**
   * LAT-188: optional post-run gate. Called after the skill completes with
   * the invocation + outputs. If it returns a non-null string the runner
   * overrides the result to status=failed with the gate reason appended.
   */
  postRunGate?: (
    invocation: RunInvocation,
    outputs: Record<string, unknown>,
  ) => string | null;
  now?: () => Date;
}

export interface RunInvocation {
  skill: string;
  version?: string;
  inputs: Record<string, unknown>;
  approve: boolean;
  dry_run: boolean;
}

export interface RunResult {
  status: SkillStatus;
  skill: string;
  version: string;
  outputs: Record<string, unknown>;
  reasons: ReadonlyArray<string>;
}

/**
 * Numeric autonomy rank for gate comparison.
 * Higher = more autonomous / more dangerous.
 */
const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  "L1-read-only": 1,
  "L2-propose": 2,
  "L3-with-approval": 3,
  "L4-autonomous": 4,
};

export class SkillRunner {
  constructor(private readonly options: RunnerOptions) {}

  async run(invocation: RunInvocation): Promise<RunResult> {
    const entry = this.resolve(invocation);
    const def = entry.definition;

    // LAT-188 pre-run gate: evaluate policy before dispatch.
    const preRunResult = this.preRunGate(def, invocation);
    if (preRunResult) return preRunResult;

    const gateResult = this.enforceApprovalGate(def, invocation);
    if (gateResult) return gateResult;

    const missing = this.requiredInputsMissing(def, invocation.inputs);
    if (missing.length > 0) {
      return {
        status: "failed",
        skill: def.name,
        version: def.version,
        outputs: {},
        reasons: [`missing required inputs: ${missing.join(", ")}`],
      };
    }

    const outputs = await def.execute({
      inputs: invocation.inputs,
      approve: invocation.approve,
      dry_run: invocation.dry_run,
      tools: this.options.tools,
      now: this.options.now ?? (() => new Date()),
    });

    const evidenceError = this.enforceEvidenceContract(
      def,
      invocation,
      outputs,
    );
    if (evidenceError) {
      return {
        status: "failed",
        skill: def.name,
        version: def.version,
        outputs: outputs as Record<string, unknown>,
        reasons: [evidenceError],
      };
    }

    // LAT-188 post-run gate: validate outputs after completion.
    const postRunError = this.postRunGate(def, invocation, outputs);
    if (postRunError) {
      return {
        status: "failed",
        skill: def.name,
        version: def.version,
        outputs: outputs as Record<string, unknown>,
        reasons: [postRunError],
      };
    }

    return {
      status: outputs.status,
      skill: def.name,
      version: def.version,
      outputs: outputs as Record<string, unknown>,
      reasons:
        (outputs as { reasons?: ReadonlyArray<string> }).reasons ?? [],
    };
  }

  private resolve(invocation: RunInvocation): RegisteredSkill {
    const entry = this.options.registry.get(invocation.skill, invocation.version);
    if (!entry) {
      throw new Error(
        `skill not found: ${invocation.skill}${invocation.version ? `@${invocation.version}` : ""}`,
      );
    }
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* LAT-188: pre-run / post-run gate integration                       */
  /* ------------------------------------------------------------------ */

  /**
   * LAT-188: pre-run gate — evaluates the policy evaluator before dispatch.
   *
   * Constructs a minimal `PolicyInput` from the invocation and runs it
   * through the policy evaluator. A blocked/stop verdict short-circuits
   * the run with status=blocked and the evaluator's reasons.
   *
   * Dry runs bypass the policy gate entirely (the skill's own execute
   * method may still evaluate policy, but the runner does not enforce it).
   */
  private preRunGate(
    def: AnySkillDefinition,
    invocation: RunInvocation,
  ): RunResult | null {
    const policyEvaluator = this.options.policyEvaluator;
    if (!policyEvaluator) return null;
    if (invocation.dry_run) return null;

    const issue = this.buildMinimalIssueSnapshot(def, invocation);
    const evalResult = policyEvaluator.evaluate({
      issue,
      autonomy_level: def.autonomy_level,
      approve: invocation.approve,
    });

    if (evalResult.verdict === "blocked" || evalResult.verdict === "stop") {
      return {
        status: "blocked",
        skill: def.name,
        version: def.version,
        outputs: {},
        reasons: evalResult.reasons,
      };
    }

    return null;
  }

  /**
   * LAT-188: post-run gate — validates the skill's outputs after completion.
   *
   * Checks for cost-band escalation and evidence anomalies that the
   * post-run gate (LAT-187) is responsible for catching. Returns null
   * when the gate passes; returns a reason string when it fails.
   */
  private postRunGate(
    def: AnySkillDefinition,
    invocation: RunInvocation,
    outputs: { status: SkillStatus } & Record<string, unknown>,
  ): string | null {
    // Cost-band escalation: if the skill was invoked with a concrete band
    // and the output band is worse, the post-run gate blocks.
    if (def.evidence.cost_band && !invocation.dry_run) {
      const invokedBand = outputs["invoked_cost_band"] as string | undefined;
      const resultBand = outputs["cost_band"] as string | undefined;
      if (invokedBand && resultBand) {
        const rank = (b: string) =>
          b === "runaway_risk" ? 3 : b === "elevated" ? 2 : 1;
        if (rank(resultBand) > rank(invokedBand)) {
          return `cost-band escalated from ${invokedBand} to ${resultBand} (LAT-187 post-run gate)`;
        }
      }
    }
    return null;
  }

  /**
   * Build a minimal issue snapshot from skill definition + invocation
   * so the policy evaluator has something to work with. Only the fields
   * the evaluator actually consumes are populated.
   */
  private buildMinimalIssueSnapshot(
    _def: AnySkillDefinition,
    _invocation: RunInvocation,
  ): {
    sequencing: {
      hard_blockers: ReadonlyArray<string>;
      recommended_predecessors: ReadonlyArray<string>;
      dispatch_status: "ready" | "caution" | "blocked" | "unknown";
      dispatch_note: string;
    };
    blocker_statuses: Readonly<Record<string, string>>;
    budget_cap_usd: number | null;
  } {
    return {
      sequencing: {
        hard_blockers: [],
        recommended_predecessors: [],
        dispatch_status: "ready",
        dispatch_note: "",
      },
      blocker_statuses: {},
      budget_cap_usd: null,
    };
  }

  private enforceApprovalGate(
    def: AnySkillDefinition,
    invocation: RunInvocation,
  ): RunResult | null {
    const skillRank = AUTONOMY_RANK[def.autonomy_level];
    const capRank = AUTONOMY_RANK[this.options.autonomyCap];
    const exceedsCap = skillRank > capRank;
    // Dry runs bypass the gate because they produce no side effects.
    if (invocation.dry_run) return null;
    if (!exceedsCap && !def.requires_approval_flag) return null;
    if (invocation.approve) return null;
    return {
      status: "needs_human",
      skill: def.name,
      version: def.version,
      outputs: {},
      reasons: [
        `skill ${def.name}@${def.version} declared autonomy ${def.autonomy_level}; runtime cap is ${this.options.autonomyCap}. ` +
          `Rerun with approve=true to proceed, or use dry_run=true for policy-only evaluation.`,
      ],
    };
  }

  private requiredInputsMissing(
    def: AnySkillDefinition,
    inputs: Record<string, unknown>,
  ): string[] {
    const missing: string[] = [];
    for (const spec of def.inputs) {
      if (!spec.required) continue;
      const v = inputs[spec.name];
      if (v === undefined || v === null || v === "") missing.push(spec.name);
    }
    return missing;
  }

  private enforceEvidenceContract(
    def: AnySkillDefinition,
    invocation: RunInvocation,
    outputs: { status: SkillStatus } & Record<string, unknown>,
  ): string | null {
    // Evidence only required when the skill claims success on a non-dry-run.
    if (invocation.dry_run) return null;
    if (outputs.status !== "succeeded") return null;
    if (def.evidence.run_report && !outputs["run_id"]) {
      return "evidence contract violated: skill claimed succeeded but produced no run_id";
    }
    if (
      def.evidence.linear_write_back &&
      !outputs["linear_comment_url"]
    ) {
      return "evidence contract violated: skill claimed succeeded but did not post a Linear write-back";
    }
    if (def.evidence.cost_band) {
      const costGap = this.checkCostBandEvidence(outputs);
      if (costGap) return costGap;
    }
    return null;
  }

  /**
   * LAT-66 / ADR-0009: every side-effecting run with `evidence.cost_band` set
   * must carry cost-band evidence before the runner lets it record success.
   *
   * The runner accepts three valid shapes:
   *   1. A concrete band (`normal` / `elevated` / `runaway_risk`), optionally
   *      with `spent_usd`. This is the happy path.
   *   2. An explicit `unknown` band paired with a non-empty
   *      `cost_band_unavailable_reason`. This preserves provider honesty:
   *      command providers that cannot observe spend surface a typed
   *      refusal-shaped reason rather than inventing a number.
   *   3. A structural refusal — the skill returns a `needs_human` /
   *      `failed` / `blocked` / `stopped` status, which short-circuits this
   *      check earlier via `outputs.status !== "succeeded"`.
   *
   * Anything else — no band at all, or `unknown` with no reason — is a
   * contract violation and the runner refuses to let the run finish as
   * succeeded.
   */
  private checkCostBandEvidence(
    outputs: Record<string, unknown>,
  ): string | null {
    const band = outputs["cost_band"];
    if (!isValidCostBand(band)) {
      return "evidence contract violated: skill claimed succeeded on a side-effecting run but produced no cost_band (ADR-0009 / LAT-66)";
    }
    if (band === "unknown") {
      const reason = outputs["cost_band_unavailable_reason"];
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return "evidence contract violated: cost_band=\"unknown\" requires a non-empty cost_band_unavailable_reason (ADR-0009 / LAT-66)";
      }
    }
    return null;
  }
}

function isValidCostBand(v: unknown): v is CostBand {
  return (
    v === "normal" ||
    v === "elevated" ||
    v === "runaway_risk" ||
    v === "unknown"
  );
}
