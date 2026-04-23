/**
 * Linear adapter (ADR-0012 § "Linear adapter", ADR-0017 Rule 1).
 *
 * Two factories live here:
 *
 * - `createStubLinearAdapter` — used by unit tests and the CLI's `--stub` path
 *   for local exercise of the dispatch skill without network.
 * - `createLinearAdapter` — the production factory. It talks to the Linear
 *   GraphQL API over `fetch`, parses the dispatch-readiness fields the
 *   `dispatch-ticket` skill needs, and posts a policy-compliant evidence
 *   comment. It is the single module that resolves a credential handle to a
 *   live Authorization header (ADR-0017 Rule 1: the adapter is the only
 *   module that holds a raw token value).
 *
 * Secret hygiene invariants (ADR-0017, LAT-64 §6.3):
 * - The API key never appears in thrown error messages, rejection reasons, or
 *   error cause chains surfaced to the skill runner.
 * - The adapter never logs or serialises the API key; event callbacks receive
 *   identity-only metadata.
 */
import type {
  LinearAdapter,
  LinearIssueSnapshot,
} from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Stub adapter                                                        */
/* ------------------------------------------------------------------ */

export interface StubLinearAdapterOptions {
  /** Pre-seeded issues, keyed by LAT-* id. */
  issues: Readonly<Record<string, LinearIssueSnapshot>>;
  /** Collects every comment posted via the adapter. */
  commentSink?: (c: { issueId: string; body: string; url: string }) => void;
}

