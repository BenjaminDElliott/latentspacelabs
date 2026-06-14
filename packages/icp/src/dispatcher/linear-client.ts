/**
 * Linear client used by the LAT-129 polling dispatcher.
 *
 * Distinct from `adapters/linear-adapter.ts` because the dispatcher has
 * different needs:
 *
 * - It reads the *raw* issue body and labels (the existing adapter
 *   parses ADR-0005 sequencing fields the dispatcher doesn't care
 *   about).
 * - It must transition the issue's workflow state, which the existing
 *   adapter never does.
 *
 * Both clients live behind a `FetchLike` seam and never read
 * process.env themselves. The orchestration in `dispatch.ts` is the
 * sole reader of LINEAR_API_KEY.
 */

import type {
  FetchLike,
  FetchLikeResponse,
} from "../adapters/linear-adapter.js";
import type { DispatcherLinearClient, DispatchIssue } from "./types.js";

/** Parameters for creating a run-record sub-issue. */
export interface RunRecordIssue {
  /** Title of the run-record sub-issue. */
  title: string;
  /** Markdown description carrying the full run evidence. */
  description: string;
  /** Parent issue identifier (e.g. "LAT-126"). */
  parentId: string;
}

const DEFAULT_ENDPOINT = "https://api.linear.app/graphql";

export interface DispatcherLinearClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  endpoint?: string;
}

export class DispatcherLinearError extends Error {
  readonly kind:
    | "missing_credentials"
    | "issue_not_found"
    | "unauthorized"
    | "rate_limited"
    | "api_error"
    | "network_error";
  readonly status: number | null;
  constructor(
    kind: DispatcherLinearError["kind"],
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "DispatcherLinearError";
    this.kind = kind;
    this.status = status;
  }
}

export function createDispatcherLinearClient(
  opts: DispatcherLinearClientOptions,
): DispatcherLinearClient {
  if (typeof opts.apiKey !== "string" || opts.apiKey.length === 0) {
    throw new DispatcherLinearError(
      "missing_credentials",
      "Linear API key was not provided. Load LINEAR_API_KEY at the dispatcher boundary; do not read process.env from a client module.",
    );
  }
  const apiKey = opts.apiKey;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch: FetchLike =
    opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== "function") {
    throw new DispatcherLinearError(
      "network_error",
      "No fetch implementation available. Run on Node 20+ or inject a fetch.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: apiKey,
  };

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let res: FetchLikeResponse;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new DispatcherLinearError(
        "network_error",
        `Linear request failed: ${stripSecret(asMessage(err), apiKey)}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new DispatcherLinearError(
        "unauthorized",
        `Linear rejected the credential (HTTP ${res.status}). Rotate LINEAR_API_KEY and confirm scope.`,
        res.status,
      );
    }
    if (res.status === 429) {
      throw new DispatcherLinearError(
        "rate_limited",
        "Linear rate-limited the dispatcher (HTTP 429); abort cleanly and retry later.",
        429,
      );
    }
    if (!res.ok) {
      throw new DispatcherLinearError(
        "api_error",
        `Linear returned HTTP ${res.status}.`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new DispatcherLinearError(
        "api_error",
        `Linear returned unparseable JSON: ${stripSecret(asMessage(err), apiKey)}`,
      );
    }
    const obj = body as {
      data?: T;
      errors?: ReadonlyArray<{ message?: string }>;
    };
    if (obj.errors && obj.errors.length > 0) {
      const messages = obj.errors
        .map((e) => stripSecret(typeof e.message === "string" ? e.message : "GraphQL error", apiKey))
        .join("; ");
      throw new DispatcherLinearError("api_error", `Linear GraphQL errors: ${messages}`);
    }
    if (!obj.data) {
      throw new DispatcherLinearError("api_error", "Linear GraphQL response had no data field.");
    }
    return obj.data;
  }

  return {
    async readIssue(identifier: string): Promise<DispatchIssue> {
      const id = identifier.trim();
      if (id.length === 0) {
        throw new DispatcherLinearError("issue_not_found", "readIssue called with empty identifier.");
      }
      const data = await gql<{ issue: RawIssue | null }>(READ_ISSUE_QUERY, { id });
      if (!data.issue) {
        throw new DispatcherLinearError(
          "issue_not_found",
          `Linear has no issue matching ${id}.`,
        );
      }
      return mapIssue(data.issue);
    },

    async postComment(uuid: string, body: string): Promise<{ url: string }> {
      const data = await gql<{
        commentCreate: {
          success: boolean;
          comment: { id: string; url: string | null } | null;
        };
      }>(POST_COMMENT_MUTATION, { issueId: uuid, body });
      if (!data.commentCreate?.success || !data.commentCreate.comment) {
        throw new DispatcherLinearError(
          "api_error",
          `Linear refused commentCreate for ${uuid}.`,
        );
      }
      const c = data.commentCreate.comment;
      return { url: c.url ?? `https://linear.app/issue/${uuid}/comment/${c.id}` };
    },

    async setIssueState(uuid: string, stateId: string): Promise<void> {
      const data = await gql<{ issueUpdate: { success: boolean } }>(
        ISSUE_UPDATE_STATE_MUTATION,
        { id: uuid, stateId },
      );
      if (!data.issueUpdate?.success) {
        throw new DispatcherLinearError(
          "api_error",
          `Linear refused issueUpdate for ${uuid}.`,
        );
      }
    },

    async createRunRecord(issue: RunRecordIssue): Promise<{ id: string; url: string }> {
      // Resolve parent identifier → UUID first.
      const parentData = await gql<{ issue: RawIssue | null }>(
        READ_ISSUE_ID_ONLY_QUERY,
        { id: issue.parentId },
      );
      if (!parentData.issue) {
        throw new DispatcherLinearError(
          "issue_not_found",
          `Parent issue ${issue.parentId} not found; cannot create run-record sub-issue.`,
        );
      }

      const data = await gql<{
        issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string | null } | null };
      }>(CREATE_RUN_RECORD_MUTATION, {
        teamId: parentData.issue.id, // inherit team from parent
        parentId: parentData.issue.id,
        title: issue.title,
        description: issue.description,
        stateId: null, // will use team default
      });

      if (!data.issueCreate?.success || !data.issueCreate.issue) {
        throw new DispatcherLinearError(
          "api_error",
          `Linear refused issueCreate for run-record of ${issue.parentId}.`,
        );
      }

      const created = data.issueCreate.issue;
      return {
        id: created.id,
        url: created.url ?? `https://linear.app/issue/${created.identifier}`,
      };
    },
  };
}

