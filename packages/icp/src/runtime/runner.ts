/**
 * Skill runner (ADR-0012 § "Skill runner", LAT-166 § "Runner gate integration").
 *
 * Executes a skill deterministically end-to-end: resolves tools, enforces the
 * autonomy/approval gate before any side effect, runs the skill's procedure,
 * and validates that the declared evidence was produced.
 *
 * LAT-166: The runner optionally accepts an adapter runner gate that wraps
 * each skill execution. The gate runs pre-run validation, then the skill,
 * then post-run validation, and produces a structured gate outcome with
 * approve/propose/stop verdicts and bypass evidence.
 *
 * The approval gate is enforced here, not in the CLI harness, so any caller
 * (CLI, test harness, future Perplexity shell-call harness) cannot bypass it.
 */
import type {
  AdapterAction,
  ActionScope,
  AdapterGateOutcome,
  AgentType,
  AutonomyLevel,
  CostBand,
  GateVerdict,
  PostRunGateResult,
  PreRunGateInput,
  PreRunGateResult,
  PostRunGateInput,
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

/* ------------------------------------------------------------------ */
/* LAT-166: Skill runner gate integration                             */
/* ------------------------------------------------------------------ */

/**
 * Map a SkillDefinition onto a PreRunGateInput for the adapter runner gate.
 */
export function skillDefinitionToPreRunInput(
  def: SkillDefinition,
  inputs: Record<string, unknown>,
): PreRunGateInput {
  // Derive agent type from the skill's metadata or defaults to "coding"
  // for backward compatibility with existing skills.
  const agentType = (inputs["agent_type"] ?? "coding") as AgentType;
  // Derive the action from the skill name or metadata.
  const action = (inputs["action"] ?? "generic") as AdapterAction;
  // Derive scope from skill metadata or default to same_repo.
  const scope = (inputs["scope"] ?? "same_repo") as ActionScope;

  return {
    agent_type: agentType,
    action,
    scope,
    context: { autonomy_level: def.autonomy_level, dry_run: false },
  };
}

/**
 * Map a skill execution output onto a PostRunGateInput for the adapter runner gate.
 */
export function runOutputToPostRunInput(
  def: SkillDefinition,
  inputs: Record<string, unknown>,
  outputs: { status: SkillStatus } & Record<string, unknown>,
): PostRunGateInput {
  const agentType = (inputs["agent_type"] ?? "coding") as AgentType;
  const action = (inputs["action"] ?? "generic") as AdapterAction;
  const scope = (inputs["scope"] ?? "same_repo") as ActionScope;

  return {
    agent_type: agentType,
    action,
    scope,
    result: outputs,
  };
}

/* ------------------------------------------------------------------ */
/* Gate-protected skill runner (LAT-166)                              */
/* ------------------------------------------------------------------ */

/**
 * LAT-166: gate-protected skill runner.
 *
 * Wraps the existing SkillRunner with an adapter runner gate. The gate
 * validates each skill invocation before and after execution, producing
 * structured gate outcomes with approve/propose/stop verdicts and
 * bypass evidence.
 *
 * When the gate is not configured, the runner falls back to the existing
 * LAT-23 approval gate behavior (enforceApprovalGate + evidence contract).
 */
export interface GateRunnerOptions {
  /** The underlying skill runner. */
  runner: SkillRunner;
  /** Optional adapter runner gate. When absent, falls back to LAT-23 runner. */
  gate?: {
    preRun: { validate: (input: PreRunGateInput) => PreRunGateResult };
    postRun: { validate: (input: PostRunGateInput) => PostRunGateResult };
  };
  /**
   * Whether low-risk actions bypass the gate entirely.
   * When true, actions like `read_issue` and `generic` skip pre-run
   * validation and only get a lightweight post-run check.
   */
  bypassLowRisk?: boolean;
}

export interface GateRunInvocation extends RunInvocation {
  /** Override the agent type for gate evaluation. Defaults to "coding". */
  agent_type?: AgentType;
  /** Override the action for gate evaluation. Defaults to "generic". */
  action?: AdapterAction;
  /** Override the scope for gate evaluation. Defaults to "same_repo". */
  scope?: ActionScope;
}

export interface GateRunResult {
  /** The standard run result from the underlying runner. */
  run: RunResult;
  /** The gate outcome when the gate is configured. Null when gate is absent. */
  gateOutcome: AdapterGateOutcome<Record<string, unknown>> | null;
}

/**
 * Create a gate-protected skill runner.
 *
 * The returned `run` method executes skills through the adapter runner gate:
 *   preRun.validate → skill execution → postRun.validate
 *
 * When the gate is absent, it falls back to the existing SkillRunner.run
 * which uses the LAT-23 approval gate + evidence contract.
 */
export function createGateRunner(opts: GateRunnerOptions): {
  run(invocation: GateRunInvocation): Promise<GateRunResult>;
} {
  const { runner, gate, bypassLowRisk } = opts;

  return {
    async run(invocation: GateRunInvocation): Promise<GateRunResult> {
      // Resolve the skill definition first
      const entry = runner["resolve"] as (
        invocation: RunInvocation,
      ) => RegisteredSkill;
      const registered = entry.call(runner, invocation);
      const def = registered.definition;

      // If no gate is configured, fall back to existing LAT-23 runner
      if (!gate) {
        const runResult = await runner.run(invocation);
        return { run: runResult, gateOutcome: null };
      }

      // Build gate inputs from the invocation
      const gateInputs: Record<string, unknown> = {
        ...invocation.inputs,
        agent_type: invocation.agent_type ?? "coding",
        action: invocation.action ?? "generic",
        scope: invocation.scope ?? "same_repo",
      };

      const preRunInput: PreRunGateInput = {
        agent_type: gateInputs.agent_type as AgentType,
        action: gateInputs.action as AdapterAction,
        scope: gateInputs.scope as ActionScope,
        context: {
          autonomy_level: def.autonomy_level,
          dry_run: invocation.dry_run,
        },
      };

      const isLowRisk =
        bypassLowRisk &&
        (preRunInput.action === "read_issue" || preRunInput.action === "generic");

      // Pre-run validation
      const preResult = gate.preRun.validate(preRunInput);

      // Low-risk bypass
      if (isLowRisk) {
        const bypassEvidence = `bypassed: action="${preRunInput.action}" is low-risk (LAT-166)`;
        const runResult = await runner.run(invocation);

        // Still do a lightweight post-run check for low-risk bypassed actions
        const postRunResult = gate.postRun.validate({
          agent_type: preRunInput.agent_type,
          action: preRunInput.action,
          scope: preRunInput.scope,
          result: runResult.outputs,
        });

        return {
          run: runResult,
          gateOutcome: {
            verdict: worstVerdict(preResult.verdict, postRunResult.verdict),
            reasons: [
              ...preResult.reasons,
              ...postRunResult.reasons,
              bypassEvidence,
            ],
            result: runResult.outputs,
            preRunResult: {
              verdict: "approve",
              reasons: [bypassEvidence],
              suggestion: null,
            },
            postRunResult: postRunResult,
            bypassed: true,
            bypassEvidence,
          },
        };
      }

      // Pre-run stop → skip execution but still run the skill for evidence
      if (preResult.verdict === "stop") {
        const runResult = await runner.run(invocation);
        return {
          run: runResult,
          gateOutcome: {
            verdict: "stop",
            reasons: preResult.reasons,
            result: runResult.outputs,
            preRunResult: preResult,
            postRunResult: null,
            bypassed: false,
            bypassEvidence: null,
          },
        };
      }

      // Pre-run approve/propose → execute
      const runResult = await runner.run(invocation);

      // Post-run validation
      const postRunInput: PostRunGateInput = {
        agent_type: preRunInput.agent_type,
        action: preRunInput.action,
        scope: preRunInput.scope,
        result: runResult.outputs,
      };

      const postResult = gate.postRun.validate(postRunInput);

      // Combine verdicts
      const overallVerdict = worstVerdict(preResult.verdict, postResult.verdict);

      return {
        run: runResult,
        gateOutcome: {
          verdict: overallVerdict,
          reasons: [...preResult.reasons, ...postResult.reasons],
          result: runResult.outputs,
          preRunResult: preResult,
          postRunResult: postResult,
          bypassed: false,
          bypassEvidence: null,
        },
      };
    },
  };
}

/**
 * Return the worst (most restrictive) gate verdict from two.
 */
function worstVerdict(a: GateVerdict, b: GateVerdict): GateVerdict {
  const rank: Record<GateVerdict, number> = {
    approve: 0,
    propose: 1,
    stop: 2,
  };
  return rank[a] >= rank[b] ? a : b;
}

function isValidCostBand(v: unknown): v is CostBand {
  return (
    v === "normal" ||
    v === "elevated" ||
    v === "runaway_risk" ||
    v === "unknown"
  );
}
