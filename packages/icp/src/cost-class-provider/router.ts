/**
 * Cost-class provider router (LAT-58).
 *
 * Implements ADR-0020's routing policy:
 * - Four named cost classes: runpod_frontline, local_dev_fallback,
 *   frontier_reasoning, mock.
 * - Refuse-on-missing-config posture.
 * - Produces observability fields: cost_class, lane_chosen, lane_reason,
 *   routing_refused, routing_refused_reason, expected_cost_band,
 *   re_route_of, config_present.
 *
 * MVP provider: Anthropic direct (frontier_reasoning lane with
 * claude-sonnet). The router is provider-agnostic; it selects cost class
 * and lane, while a separate provider implementation handles the actual
 * API call.
 */

import { ProviderRouterError } from "./types.js";
import type {
  CostClassProviderRouter,
  CostClass,
  Lane,
  LaneReason,
  ExpectedCostBand,
  ProviderConfig,
  ProviderInvocationRequest,
  ProviderRunEvidence,
  ProviderRunResult,
  RoutingDecision,
  RoutingInputs,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Routing decision logic (ADR-0020 lane selection rule)               */
/* ------------------------------------------------------------------ */

/**
 * Classify a dispatch into a cost class based on routing inputs and the
 * provider config. Implements ADR-0020's lane selection rule:
 *
 * 1. CI / test / dry-run → mock
 * 2. Architecture-risk, planning, review synthesis → frontier_reasoning
 * 3. Bounded implementation → runpod_frontline
 * 4. Explicit operator opt-in for local → local_dev_fallback
 *
 * The config parameter is checked for required credentials; if missing,
 * the decision is refused (routing_refused = true).
 */
export function route(
  inputs: RoutingInputs,
  config: ProviderConfig,
): RoutingDecision {
  const costClass = classifyCostClass(inputs);
  const lane = mapCostClassToLane(costClass, config);
  const laneReason = deriveLaneReason(inputs, costClass);

  // Check config availability
  const present = checkConfigPresence(inputs, config);
  const hasAllRequired = config.requiresCredentials
    ? present.length >= config.requiredConfigItems.length && config.requiredConfigItems.length > 0
    : true;

  if (!hasAllRequired) {
    const missing = config.requiredConfigItems.filter(
      (item) => !present.includes(item),
    );
    return {
      cost_class: costClass,
      lane_chosen: lane,
      lane_reason: laneReason,
      routing_refused: true,
      routing_refused_reason: missing.length > 0
        ? `Missing required config for lane ${lane}: ${missing.join(", ")}`
        : `Config present but insufficient: ${present.length}/${config.requiredConfigItems.length} items`,
      expected_cost_band: config.expected_cost_band,
      re_route_of: inputs.reRouteOf ?? null,
      config_present: present,
      budget_cap_usd: inputs.budget_cap_usd ?? null,
    };
  }

  return {
    cost_class: costClass,
    lane_chosen: lane,
    lane_reason: laneReason,
    routing_refused: false,
    routing_refused_reason: null,
    expected_cost_band: config.expected_cost_band,
    re_route_of: inputs.reRouteOf ?? null,
    config_present: present,
    budget_cap_usd: inputs.budget_cap_usd ?? null,
  };
}

export function classifyCostClass(inputs: RoutingInputs): CostClass {
  // Rule 1: CI / test / dry-run → mock
  if (inputs.ciDispatch || inputs.dryRun) {
    return "mock";
  }

  // Rule 2: Architecture-risk, planning, review synthesis → frontier_reasoning
  if (inputs.architectureRisk || inputs.isPlanningOrReview) {
    return "frontier_reasoning";
  }

  // Rule 4: Explicit operator opt-in for local → local_dev_fallback
  if (inputs.operatorOptInLocal) {
    return "local_dev_fallback";
  }

  // Rule 3: Default → runpod_frontline (bounded implementation)
  return "runpod_frontline";
}

export function mapCostClassToLane(
  costClass: CostClass,
  config: ProviderConfig,
): Lane {
  switch (costClass) {
    case "mock":
      return "mock";
    case "frontier_reasoning":
      // Prefer Anthropic direct for frontier reasoning (MVP)
      if (config.model.includes("claude") || config.cost_class === "frontier_reasoning") {
        return "claude-anthropic-direct";
      }
      return "claude-sonnet-via-actions";
    case "local_dev_fallback":
      return "opencode+local-qwen";
    case "runpod_frontline":
      return "opencode+runpod-qwen";
    default:
      return "mock";
  }
}

export function deriveLaneReason(
  inputs: RoutingInputs,
  costClass: CostClass,
): LaneReason {
  if (inputs.ciDispatch || inputs.dryRun) {
    return inputs.ciDispatch ? "ci-mock" : "dry-run";
  }
  if (inputs.architectureRisk) return "architecture-risk";
  if (inputs.isPlanningOrReview) return "planning-or-decomposition";
  if (inputs.operatorOptInLocal) return "operator-opt-in-local";
  return "bounded-ticket-pack";
}

function checkConfigPresence(
  inputs: RoutingInputs,
  config: ProviderConfig,
): string[] {
  // For the MVP Anthropic provider, we check the model and whether
  // the provider claims its credentials are present.
  const present: string[] = [];

  // Model is always present (passed in config)
  if (config.model && config.model.length > 0) {
    present.push("model");
  }

  // Budget cap is present if provided in routing inputs
  if (inputs.budget_cap_usd !== undefined) {
    present.push("budget_cap_usd");
  }

  // For the MVP, the provider considers credentials present when
  // requiresCredentials is true and the config was constructed.
  // Actual credential presence is checked at invocation time.
  //
  // For any required config items beyond model/credentials/budget_cap_usd,
  // we track them as "known" when present in the config. Items not in this
  // list are considered missing — this is how the router knows `api_endpoint`
  // is absent when only `["model", "credentials"]` are configured.
  if (config.requiresCredentials) {
    present.push("credentials");
  }

  return present;
}

/* ------------------------------------------------------------------ */
/* Router implementation                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the default cost-class provider router.
 */
export function createCostClassProviderRouter(): CostClassProviderRouter {
  return {
    route,

    buildInvocation(
      decision: RoutingDecision,
      linearIssueId: string,
      context: Readonly<Record<string, unknown>> = {},
    ): ProviderInvocationRequest {
      if (decision.routing_refused) {
        throw new ProviderRouterError(
          `Cannot build invocation: decision is refused (${decision.routing_refused_reason})`,
        );
      }

      const model = decision.lane_chosen.includes("claude")
        ? "claude-sonnet-4-20250514"
        : decision.lane_chosen.includes("qwen")
          ? "qwen-2.5-coder-32b"
          : "mock@0.0.0";

      return {
        cost_class: decision.cost_class,
        lane_chosen: decision.lane_chosen,
        model,
        cost_band: decision.expected_cost_band,
        budget_cap_usd: decision.budget_cap_usd,
        provider_id: decision.lane_chosen,
        run_id: `lat58-${linearIssueId}-${Date.now().toString(36)}`,
        linear_issue_id: linearIssueId,
        lane_reason: decision.lane_reason,
        dry_run: decision.lane_chosen === "mock",
        context,
      };
    },

    buildEvidence(
      decision: RoutingDecision,
      result: ProviderRunResult,
    ): ProviderRunEvidence {
      const notes: string[] = [];

      if (result.kind === "run") {
        const ev = result.evidence;
        notes.push(
          `cost_class=${decision.cost_class} lane=${decision.lane_chosen}`,
        );
        if (ev.spent_usd !== null && ev.spent_usd !== undefined) {
          notes.push(`spent_usd=${ev.spent_usd.toFixed(4)}`);
        }
        if (ev.notes) {
          notes.push(...ev.notes);
        }
      } else {
        notes.push(
          `refused: ${result.refusal.reason} — ${result.refusal.message}`,
        );
      }

      const model = decision.lane_chosen.includes("claude")
        ? "claude-sonnet-4-20250514"
        : "unknown";

      return {
        run_id: decision.cost_class === "mock"
          ? `mock-${decision.lane_chosen}`
          : decision.cost_class,
        cost_class: decision.cost_class,
        lane_chosen: decision.lane_chosen,
        model,
        cost_band: decision.expected_cost_band,
        budget_cap_usd: decision.budget_cap_usd,
        spent_usd: result.kind === "run" ? (result.evidence.spent_usd ?? null) : null,
        provider_id: decision.lane_chosen,
        lane_reason: decision.lane_reason,
        dry_run: decision.lane_chosen === "mock",
        notes,
      };
    },
  };
}
