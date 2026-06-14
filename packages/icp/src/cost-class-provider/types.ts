/**
 * Cost-class provider router types (LAT-58).
 *
 * Implements ADR-0020's cost-class inference routing policy. The router
 * emits exactly one of four `cost_class` values for every dispatch, picks
 * `runpod_frontline` by default for bounded implementation tickets, picks
 * `frontier_reasoning` on routing-input criteria, picks `local_dev_fallback`
 * only on explicit opt-in, and picks `mock` only for CI/test/dry-run paths.
 *
 * Refuse-on-missing-config: when the chosen lane's required config is
 * missing, invalid, or unreachable, the router refuses the dispatch rather
 * than silently demoting to `local_dev_fallback` or escalating to
 * `frontier_reasoning`.
 *
 * Pure types — no I/O.
 */

/** The four cost classes defined by ADR-0020. */
export type CostClass =
  /** RunPod-hosted Qwen via opencode — default lane for bounded implementation. */
  | "runpod_frontline"
  /** Operator's local Qwen endpoint — opt-in fallback / dev lane. */
  | "local_dev_fallback"
  /** Frontier-grade model (Claude Sonnet/Opus) — reasoning, architecture. */
  | "frontier_reasoning"
  /** Deterministic, no-network, no-spend — CI, tests, dry runs. */
  | "mock";

/**
 * Runtime lane the cost class maps to at this moment. Distinct from
 * `cost_class` because the mapping can change over time (e.g. a different
 * cloud-GPU provider replaces RunPod).
 */
export type Lane =
  | "opencode+runpod-qwen"
  | "opencode+local-qwen"
  | "claude-sonnet-via-actions"
  | "claude-anthropic-direct"
  | "mock";

/**
 * Structured reason for a routing decision. Maps to the `lane_reason`
 * field ADR-0020 requires in run evidence.
 */
export type LaneReason =
  | "bounded-ticket-pack"
  | "architecture-risk"
  | "planning-or-decomposition"
  | "review-synthesis"
  | "hard-debugging"
  | "adr-prd-synthesis"
  | "operator-opt-in-local"
  | "ci-mock"
  | "dry-run"
  | "unknown";

/**
 * ADR-0009 cost band, used for the `expected_cost_band` routing-time hook.
 */
export type ExpectedCostBand = "normal" | "elevated" | "runaway_risk";

/* ------------------------------------------------------------------ */
/* Routing inputs (per ADR-0020 § "Routing inputs")                  */
/* ------------------------------------------------------------------ */

/**
 * What the router needs to classify one dispatch. Mirrors the ticket-pack
 * frontmatter and dispatch caller metadata. All fields are optional so
 * callers can pass a partial snapshot; the router uses sensible defaults
 * for missing fields.
 */
export interface RoutingInputs {
  /** Ticket size in expected changed files (0 = unknown). */
  filesInScope?: number;
  /** Ticket size in expected changed lines (0 = unknown). */
  linesInScope?: number;
  /** Whether acceptance criteria are concrete. */
  concreteAcceptanceCriteria?: boolean;
  /** Whether the ticket touches durable contracts (ADRs, PRDs, workflows). */
  architectureRisk?: boolean;
  /** Whether the work is planning/decomposition / review synthesis. */
  isPlanningOrReview?: boolean;
  /** Autonomy / approval level from the ticket. */
  autonomyLevel?: string;
  /** Whether this dispatch carries explicit operator opt-in for local lane. */
  operatorOptInLocal?: boolean;
  /** Whether this is a CI / test / dry-run dispatch. */
  ciDispatch?: boolean;
  /** Dry-run mode flag from the dispatcher. */
  dryRun?: boolean;
  /** Previous run ID if this is a re-route. */
  reRouteOf?: string;
  /** Budget cap from the ticket, if provided. */
  budget_cap_usd?: number | null;
}

/* ------------------------------------------------------------------ */
/* Routing decision output (per ADR-0020 § "Observability fields")    */
/* ------------------------------------------------------------------ */

/**
 * The router's decision for one dispatch. Always produced, even on
 * refusal. Carries the complete set of ADR-0020 observability fields.
 */
export interface RoutingDecision {
  /** One of the four cost classes. Never null. */
  cost_class: CostClass;
  /** Concrete runtime lane chosen. Never null. */
  lane_chosen: Lane;
  /** Short reason for the routing decision. Never null. */
  lane_reason: LaneReason;
  /** Whether the router refused the dispatch due to missing config. */
  routing_refused: boolean;
  /** Structured refusal reason when `routing_refused` is true. */
  routing_refused_reason: string | null;
  /** The ADR-0009 band the routing decision implies. */
  expected_cost_band: ExpectedCostBand;
  /** Prior run ID if this is a re-route. Empty otherwise. */
  re_route_of: string | null;
  /** Which required config items were present at routing time (by name). */
  config_present: ReadonlyArray<string>;
  /**
   * Budget cap associated with this dispatch, when provided. Used by
   * the provider router to emit into run evidence.
   */
  budget_cap_usd?: number | null;
}

/* ------------------------------------------------------------------ */
/* Provider config and invocation (MVP: Anthropic direct)             */
/* ------------------------------------------------------------------ */

/**
 * Shared configuration a provider needs to accept a request. The router
 * resolves credentials *outside* the provider and injects them here.
 */
