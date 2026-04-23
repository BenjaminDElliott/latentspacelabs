/**
 * Skill registry (ADR-0012 § "Skill registry").
 *
 * Responsibility: discover, validate, and index the set of skills the runner
 * can execute. Load-time validation is the runtime enforcement of ADR-0004's
 * provenance regime, ADR-0012's fail-fast-on-malformed-skill requirement, and
 * ADR-0016's rule that `derived_from:` must point into a canonical docs
 * directory (`docs/decisions/`, `docs/prds/`, `docs/process/`, or
 * `docs/templates/`).
 */
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { SkillDefinition, SkillStatus, ToolName } from "./contract.js";

/**
 * Canonical-doc roots a skill's `derived_from:` entry may point into
 * (ADR-0016 §Q3). Kept as a narrow allowlist so a skill cannot cite a
 * code file, a `.claude/` harness file, or an external URL as its
 * provenance source — the canonical regime is `docs/`.
 */
const CANONICAL_DOC_ROOTS = [
  "docs/decisions/",
  "docs/prds/",
  "docs/process/",
  "docs/templates/",
] as const;

// Skills declare more specific input/output types than the registry stores.
// The registry treats them uniformly, so we erase the generics here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkillDefinition = SkillDefinition<any, { status: SkillStatus } & Record<string, unknown>>;

export interface RegistryOptions {
  /** Absolute path used to resolve `derived_from:` entries. */
  repoRoot: string;
  /** Tool names the runtime can provide. A skill that declares an unknown tool fails fast. */
  availableTools: ReadonlyArray<ToolName>;
}

export class SkillRegistryError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly detail: string,
  ) {
    super(`skill '${skillName}' invalid: ${detail}`);
    this.name = "SkillRegistryError";
  }
}

export interface RegisteredSkill {
  readonly definition: AnySkillDefinition;
  readonly key: string;
}

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();

  constructor(private readonly options: RegistryOptions) {}

  async register(def: AnySkillDefinition): Promise<RegisteredSkill> {
    this.validateShape(def);
    await this.validateProvenance(def);
    this.validateTools(def);

    const key = `${def.name}@${def.version}`;
    if (this.skills.has(key)) {
      throw new SkillRegistryError(def.name, `duplicate skill ${key}`);
    }
    const entry: RegisteredSkill = { definition: def, key };
    this.skills.set(key, entry);
    return entry;
  }

  get(name: string, version?: string): RegisteredSkill | undefined {
    if (version) return this.skills.get(`${name}@${version}`);
    const match = [...this.skills.values()].find(
      (s) => s.definition.name === name,
    );
    return match;
  }

  list(): ReadonlyArray<RegisteredSkill> {
    return [...this.skills.values()];
  }

  private validateShape(def: AnySkillDefinition): void {
    if (!def.name || typeof def.name !== "string") {
      throw new SkillRegistryError(def.name ?? "<unnamed>", "missing name");
    }
    if (!/^\d+\.\d+\.\d+$/.test(def.version)) {
      throw new SkillRegistryError(
        def.name,
        `version '${def.version}' is not semver MAJOR.MINOR.PATCH`,
      );
    }
    if (typeof def.execute !== "function") {
      throw new SkillRegistryError(def.name, "execute is not a function");
    }
    if (!def.derived_at || !/^\d{4}-\d{2}-\d{2}$/.test(def.derived_at)) {
      throw new SkillRegistryError(
        def.name,
        "derived_at must be an ISO date (YYYY-MM-DD)",
      );
    }
  }

  private async validateProvenance(def: AnySkillDefinition): Promise<void> {
    if (!def.derived_from || def.derived_from.length === 0) {
      throw new SkillRegistryError(
        def.name,
        "derived_from is empty (ADR-0004 violation)",
      );
    }
    for (const rel of def.derived_from) {
      // Normalise backslashes so a path authored on Windows still validates
      // against the POSIX-style canonical roots below.
      const norm = rel.replace(/\\/g, "/");
      if (!CANONICAL_DOC_ROOTS.some((root) => norm.startsWith(root))) {
        throw new SkillRegistryError(
          def.name,
          `derived_from path must point into ${CANONICAL_DOC_ROOTS.join(", ")} (ADR-0016): ${rel}`,
        );
      }
      const abs = resolve(this.options.repoRoot, rel);
      try {
        await access(abs);
      } catch {
        throw new SkillRegistryError(
          def.name,
          `derived_from path does not resolve: ${rel}`,
        );
      }
    }
  }

  private validateTools(def: AnySkillDefinition): void {
    const available = new Set<ToolName>(this.options.availableTools);
    for (const tool of def.required_tools) {
      if (!available.has(tool)) {
        throw new SkillRegistryError(
          def.name,
          `required tool '${tool}' is not provided by the runtime`,
        );
      }
    }
  }
}
