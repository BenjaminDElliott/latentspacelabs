/**
 * Anthropic direct provider (LAT-58 MVP).
 *
 * Wraps the Anthropic Messages API as the frontier_reasoning lane provider.
 * The MVP uses the raw fetch-based HTTP API (no SDK dependency) to keep
 * the package light. It accepts an `apiKey` injected at construction time
 * and never reads `process.env` directly.
 *
 * Acceptance criteria alignment:
 * - Requires explicit provider credentials; refuses if missing.
 * - Emits provider/model/cost-band/budget-cap metadata into run evidence.
 * - Stub/mock mode is available via `createMockAnthropicProvider`.
 */

import type {
  CostClass,
  ExpectedCostBand,
  Lane,
  LaneReason,
  ProviderConfig,
  ProviderInvocationRequest,
  ProviderRefusal,
  ProviderRunEvidence,
  ProviderRunResult,
  RoutingDecision,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Anthropic provider                                                  */
/* ------------------------------------------------------------------ */

export interface AnthropicProviderOptions {
  /**
   * Anthropic API key. Required for `dispatch`; the provider refuses
   * if missing at invocation time.
   */
  apiKey: string;
  /** Model identifier. Defaults to Claude Sonnet. */
  model?: string;
  /** Max tokens for the response. Defaults to 4096. */
  maxTokens?: number;
  /** System prompt prefix prepended to every request. */
  systemPrompt?: string;
  /** Timeout in ms before the provider refuses. Defaults to 60_000. */
  timeoutMs?: number;
  /** Optional `fetch` implementation for tests. Defaults to global `fetch`. */
  fetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

/**
 * Build an Anthropic direct provider. The provider validates its
 * configuration at construction time (model must be non-empty).
 * Credentials (apiKey) are checked at invocation time.
 */
export function createAnthropicProvider(
  opts: AnthropicProviderOptions,
) {
  const model = opts.model ?? "claude-sonnet-4-20250514";
  const maxTokens = opts.maxTokens ?? 4096;
  const systemPrompt =
    opts.systemPrompt ??
    "You are a coding agent. Produce a single PR for the given ticket.";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetchFn = opts.fetch ?? (globalThis as Record<string, unknown>).fetch as AnthropicProviderOptions["fetch"];

  return {
    /** Human-readable identity. Never a secret. */
    id: "anthropic-direct",
    /** Model used. Never a secret. */
    model,

    /**
     * Dispatch a request to Anthropic. Validates credentials, sends a
     * Messages API call, and returns structured run evidence or a
     * refusal.
     */
    async dispatch(
      req: ProviderInvocationRequest,
    ): Promise<ProviderRunResult> {
      // Credential check (ADR-0020: refuse, don't silently fallback)
      if (
        typeof opts.apiKey !== "string" ||
        opts.apiKey.length < 10
      ) {
        return {
          kind: "refusal",
          refusal: {
            kind: "refusal",
            reason: "missing_credentials",
            message: `Anthropic provider requires an API key (got "${opts.apiKey?.slice(0, 6)}..."${opts.apiKey?.length ?? 0} chars)`,
          },
        };
      }

      // Build the user message from the invocation request
      const userMessage = buildUserMessage(req);

      // Send the Anthropic Messages API request
      const result = await callAnthropic({
        fetchFn,
        apiKey: opts.apiKey,
        model,
        maxTokens,
        systemPrompt,
        userMessage,
        timeoutMs,
      });

      return result;
    },

    /**
     * Build run evidence from a dispatch result.
     */
    buildEvidence(
      decision: RoutingDecision,
      result: ProviderRunResult,
    ): ProviderRunEvidence {
      const notes: string[] = [];

      if (result.kind === "run") {
        notes.push(`cost_class=${decision.cost_class}`);
        notes.push(`lane=${decision.lane_chosen}`);
        notes.push(`model=${model}`);
        const spent = result.evidence.spent_usd;
        if (spent !== null && spent !== undefined && spent > 0) {
          notes.push(`spent_usd=${spent.toFixed(4)}`);
        }
        if (result.evidence.notes) {
          notes.push(...result.evidence.notes);
        }
      } else {
        notes.push(
          `refused: ${result.refusal.reason} — ${result.refusal.message}`,
        );
      }

      return {
        run_id: decision.cost_class === "mock"
          ? `mock-${decision.lane_chosen}`
          : `anthropic-${decision.cost_class}`,
        cost_class: decision.cost_class,
        lane_chosen: decision.lane_chosen,
        model,
        cost_band: decision.expected_cost_band,
        budget_cap_usd: decision.budget_cap_usd,
        spent_usd: result.kind === "run"
          ? (result.evidence.spent_usd ?? null)
          : null,
        provider_id: this.id,
        lane_reason: decision.lane_reason,
        dry_run: decision.lane_chosen === "mock",
        notes,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mock Anthropic provider (tests / smoke runs)                        */
/* ------------------------------------------------------------------ */

export interface MockAnthropicProviderOptions {
  /** Canned response text per linear_issue_id. */
  responses?: Readonly<Record<string, string>>;
  /** Whether to simulate a refusal. */
  alwaysRefuse?: boolean;
  /** Refusal reason when alwaysRefuse is true. */
  refusalReason?: ProviderRefusal["reason"];
  /** Refusal message when alwaysRefuse is true. */
  refusalMessage?: string;
  /** Simulated spend in USD. Defaults to 0. */
  simulatedSpentUsd?: number;
}

/**
 * Build a mock Anthropic provider that returns deterministic responses.
 * No network, no spend — suitable for CI, unit tests, and smoke runs.
 */
export function createMockAnthropicProvider(
  opts: MockAnthropicProviderOptions = {},
) {
  const responses = opts.responses ?? {};
  const alwaysRefuse = opts.alwaysRefuse ?? false;
  const refusalReason = opts.refusalReason ?? "provider_declined";
  const refusalMessage =
    opts.refusalMessage ?? "Mock Anthropic provider refused for testing.";
  const simulatedSpentUsd = opts.simulatedSpentUsd ?? 0;

  return {
    id: "mock-anthropic",
    model: "claude-sonnet-4-mock",

    async dispatch(
      req: ProviderInvocationRequest,
    ): Promise<ProviderRunResult> {
      if (alwaysRefuse) {
        return {
          kind: "refusal",
          refusal: {
            kind: "refusal",
            reason: refusalReason,
            message: refusalMessage,
          },
        };
      }

      const cannedText = responses[req.linear_issue_id] ?? null;

      return {
        kind: "run",
        evidence: {
          cost_class: req.cost_class,
          lane_chosen: req.lane_chosen,
          model: req.model,
          cost_band: req.cost_band,
          budget_cap_usd: req.budget_cap_usd,
          spent_usd: simulatedSpentUsd,
          notes: [
            cannedText ?? `Mock Anthropic response for ${req.linear_issue_id}`,
            `provider=mock-anthropic lane=${req.lane_chosen}`,
          ],
        },
      };
    },

    buildEvidence(
      decision: RoutingDecision,
      result: ProviderRunResult,
    ): ProviderRunEvidence {
      const notes: string[] = [];
      if (result.kind === "run") {
        notes.push(`cost_class=${decision.cost_class}`);
        notes.push(`lane=${decision.lane_chosen}`);
        notes.push("model=claude-sonnet-4-mock");
        const spent = result.evidence.spent_usd;
        if (spent !== null && spent !== undefined && spent > 0) {
          notes.push(`spent_usd=${spent.toFixed(4)}`);
        }
      } else {
        notes.push(
          `refused: ${result.refusal.reason} — ${result.refusal.message}`,
        );
      }

      return {
        run_id: "mock-anthropic",
        cost_class: decision.cost_class,
        lane_chosen: decision.lane_chosen,
        model: "claude-sonnet-4-mock",
        cost_band: decision.expected_cost_band,
        budget_cap_usd: decision.budget_cap_usd,
        spent_usd: result.kind === "run"
          ? (result.evidence.spent_usd ?? null)
          : null,
        provider_id: "mock-anthropic",
        lane_reason: decision.lane_reason,
        dry_run: true,
        notes,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Anthropic API call helper                                           */
/* ------------------------------------------------------------------ */

interface AnthropicCallArgs {
  fetchFn: AnthropicProviderOptions["fetch"];
  apiKey: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userMessage: string;
  timeoutMs: number;
}

interface AnthropicApiResponse {
  content?: ReadonlyArray<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

async function callAnthropic(
  args: AnthropicCallArgs,
): Promise<ProviderRunResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await args.fetchFn(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": args.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: args.model,
          max_tokens: args.maxTokens,
          system: args.systemPrompt,
          messages: [
            { role: "user", content: args.userMessage },
          ],
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    let body: AnthropicApiResponse;
    try {
      body = await response.json();
    } catch {
      return {
        kind: "refusal",
        refusal: {
          kind: "refusal",
          reason: "provider_unavailable",
          message: `Anthropic returned HTTP ${response.status} with non-JSON body`,
        },
      };
    }

    if (body.error) {
      return {
        kind: "refusal",
        refusal: {
          kind: "refusal",
          reason: "provider_unavailable",
          message: `Anthropic API error: ${body.error.type} — ${body.error.message}`,
        },
      };
    }

    const text = body.content?.find((c) => c.type === "text")?.text;

    if (!text) {
      return {
        kind: "refusal",
        refusal: {
          kind: "refusal",
          reason: "provider_declined",
          message: "Anthropic returned no text content",
        },
      };
    }

    // Estimate cost based on token usage
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    // Claude Sonnet pricing: ~$3/M input tokens, $15/M output tokens
    const estimatedCost = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

    return {
      kind: "run",
      evidence: {
        cost_band: "normal",
        spent_usd: estimatedCost > 0 ? estimatedCost : null,
        notes: [
          text.slice(0, 500), // Truncate to avoid bloating evidence
          `input_tokens=${inputTokens} output_tokens=${outputTokens}`,
        ],
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message =
      err instanceof Error
        ? err.message
        : "unknown error";
    return {
      kind: "refusal",
      refusal: {
        kind: "refusal",
        reason: message.includes("abort") || message.includes("fetch")
          ? "provider_unavailable"
          : "provider_error",
        message: `Anthropic call failed: ${message}`,
      },
    };
  }
}

function buildUserMessage(req: ProviderInvocationRequest): string {
  const parts: string[] = [];
  parts.push(
    `Dispatch for Linear issue: ${req.linear_issue_id}`,
  );
  parts.push(`Cost class: ${req.cost_class}`);
  parts.push(`Lane: ${req.lane_chosen}`);
  parts.push(`Model: ${req.model}`);
  if (req.budget_cap_usd !== null && req.budget_cap_usd !== undefined) {
    parts.push(`Budget cap: $${req.budget_cap_usd}`);
  }
  parts.push(`Cost band: ${req.cost_band}`);
  if (req.context.ticket_title) {
    parts.push(`Title: ${(req.context.ticket_title as string).slice(0, 200)}`);
  }
  if (req.context.ticket_summary) {
    parts.push(`Summary: ${(req.context.ticket_summary as string).slice(0, 500)}`);
  }
  if (req.context.guardrails && Array.isArray(req.context.guardrails)) {
    parts.push(`Guardrails: ${(req.context.guardrails as string[]).join(", ")}`);
  }
  parts.push(`Run ID: ${req.run_id}`);
  return parts.join("\n");
}