export function createStubLinearAdapter(
  opts: StubLinearAdapterOptions,
): LinearAdapter {
  let counter = 0;
  return {
    async readIssue(id: string): Promise<LinearIssueSnapshot> {
      const snap = opts.issues[id];
      if (!snap) throw new Error(`stub linear adapter: unknown issue ${id}`);
      return snap;
    },
    async postComment(issueId: string, body: string) {
      counter += 1;
      const url = `https://linear.app/stub/issue/${issueId}/comment/${counter}`;
      opts.commentSink?.({ issueId, body, url });
      return { url };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Production adapter                                                  */
/* ------------------------------------------------------------------ */

/**
 * Typed error kinds the skill runner can pattern-match on to project into
 * `needs_human`, `failed`, or `blocked`. None of the `message` strings
 * produced by this adapter contain the API key, the full raw request body,
 * or any response header value.
 */
export type LinearAdapterErrorKind =
  | "missing_credentials"
  | "issue_not_found"
  | "malformed_ticket"
  | "api_error"
  | "rate_limited"
  | "unauthorized"
  | "network_error";

export class LinearAdapterError extends Error {
  readonly kind: LinearAdapterErrorKind;
  readonly status: number | null;
  constructor(
    kind: LinearAdapterErrorKind,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "LinearAdapterError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Minimal fetch signature the adapter depends on. Matches Node 20's global
 * `fetch` loosely enough to be injected by tests without importing undici.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export interface LinearAdapterOptions {
  /**
   * Linear personal API key (`lin_api_*`). Must be loaded by the typed ICP
   * config module (ADR-0017 Rule 1); the adapter never reads `process.env`
   * itself. Callers without that loader yet may use
   * `loadLinearCredentialFromEnv()`.
   */
  apiKey: string;
  /** GraphQL endpoint. Defaults to the public Linear endpoint. */
  endpoint?: string;
  /** Custom fetch (for tests). Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /**
   * Optional event hook for sanitised structured logging. Never receives
   * the API key, request bodies, or response headers.
   */
  onEvent?: (event: LinearAdapterEvent) => void;
}

export type LinearAdapterEvent =
  | { type: "read_issue_started"; issueId: string }
  | { type: "read_issue_ok"; issueId: string; resolvedIdentifier: string }
  | {
      type: "read_issue_failed";
      issueId: string;
      kind: LinearAdapterErrorKind;
      status: number | null;
    }
  | { type: "post_comment_started"; issueId: string }
  | { type: "post_comment_ok"; issueId: string; commentId: string }
  | {
      type: "post_comment_failed";
      issueId: string;
      kind: LinearAdapterErrorKind;
      status: number | null;
    };

const DEFAULT_ENDPOINT = "https://api.linear.app/graphql";

/**
 * Minimal env loader. The production ICP should swap this for the typed
 * config module once LAT-60/LAT-61 land (see ADR-0017 Rule 1). Until then,
 * this is the single sanctioned reader of `process.env.LINEAR_API_KEY`.
 *
 * Throws `LinearAdapterError{kind: "missing_credentials"}` when the key is
 * absent, with a sanitised message that names the variable but carries no
 * value, prefix, length, or derived fingerprint.
 */
export function loadLinearCredentialFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const v = env["LINEAR_API_KEY"];
  if (typeof v !== "string" || v.length === 0) {
    throw new LinearAdapterError(
      "missing_credentials",
      "LINEAR_API_KEY is not set. Populate your local `.env` from `.env.example` (ADR-0017 Rule 1) before dispatching against the live Linear API.",
    );
  }
  return v;
}

/**
 * Build a production `LinearAdapter`. The returned object exposes only
 * `readIssue` and `postComment`; the API key is closed over and never
 * re-exposed through the public surface.
 */
export function createLinearAdapter(opts: LinearAdapterOptions): LinearAdapter {
  if (typeof opts.apiKey !== "string" || opts.apiKey.length === 0) {
    throw new LinearAdapterError(
      "missing_credentials",
      "Linear adapter was constructed without an API key. Load it through the typed ICP config module (ADR-0017 Rule 1); do not read process.env from a skill.",
    );
  }
  const apiKey = opts.apiKey;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch: FetchLike =
    opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== "function") {
    throw new LinearAdapterError(
      "network_error",
      "No fetch implementation available. Run under Node 20+ or inject `fetch` via LinearAdapterOptions.",
    );
  }
  const emit = (e: LinearAdapterEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // Observer must never break the adapter.
    }
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: apiKey,
  };

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    issueIdForEvent: string,
    opKind: "read" | "write",
  ): Promise<T> {
    let res: FetchLikeResponse;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      const e = new LinearAdapterError(
        "network_error",
        `Linear API request failed before reaching the server: ${stripSecret(
          sanitiseErrorMessage(err),
          apiKey,
        )}`,
      );
      emit(
        opKind === "read"
          ? { type: "read_issue_failed", issueId: issueIdForEvent, kind: e.kind, status: null }
          : { type: "post_comment_failed", issueId: issueIdForEvent, kind: e.kind, status: null },
      );
      throw e;
    }

    if (res.status === 401 || res.status === 403) {
      const e = new LinearAdapterError(
        "unauthorized",
        `Linear API rejected the credential (HTTP ${res.status}). Rotate LINEAR_API_KEY per ADR-0017 Rule 5 and confirm the LAT team scope.`,
        res.status,
      );
      emit(
        opKind === "read"
          ? { type: "read_issue_failed", issueId: issueIdForEvent, kind: e.kind, status: res.status }
          : { type: "post_comment_failed", issueId: issueIdForEvent, kind: e.kind, status: res.status },
      );
      throw e;
    }

    if (res.status === 429) {
      const e = new LinearAdapterError(
        "rate_limited",
        "Linear API rate-limited this client (HTTP 429). Retry later; dispatch is surfaced as needs_human until the window clears.",
        429,
      );
      emit(
        opKind === "read"
          ? { type: "read_issue_failed", issueId: issueIdForEvent, kind: e.kind, status: 429 }
          : { type: "post_comment_failed", issueId: issueIdForEvent, kind: e.kind, status: 429 },
      );
      throw e;
    }

    if (!res.ok) {
      const e = new LinearAdapterError(
        "api_error",
        `Linear API returned HTTP ${res.status}.`,
        res.status,
      );
      emit(
        opKind === "read"
          ? { type: "read_issue_failed", issueId: issueIdForEvent, kind: e.kind, status: res.status }
          : { type: "post_comment_failed", issueId: issueIdForEvent, kind: e.kind, status: res.status },
      );
      throw e;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new LinearAdapterError(
        "api_error",
        `Linear API returned unparseable JSON: ${stripSecret(
          sanitiseErrorMessage(err),
          apiKey,
        )}`,
      );
    }

    const bodyObj = body as {
      data?: T;
      errors?: ReadonlyArray<{ message?: string }>;
    };
    if (bodyObj.errors && bodyObj.errors.length > 0) {
      const messages = bodyObj.errors
        .map((e) =>
          typeof e.message === "string" ? e.message : "unknown GraphQL error",
        )
        .map((m) => stripSecret(m, apiKey));
      throw new LinearAdapterError(
        "api_error",
        `Linear GraphQL errors: ${messages.join("; ")}`,
      );
    }
    if (!bodyObj.data) {
      throw new LinearAdapterError(
        "api_error",
        "Linear GraphQL response had no data field.",
      );
    }
    return bodyObj.data;
  }

  return {
    async readIssue(id: string): Promise<LinearIssueSnapshot> {
      const normalised = id.trim();
      if (!normalised) {
        throw new LinearAdapterError(
          "malformed_ticket",
          "readIssue called with an empty identifier.",
        );
      }
      emit({ type: "read_issue_started", issueId: normalised });

      const data = await graphql<{ issue: LinearRawIssue | null }>(
        READ_ISSUE_QUERY,
        { id: normalised },
        normalised,
        "read",
      );

      const raw = data.issue;
      if (!raw) {
        const e = new LinearAdapterError(
          "issue_not_found",
          `Linear has no issue matching ${normalised}. Verify the identifier (LAT-NN) and that the LAT team key is active.`,
        );
        emit({
          type: "read_issue_failed",
          issueId: normalised,
          kind: e.kind,
          status: null,
        });
        throw e;
      }

      const snapshot = buildSnapshotFromRaw(raw);
      emit({
        type: "read_issue_ok",
        issueId: normalised,
        resolvedIdentifier: snapshot.id,
      });
      return snapshot;
    },

    async postComment(issueId: string, body: string) {
      const normalised = issueId.trim();
      if (!normalised) {
        throw new LinearAdapterError(
          "malformed_ticket",
          "postComment called with an empty identifier.",
        );
      }
      if (typeof body !== "string" || body.length === 0) {
        throw new LinearAdapterError(
          "malformed_ticket",
          "postComment called with an empty body; the ADR-0003 write-back must be non-empty.",
        );
      }
      emit({ type: "post_comment_started", issueId: normalised });

      // Resolve identifier → UUID first. Linear's commentCreate requires the
      // issue UUID, not the identifier.
      const lookup = await graphql<{ issue: LinearRawIssue | null }>(
        READ_ISSUE_ID_ONLY_QUERY,
        { id: normalised },
        normalised,
        "read",
      );
      if (!lookup.issue) {
        const e = new LinearAdapterError(
          "issue_not_found",
          `Linear has no issue matching ${normalised}; cannot post the write-back.`,
        );
        emit({
          type: "post_comment_failed",
          issueId: normalised,
          kind: e.kind,
          status: null,
        });
        throw e;
      }

      const created = await graphql<{
        commentCreate: {
          success: boolean;
          comment: { id: string; url: string | null } | null;
        };
      }>(
        POST_COMMENT_MUTATION,
        { issueId: lookup.issue.id, body },
        normalised,
        "write",
      );

      const comment = created.commentCreate?.comment;
      if (!created.commentCreate?.success || !comment) {
        const e = new LinearAdapterError(
          "api_error",
          `Linear refused commentCreate for ${normalised}; no comment was persisted.`,
        );
        emit({
          type: "post_comment_failed",
          issueId: normalised,
          kind: e.kind,
          status: null,
        });
        throw e;
      }

      emit({
        type: "post_comment_ok",
        issueId: normalised,
        commentId: comment.id,
      });
      return {
        url:
          comment.url ??
          `https://linear.app/issue/${lookup.issue.identifier}/comment/${comment.id}`,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* GraphQL queries                                                     */
/* ------------------------------------------------------------------ */

const READ_ISSUE_QUERY = /* GraphQL */ `
  query ReadIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      state {
        name
        type
      }
      project {
        id
        name
      }
      team {
        key
      }
      parent {
        id
        identifier
        state {
          name
          type
        }
      }
      labels(first: 50) {
        nodes {
          name
        }
      }
      comments(first: 50) {
        nodes {
          id
          body
        }
      }
    }
  }
`;

const READ_ISSUE_ID_ONLY_QUERY = /* GraphQL */ `
  query ReadIssueId($id: String!) {
    issue(id: $id) {
      id
      identifier
    }
  }
`;

const POST_COMMENT_MUTATION = /* GraphQL */ `
  mutation PostComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
        url
      }
    }
  }
`;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface LinearRawIssue {
  id: string;
  identifier: string;
  title?: string | null;
  description?: string | null;
  state?: { name?: string | null; type?: string | null } | null;
  project?: { id: string; name: string } | null;
  team?: { key?: string | null } | null;
  parent?: {
    id: string;
    identifier: string;
    state?: { name?: string | null; type?: string | null } | null;
  } | null;
  labels?: { nodes?: ReadonlyArray<{ name?: string | null }> | null } | null;
  comments?: {
    nodes?: ReadonlyArray<{ id: string; body?: string | null }> | null;
  } | null;
}

export function buildSnapshotFromRaw(raw: LinearRawIssue): LinearIssueSnapshot {
  const description = typeof raw.description === "string" ? raw.description : "";
  const parsed = parseDispatchFields(description);

  // Blocker statuses are surfaced opportunistically from the parent issue
  // only: the MVP policy evaluator looks up hard-blocker IDs in
  // `blocker_statuses`. A full multi-issue fetch is deferred to a later
  // slice; until then, an unresolved blocker stays `unknown` and the policy
  // evaluator treats that as blocked.
  const blockerStatuses: Record<string, string> = {};
  if (raw.parent?.identifier) {
    const parentStatus = raw.parent.state?.name ?? "unknown";
    blockerStatuses[raw.parent.identifier] = parentStatus;
  }

  return {
    id: raw.identifier,
    status: raw.state?.name ?? "unknown",
    sequencing: {
      hard_blockers: parsed.hard_blockers,
      recommended_predecessors: parsed.recommended_predecessors,
      dispatch_status: parsed.dispatch_status,
      dispatch_note: parsed.dispatch_note,
    },
    blocker_statuses: blockerStatuses,
    budget_cap_usd: parsed.budget_cap_usd,
  };
}

interface ParsedDispatchFields {
  hard_blockers: ReadonlyArray<string>;
  recommended_predecessors: ReadonlyArray<string>;
  dispatch_status: "ready" | "caution" | "blocked" | "unknown";
  dispatch_note: string;
  budget_cap_usd: number | null;
}

/**
 * ADR-0005 dispatch-readiness parser.
 *
 * Recognises a `## Sequencing` block inside the issue description and
 * extracts hard blockers, recommended predecessors, an explicit dispatch
 * status, and a dispatch note. Budget cap is recognised anywhere in the
 * description. Missing or malformed fields degrade to `unknown` / `null`
 * rather than throwing — the policy evaluator is responsible for turning
 * those into caution/blocked verdicts.
 */
export function parseDispatchFields(description: string): ParsedDispatchFields {
  const lines = description.split(/\r?\n/);
  let inSequencing = false;
  let sequencingText = "";

  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const title = (headingMatch[1] ?? "").trim().toLowerCase();
      inSequencing = title === "sequencing";
      continue;
    }
    if (inSequencing) {
      sequencingText += line + "\n";
    }
  }

  const seqHardBlockers = extractIdList(sequencingText, "hard blockers");
  const seqRecommended = extractIdList(
    sequencingText,
    "recommended predecessors",
  );
  const dispatchStatusRaw = extractLine(sequencingText, "dispatch status") ?? "";
  const dispatchNote = (extractLine(sequencingText, "dispatch note") ?? "").trim();

  let dispatchStatus: ParsedDispatchFields["dispatch_status"];
  const ds = dispatchStatusRaw.trim().toLowerCase();
  if (ds === "ready" || ds === "caution" || ds === "blocked") {
    dispatchStatus = ds;
  } else if (sequencingText.trim().length === 0) {
    dispatchStatus = "unknown";
  } else if (ds.length === 0) {
    dispatchStatus = seqHardBlockers.length > 0 ? "blocked" : "ready";
  } else {
    dispatchStatus = "unknown";
  }

  const budgetCap = extractBudgetCap(description);

  return {
    hard_blockers: seqHardBlockers,
    recommended_predecessors: seqRecommended,
    dispatch_status: dispatchStatus,
    dispatch_note: dispatchNote,
    budget_cap_usd: budgetCap,
  };
}

const ID_PATTERN = /\b[A-Z]{2,6}-\d+\b/g;

function extractIdList(
  block: string,
  fieldName: string,
): ReadonlyArray<string> {
  const line = extractLine(block, fieldName);
  if (!line) return [];
  const ids = line.match(ID_PATTERN) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function extractLine(block: string, fieldName: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)[\\s\\-\\*]*${escapeRegExp(fieldName)}\\s*[:\\-]\\s*(.+?)(?=\\n|$)`,
    "i",
  );
  const match = pattern.exec(block);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

function extractBudgetCap(description: string): number | null {
  // Accepts: "Budget cap: $500", "Budget: 200 USD", "Budget cap (USD): 150.5"
  const pattern =
    /budget(?:\s*cap)?(?:\s*\(usd\))?\s*[:\-]\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i;
  const match = pattern.exec(description);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* Secret-safe error sanitisation                                      */
/* ------------------------------------------------------------------ */

function sanitiseErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

function stripSecret(message: string, apiKey: string): string {
  if (!apiKey) return message;
  let out = message.split(apiKey).join("<redacted>");
  out = out.replace(/lin_api_[A-Za-z0-9_\-]+/g, "<redacted>");
  return out;
}
