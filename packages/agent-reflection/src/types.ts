/**
 * Types for the LAT-273 Agent Self-Improvement System (Phase 1: Foundation).
 *
 * Defines the experience log structure, reflection output schema, and
 * RAG-based retrieval primitives. All types are pure — no I/O dependencies.
 *
 * Key design principles:
 * - Hybrid structured + free-form reflection (PRD §4.1, Research §1.5)
 * - Bounded overhead: ≤1s task, ≤500 tokens (PRD §5)
 * - Experience stores context, actions, observations, outcomes, reflections
 */

// ─── Reflection Depth ───────────────────────────────────────────────────────

/**
 * Configurable reflection depth controlling how much detail the reflection
 * engine produces.
 *
 * - `quick`: A lightweight summary (≤50 tokens). Used for high-frequency,
 *   low-stakes actions where overhead matters more than depth.
 * - `standard`: The default. Structured fields + brief free-form reasoning.
 * - `deep`: Full analysis with multi-factor evaluation, confidence scores,
 *   and extracted rules. Used for critical or novel actions.
 */
export type ReflectionDepth = 'quick' | 'standard' | 'deep';

// ─── Experience Action ──────────────────────────────────────────────────────

/**
 * A single tool call or action taken by the agent during a task.
 */
export interface ExperienceAction {
  /** Stable, unique identifier for this action step. */
  id: string;

  /** The action label (e.g. "mcp_linear_get_issue", "terminal", "write_file"). */
  type: string;

  /** Parameters passed to the action, redacted of secrets. */
  parameters: Record<string, unknown>;

  /** ISO-8601 timestamp of when the action started. */
  startTime: string;

  /** ISO-8601 timestamp of when the action completed. */
  endTime: string;

  /** Whether the action succeeded. */
  success: boolean;

  /** Duration in milliseconds. */
  durationMs: number;

  /**
   * Raw output from the action (truncated if large).
   * Stored as string to keep the experience portable; structured consumers
   * can parse it further.
   */
  output: string;
}

// ─── Experience Observation ─────────────────────────────────────────────────

/**
 * An observation about the environment, state, or context at a point in time.
 * These are the agent's perceptions that influenced subsequent actions.
 */
export interface ExperienceObservation {
  /** When this observation was made. */
  timestamp: string;

  /** Category of observation (e.g. "error_detected", "tool_available", "state_change"). */
  category: string;

  /** Human-readable description of what was observed. */
  description: string;
}

// ─── Experience Outcome ─────────────────────────────────────────────────────

/**
 * Final outcome of the overall task or session.
 */
export interface ExperienceOutcome {
  /** Overall classification of the outcome. */
  classification: 'success' | 'partial_success' | 'failure' | 'interrupted';

  /** Numeric score 0–100 where 100 is perfect. */
  qualityScore: number;

  /**
   * Brief free-form assessment of what went right or wrong.
   * Used for human review and future reference.
   */
  assessment: string;

  /**
   * Whether the task completed within acceptable time.
   */
  withinTimeBudget: boolean;
}

// ─── Experience Log Entry ───────────────────────────────────────────────────

/**
 * A single experience record — the complete log of one agent task/session.
 *
 * This is the core data structure. Every reflection, retrieval, and skill
 * creation operation operates on this type.
 *
 * The schema version allows us to evolve the format without breaking consumers.
 */
export interface ExperienceLogEntry {
  /** Schema version — increment when the structure changes. */
  schemaVersion: '1.0.0';

  /** Stable unique identifier for this experience. */
  id: string;

  /** ISO-8601 timestamp of when this experience started. */
  startedAt: string;

  /** ISO-8601 timestamp of when this experience ended. */
  finishedAt: string;

  /** Total duration in milliseconds. */
  durationMs: number;

  /** The original task prompt or goal that initiated this session. */
  taskPrompt: string;

  /** Short description of the task, auto-generated or set by the caller. */
  taskSummary: string;

  /**
   * The environment or workspace context where the task was executed.
   * Examples: "hermes-agent", "opencode-sandbox", "unity-build".
   */
  workspaceContext: string;