export interface ProviderConfig {
  /** Cost class this provider is configured for. */
  cost_class: CostClass;
  /** Human-readable provider identity. Never a secret. */
  id: string;
  /** Model identifier (e.g. "claude-sonnet-4-20250514"). Never a secret. */
  model: string;
  /** Cost band this provider is expected to produce. */
  expected_cost_band: ExpectedCostBand;
  /**
   * Budget cap for this provider's runs. When the ticket's cap exceeds
   * this, the provider may refuse or produce an `elevated` cost band.
   * `null` means no cap.
   */
  budget_cap_usd: number | null;
  /** Whether the provider requires credentials to be present. */
  requiresCredentials: boolean;
  /**
   * Names of config items the provider needs. The router checks these
   * at routing time and sets `config_present` accordingly.
   */
  requiredConfigItems: ReadonlyArray<string>;
}

/**
 * Invocation request the provider router produces after routing. Carries
 * provider/model/cost-band/budget-cap metadata into run evidence.
 */
export interface ProviderInvocationRequest {
  /** Cost class selected by the router. */
  cost_class: CostClass;
  /** Concrete lane the router chose. */
  lane_chosen: Lane;
  /** Model identifier the provider will use. */
  model: string;
  /** Cost band expected for this run. */
  cost_band: ExpectedCostBand;
  /** Budget cap from the ticket, when provided. */
  budget_cap_usd: number | null;
  /** Provider identity. */
  provider_id: string;
  /** Stable run correlation ID. */
  run_id: string;
  /** The ticket/issue identifier being dispatched. */
  linear_issue_id: string;
  /** Structured reason the router chose this lane. */
  lane_reason: LaneReason;
  /** Whether this is a dry run. */
  dry_run: boolean;
  /** Additional context the caller wants passed to the provider. */
  context: Readonly<Record<string, unknown>>;
}

/**
 * Run evidence the provider produces after a dispatch. Emits provider,
 * model, cost-band, budget-cap metadata into run evidence per LAT-58
 * acceptance criteria.
 */
export interface ProviderRunEvidence {
  /** Stable run correlation ID. */
  run_id: string;
  /** Cost class the run was dispatched under. */
  cost_class: CostClass;
  /** Concrete lane used. */
  lane_chosen: Lane;
  /** Model identifier the provider used. */
  model: string;
  /** Cost band observed at runtime. */
  cost_band: ExpectedCostBand;
  /** Budget cap the run was dispatched with. */
  budget_cap_usd: number | null;
  /** Actual spend in USD (null when unavailable). */
  spent_usd: number | null;
  /** Provider identity that ran this dispatch. */
  provider_id: string;
  /** Structured reason the router chose this lane. */
  lane_reason: LaneReason;
  /** Whether the run was a dry run. */
  dry_run: boolean;
  /** Arbitrary notes from the provider, secret-safe. */
  notes: ReadonlyArray<string>;
}

/* ------------------------------------------------------------------ */
/* Provider refusal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Structured refusal the provider router emits when required config is
 * missing or the provider cannot accept a request.
 */
export interface ProviderRefusal {
  /** Always "provider_refused". */
  kind: "refusal";
  /** Structured reason for the refusal. */
  reason: ProviderRefusalReason;
  /** Secret-safe human-readable message. */
  message: string;
}

/**
 * Refusal reasons the provider router can emit.
 */
export type ProviderRefusalReason =
  /** Missing required credential for the chosen lane. */
  | "missing_credentials"
  /** Config item present but invalid (e.g. malformed model name). */
  | "invalid_config"
  /** Provider is unavailable (network, timeout). */
  | "provider_unavailable"
  /** Provider returned an unexpected error. */
  | "provider_error"
  /** Request exceeds provider's budget cap. */
  | "budget_exceeded"
  /** Provider declined to run this ticket. */
  | "provider_declined";

/* ------------------------------------------------------------------ */
/* Router interface                                                   */
/* ------------------------------------------------------------------ */

/**
 * The cost-class provider router. Accepts routing inputs and provider
 * registry, produces a `RoutingDecision` that carries all ADR-0020
 * observability fields.
 */
export interface CostClassProviderRouter {
  /**
   * Route a dispatch. Returns a decision even when refused — the caller
   * can inspect `decision.routing_refused` and `decision.routing_refused_reason`.
   */
  route(inputs: RoutingInputs, config: ProviderConfig): RoutingDecision;

  /**
   * Build a structured `ProviderInvocationRequest` from a routing decision.
   * Throws `ProviderRouterError` if the decision is refused.
   */
  buildInvocation(
    decision: RoutingDecision,
    linearIssueId: string,
    context?: Readonly<Record<string, unknown>>,
  ): ProviderInvocationRequest;

  /**
   * Build run evidence from a provider result. Always succeeds — the
   * caller feeds whatever the provider returns (run, refusal, error).
   */
  buildEvidence(
    decision: RoutingDecision,
    result: ProviderRunResult,
  ): ProviderRunEvidence;
}

/**
 * Result from invoking a provider. Either a successful run or a refusal.
 */
export type ProviderRunResult =
  | { kind: "run"; evidence: Partial<ProviderRunEvidence> }
  | { kind: "refusal"; refusal: ProviderRefusal };

/* ------------------------------------------------------------------ */
/* Router errors                                                      */
/* ------------------------------------------------------------------ */

/**
 * Thrown by the router when it encounters a structural error (e.g.
 * building an invocation on a refused decision).
 */
export class ProviderRouterError extends Error {
  readonly kind: "router_error";

  constructor(message: string) {
    super(message);
    this.name = "ProviderRouterError";
    this.kind = "router_error";
  }
}
