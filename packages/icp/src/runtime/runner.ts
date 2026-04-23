/**
 * Skill runner (ADR-0012 § "Skill runner").
 *
 * Executes a skill deterministically end-to-end: resolves tools, enforces the
 * autonomy/approval gate before any side effect, runs the skill's procedure,
 * and validates that the declared evidence was produced.
 *
 * The approval gate is enforced here, not in the CLI harness, so any caller
 * (CLI, test harness, future Perplexity shell-call harness) cannot bypass it.
 */
import type {
  AutonomyLevel,
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
    return null;
  }
}