  /** Tools or capabilities available during the task. */
  availableTools: string[];

  /** The actions taken during the task, in chronological order. */
  actions: ExperienceAction[];

  /** Observations made during the task. */
  observations: ExperienceObservation[];

  /** The final outcome of the task. */
  outcome: ExperienceOutcome;

  /** Reflections generated for this experience. */
  reflections: ReflectionEntry[];

  /**
   * Tags for classification and retrieval.
   * Examples: ["debugging", "api", "typescript"].
   */
  tags: string[];
}

// ─── Reflection Entry ───────────────────────────────────────────────────────

/**
 * A single reflection generated by the reflection engine.
 *
 * Hybrid format: structured fields for machine consumption + free-form
 * reasoning for nuance and edge cases.
 *
 * The token budget constraint (≤500 tokens) applies to the combined length
 * of all reflection fields in a single reflection.
 */
export interface ReflectionEntry {
  /** Schema version for reflection format. */
  schemaVersion: '1.0.0';

  /** Unique ID for this reflection. */
  id: string;

  /** Depth level used when generating this reflection. */
  depth: ReflectionDepth;

  /** ISO-8601 timestamp of when reflection was generated. */
  generatedAt: string;

  /**
   * Structured summary of the action/task.
   * Machine-readable; used by retrieval and skill creation.
   */
  structured: ReflectionStructured;

  /**
   * Free-form reasoning — the agent's natural-language analysis.
   * Captures nuance that structured fields might miss.
   * Bounded to ≤500 tokens total across all reflection fields.
   */
  freeFormReasoning: string;

  /**
   * Confidence score 0–1 for the reflection's conclusions.
   * 1.0 = very confident, 0.0 = uncertain.
   */
  confidence: number;

  /**
   * Extracted rules or heuristics from this reflection.
   * These are the "lessons learned" that can be applied to future tasks.
   */
  extractedRules: ExtractedRule[];
}

// ─── Structured Reflection Fields ───────────────────────────────────────────

/**
 * Machine-readable structured reflection fields.
 * Always present regardless of reflection depth.
 */
export interface ReflectionStructured {
  /** What was done — one-line summary of the primary action or decision. */
  actionSummary: string;

  /** Outcome classification for this specific action/step. */
  actionOutcome: 'success' | 'failure' | 'partial' | 'skipped';

  /**
   * Whether this action was a retry or a first attempt.
   */
  isRetry: boolean;

  /**
   * Key metrics for this action.
   */
  metrics: {
    /** Duration of the action in ms. */
    durationMs: number;
    /** Output size in characters. */
    outputSize: number;
    /** Number of errors encountered. */
    errorCount: number;
  };

  /**
   * Brief classification of what type of task this was.
   * Helps with similarity search and grouping.
   */
  taskType: string;

  /**
   * Key insight — one sentence capturing the main takeaway.
   */
  keyInsight: string;

  /**
   * Suggested rules or heuristics derived from this reflection.
   */
  suggestedRules: string[];
}

// ─── Extracted Rule ─────────────────────────────────────────────────────────

/**
 * A rule or heuristic extracted from reflection, applicable to future tasks.
 * Rules are the compressed knowledge that the system accumulates over time.
 */
export interface ExtractedRule {
  /** Unique identifier for this rule. */
  id: string;

  /** What the rule does, in one line. */
  description: string;

  /** When to apply this rule (trigger conditions). */
  triggerCondition: string;

  /** What action to take when triggered. */
  recommendedAction: string;

  /**
   * Confidence in this rule's effectiveness (0–1).
   * Initially low; increases with successful applications.
   */
  confidence: number;

  /** How many times this rule has been successfully applied. */
  applicationCount: number;

  /** Success rate (0–1) based on historical applications. */
  successRate: number;
}

// ─── Experience Store ───────────────────────────────────────────────────────

/**
 * Configuration for the experience store.
 */
export interface ExperienceStoreConfig {
  /** Maximum number of experiences to keep in memory. Oldest are evicted. */
  maxExperiences: number;