interface RawIssue {
  id: string;
  identifier: string;
  title?: string | null;
  description?: string | null;
  state?: { id?: string | null; name?: string | null } | null;
  labels?: { nodes?: ReadonlyArray<{ name?: string | null }> | null } | null;
}

function mapIssue(raw: RawIssue): DispatchIssue {
  const labels = (raw.labels?.nodes ?? [])
    .map((n) => (typeof n.name === "string" ? n.name.toLowerCase() : ""))
    .filter((s) => s.length > 0);
  return {
    identifier: raw.identifier,
    uuid: raw.id,
    title: raw.title ?? "",
    description: raw.description ?? "",
    stateName: raw.state?.name ?? "unknown",
    stateId: raw.state?.id ?? "",
    labels,
  };
}

const READ_ISSUE_QUERY = /* GraphQL */ `
  query DispatcherReadIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      state {
        id
        name
      }
      labels(first: 50) {
        nodes {
          name
        }
      }
    }
  }
`;

const POST_COMMENT_MUTATION = /* GraphQL */ `
  mutation DispatcherPostComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
        url
      }
    }
  }
`;

const ISSUE_UPDATE_STATE_MUTATION = /* GraphQL */ `
  mutation DispatcherSetState($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
    }
  }
`;

/**
 * Lightweight query just to resolve an identifier → UUID for the parent
 * issue when creating a run-record sub-issue.
 */
const READ_ISSUE_ID_ONLY_QUERY = /* GraphQL */ `
  query DispatcherReadIssueId($id: String!) {
    issue(id: $id) {
      id
      identifier
    }
  }
`;

/**
 * Create a run-record sub-issue under the parent. Uses the parent's team
 * so the sub-issue lands in the same workspace view. The description
 * carries the full structured evidence.
 */
const CREATE_RUN_RECORD_MUTATION = /* GraphQL */ `
  mutation DispatcherCreateRunRecord(
    $title: String!
    $description: String!
    $teamId: String!
    $parentId: String!
  ) {
    issueCreate(
      input: {
        title: $title
        description: $description
        teamId: $teamId
        parentId: $parentId
      }
    ) {
      success
      issue {
        id
        identifier
        url
      }
    }
  }
`;

function asMessage(err: unknown): string {
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