  /** Maximum length (characters) for the taskPrompt field. Longer prompts are truncated. */
  maxPromptLength: number;

  /** Maximum length (characters) for the output field in actions. */
  maxOutputLength: number;

  /**
   * Whether to enable vector embeddings for similarity search.
   * Set to `false` for environments without embedding support.
   */
  enableEmbeddings: boolean;
}

/**
 * Default configuration values.
 * These satisfy PRD §5 constraints: bounded overhead, reasonable storage.
 */
export const DEFAULT_EXPERIENCE_STORE_CONFIG: ExperienceStoreConfig = {
  maxExperiences: 100000,
  maxPromptLength: 4096,
  maxOutputLength: 2048,
  enableEmbeddings: true,
};

/**
 * Result of a similarity search over experiences.
 */
export interface SimilaritySearchResult {
  /** The matching experience. */
  experience: ExperienceLogEntry;

  /** Similarity score (0–1; higher = more similar). */
  score: number;
}

/**
 * Query options for similarity search.
 */
export interface SimilaritySearchOptions {
  /** Number of top results to return. Default: 5. */
  topK?: number;

  /** Minimum similarity score threshold (0–1). Results below are excluded. Default: 0.0. */
  minScore?: number;

  /** Filter by tags — only return experiences containing all these tags. */
  tagFilter?: string[];

  /** Filter by outcome classification. */
  outcomeFilter?: ExperienceOutcome['classification'];

  /** Filter by workspace context. */
  workspaceFilter?: string;
}

// ─── Reflection Engine Config ───────────────────────────────────────────────

/**
 * Configuration for the reflection engine.
 */
export interface ReflectionEngineConfig {
  /**
   * Default reflection depth. Can be overridden per-call.
   * - `quick`: Lightweight summary, ≤50 tokens.
   * - `standard`: Structured + brief reasoning, ≤150 tokens.
   * - `deep`: Full analysis with confidence scores, ≤500 tokens.
   */
  defaultDepth: ReflectionDepth;

  /** Maximum reflection token budget in characters. Default: 500. */
  maxReflectionTokens: number;

  /**
   * Whether to always generate free-form reasoning alongside structured fields.
   * Set to false only in ultra-low-overhead scenarios.
   */
  alwaysIncludeFreeForm: boolean;

  /**
   * Minimum confidence score for extracted rules to be considered actionable.
   * Rules below this threshold are stored but not recommended.
   */
  ruleActionThreshold: number;
}

/**
 * Default reflection engine configuration.
 * Balances usefulness with overhead constraints.
 */
export const DEFAULT_REFLECTION_ENGINE_CONFIG: ReflectionEngineConfig = {
  defaultDepth: 'standard',
  maxReflectionTokens: 500,
  alwaysIncludeFreeForm: true,
  ruleActionThreshold: 0.5,
};

// ─── Reflection Input ───────────────────────────────────────────────────────

/**
 * Input passed to the reflection engine to generate reflections.
 */
export interface ReflectionInput {
  /** The experience log entry to reflect on. */
  experience: ExperienceLogEntry;

  /** Reflection depth to use (overrides config default). */
  depth?: ReflectionDepth;
}

// ─── Reflection Output ──────────────────────────────────────────────────────

/**
 * Output from the reflection engine — one or more reflection entries.
 */
export interface ReflectionOutput {
  /** The input experience. */
  experience: ExperienceLogEntry;

  /** Generated reflection entries. */
  reflections: ReflectionEntry[];

  /** Total tokens consumed (estimated). */
  estimatedTokens: number;

  /** Processing time in milliseconds. */
  processingTimeMs: number;
}

// ─── Error Classes ──────────────────────────────────────────────────────────

/**
 * Thrown when the experience store exceeds its configured limit.
 */
export class ExperienceStoreFullError extends Error {
  override readonly name = 'ExperienceStoreFullError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when an experience cannot be serialized or deserialized.
 */
export class ExperienceParseError extends Error {
  override readonly name = 'ExperienceParseError';
  constructor(message: string) {
    super(message);
  }
}
