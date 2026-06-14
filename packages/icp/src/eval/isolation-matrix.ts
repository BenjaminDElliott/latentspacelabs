/**
 * Isolation matrix types for the ICP dispatcher and policy evaluator.
 *
 * Defines the per-agent-type isolation boundaries (secrets, filesystem, network)
 * consumed by the dispatcher (credential injection, worktree layout, env scrub),
 * the policy evaluator (pre-run checks), and the runtime (post-run evidence
 * validation).
 *
 * Related Linear: LAT-179.
 * Related process doc: docs/process/agent-isolation-matrix.md.
 */

import type { AgentType } from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Filesystem access modes                                            */
/* ------------------------------------------------------------------ */

/** What an agent can do to a filesystem path. */
export type FsAccessMode = "read" | "write" | "read-write";

/**
 * A filesystem scope that an agent type may access.
 * - `root` means the entire worktree repo.
 * - `path` is a repo-relative glob or exact path (e.g. `test-results/`, `docs/`).
 */
export interface FsScope {
  /** The access mode for this scope. */
  mode: FsAccessMode;
  /** Path pattern. `"root"` means the entire worktree. */
  path: string;
  /**
   * Optional description of what files this scope covers.
   * Used for documentation and error messages.
   */
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Network access modes                                               */
/* ------------------------------------------------------------------ */

/** Direction of a network connection. */
export type NetworkDirection = "read" | "write" | "read-write" | "full";

/** A declared network target an agent can reach. */
export interface NetworkTarget {
  /** Hostname or host pattern (e.g. `api.github.com`, `*.runpod.ai`). */
  host: string;
  /**
   * Access direction. `"full"` means bidirectional read+write on all ports.
   */
  direction: NetworkDirection;
  /** Optional port range (e.g. `"443"`, `"8000-8010"`). Defaults to `443` when omitted. */
  port?: string;
  /** Description of what this target is for. */
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Secret injection                                                    */
/* ------------------------------------------------------------------ */

/** A secret class that may be injected into an agent's environment. */
export interface SecretInjection {
  /** Secret class key, e.g. `"S1"` (Linear), `"S2"` (GitHub), `"S4"` (model providers). */
  class: string;
  /** How the secret is injected: env var, file path, or header. */
  injectionMethod: "env" | "file" | "header";
  /** The env var name or file path used for injection. */
  reference: string;
  /** Optional scope description (e.g. "contents:read/write on single repo"). */
  scope?: string;
}

/* ------------------------------------------------------------------ */
/* Isolation boundary for one agent type                               */
/* ------------------------------------------------------------------ */

/**
 * The complete isolation boundary for a single agent type.
 *
 * This type is consumed by:
 * - The dispatcher (credential injection, worktree setup, env scrub)
 * - The policy evaluator (pre-run checks against declared boundaries)
 * - The runtime (post-run evidence validation)
 */
export interface IsolationBoundary {
  /** Agent type this boundary applies to (matches `AgentType`). */
  agentType: AgentType;
  /** Secret injections this agent receives at runtime. */
  secrets: ReadonlyArray<SecretInjection>;
  /** Filesystem scopes the agent may access. */
  filesystem: ReadonlyArray<FsScope>;
  /** Network targets the agent may reach. Empty array means no network. */
  network: ReadonlyArray<NetworkTarget>;
  /**
   * Autonomy level this agent operates at (per ADR-0008).
   * This is informational here; the actual autonomy level is in the skill
   * definition and run report.
   */
  autonomyLevel: string;
  /**
   * Whether this agent can modify a source branch.
   * `false` for read-only agents (qa, review, pm, research, observability).
   * `true` for coding and sre (branch write or deploy status write).
   */
  canModifyBranch: boolean;
  /**
   * Whether this agent can write to the Linear issue (comment or state).
   */
  canWriteLinear: boolean;
  /**
   * Whether this agent can trigger deployments.
   */
  canDeploy: boolean;
  /**
   * Human-readable summary of what this agent can do.
   * Used for error messages and run-report narratives.
   */
  summary: string;
}

/* ------------------------------------------------------------------ */
/* The complete matrix                                                 */
/* ------------------------------------------------------------------ */

/**
 * The full isolation matrix: one boundary per agent type.
 *
 * This is the single source of truth. The dispatcher, policy evaluator,
 * and runtime all derive from this object. If a boundary differs between
 * code and the process doc, the code wins (it is the executable form).
 */
export const ISOLATION_MATRIX: ReadonlyMap<AgentType, IsolationBoundary> =
  new Map([
    [
      "coding",
      {
        agentType: "coding",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read + write issues, comments, relations, labels, states in the LAT team only",
          },
          {
            class: "S2",
            injectionMethod: "env",
            reference: "GITHUB_TOKEN",
            scope:
              "contents:read/write, pull-requests:read/write, issues:read/write on BenjaminDElliott/latentspacelabs",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree" },
          {
            mode: "read",
            path: ".env",
            description: "Local dotenv (git-ignored)",
          },
          {
            mode: "write",
            path: "files-in-scope",
            description:
              "Paths declared in ticket-pack files-in-scope allowlist on agent worktree branch only",
          },
        ],
        network: [
          { host: "api.github.com", direction: "read-write", port: "443", description: "PR creation, branch push, issue comments" },
          { host: "api.linear.app", direction: "read-write", port: "443", description: "Ticket read/write, comment post" },
          { host: "perplexity.mcp", direction: "read-write", port: "443", description: "MCP bridge inference" },
        ],
        autonomyLevel: "L2–L3",
        canModifyBranch: true,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Read repo, write branch, no network outside CI (GitHub, Linear, MCP bridge only)",
      },
    ],
    [
      "qa",
      {
        agentType: "qa",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read issues/comments/labels; write comments only — no state transitions",
          },
          {
            class: "S5",
            injectionMethod: "env",
            reference: "QA_DEPLOY_URL",
            scope: "Deploy URL for smoke tests and UI interaction",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for test scripts and configs" },
          { mode: "read", path: "runs/", description: "Run artifacts" },
          { mode: "read", path: "test-results/", description: "Test results and coverage output" },
          {
            mode: "write",
            path: "test-results/",
            description: "Test results, coverage reports, evidence files",
          },
        ],
        network: [
          { host: "${QA_DEPLOY_URL}", direction: "read", port: "443", description: "Health check, smoke test, UI interaction" },
          { host: "api.linear.app", direction: "read-write", port: "443", description: "Comment post" },
        ],
        autonomyLevel: "L1",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Read deploy URL, read test results, no write (writes test results and Linear comments only)",
      },
    ],
    [
      "review",
      {
        agentType: "review",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read issues/comments/labels, write comments",
          },
          {
            class: "S2",
            injectionMethod: "env",
            reference: "GITHUB_TOKEN",
            scope: "contents:read, pull-requests:read on BenjaminDElliott/latentspacelabs (read-only)",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for diffs, ticket pack, ADRs/PRDs" },
          {
            mode: "write",
            path: "pr-review-report.md",
            description: "PR review report output",
          },
        ],
        network: [
          { host: "api.github.com", direction: "read", port: "443", description: "PR diff read, comment post" },
          { host: "api.linear.app", direction: "read-write", port: "443", description: "Comment post, issue read" },
        ],
        autonomyLevel: "L1",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Read PR, write comment, no branch modification",
      },
    ],
    [
      "sre",
      {
        agentType: "sre",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read issues, write comments",
          },
          {
            class: "S2",
            injectionMethod: "env",
            reference: "GITHUB_TOKEN",
            scope: "Read-only access to BenjaminDElliott/latentspacelabs",
          },
          {
            class: "S5",
            injectionMethod: "env",
            reference: "SRE_CLOUD_TOKEN",
            scope: "Infra config and deploy status for target infrastructure",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for infra configs, manifests" },
          { mode: "read", path: "infra-config/", description: "Cloud provider config (injected, not committed)" },
          {
            mode: "write",
            path: "infra-status/",
            description: "Deploy status and infrastructure state artifacts",
          },
        ],
        network: [
          { host: "cloud-provider-api", direction: "read-write", port: "443", description: "Cloud provider APIs" },
          { host: "deploy-pipeline", direction: "read-write", port: "443", description: "Deployment pipelines" },
          { host: "monitoring", direction: "read-write", port: "443", description: "Monitoring and alerting endpoints" },
          { host: "database", direction: "read-write", port: "5432", description: "Database endpoints" },
        ],
        autonomyLevel: "L2–L3",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: true,
        summary:
          "Read infra config, write deploy status, full network to targets",
      },
    ],
    [
      "pm",
      {
        agentType: "pm",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read + write issues, comments, labels, states in the LAT team",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for PRDs, ADRs, ticket packs" },
          {
            mode: "write",
            path: "pm/",
            description: "PM artifacts",
          },
        ],
        network: [
          { host: "api.linear.app", direction: "read-write", port: "443", description: "Linear API" },
        ],
        autonomyLevel: "L1",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Read PRDs/ADRs, manage backlogs, write summaries. Linear-only network.",
      },
    ],
    [
      "research",
      {
        agentType: "research",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read issues, write comments",
          },
          {
            class: "S4",
            injectionMethod: "env",
            reference: "PERPLEXITY_AUTH_TOKEN",
            scope: "Perplexity MCP bridge inference",
          },
          {
            class: "S4",
            injectionMethod: "env",
            reference: "ANTHROPIC_API_KEY",
            scope: "Anthropic model provider (if needed for research)",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for context" },
          {
            mode: "write",
            path: "research/",
            description: "Research reports and findings",
          },
        ],
        network: [
          { host: "perplexity.mcp", direction: "read-write", port: "443", description: "Perplexity inference" },
          { host: "api.anthropic.com", direction: "read-write", port: "443", description: "Anthropic model provider" },
          { host: "*", direction: "read", port: "443", description: "External URLs fetched for research" },
        ],
        autonomyLevel: "L1",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Fetch external information, analyse options, write reports. Model providers and external URLs.",
      },
    ],
    [
      "observability",
      {
        agentType: "observability",
        secrets: [
          {
            class: "S1",
            injectionMethod: "env",
            reference: "LINEAR_API_KEY",
            scope: "Read issues, write comments",
          },
          {
            class: "S5",
            injectionMethod: "env",
            reference: "OBS_TELEMETRY_TOKEN",
            scope: "Telemetry backend access",
          },
        ],
        filesystem: [
          { mode: "read", path: "root", description: "Entire repo worktree for context" },
          { mode: "read", path: "runs/", description: "Run artifacts, logs, metrics data" },
          {
            mode: "write",
            path: "observability/",
            description: "Observability reports and metrics summaries",
          },
        ],
        network: [
          { host: "telemetry-backend", direction: "read-write", port: "443", description: "Telemetry backend APIs" },
          { host: "api.linear.app", direction: "read-write", port: "443", description: "Linear API" },
        ],
        autonomyLevel: "L1",
        canModifyBranch: false,
        canWriteLinear: true,
        canDeploy: false,
        summary:
          "Read run metrics, produce summaries. Telemetry backend and Linear only.",
      },
    ],
  ]);

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Get the isolation boundary for an agent type.
 * @throws Error if the agent type is not found in the matrix.
 */
export function getBoundary(type: AgentType): IsolationBoundary {
  const boundary = ISOLATION_MATRIX.get(type);
  if (!boundary) {
    throw new Error(
      `Agent type "${type}" is not defined in the isolation matrix. ` +
        `Known types: ${[...ISOLATION_MATRIX.keys()].join(", ")}`,
    );
  }
  return boundary;
}

/**
 * Check whether an agent type is allowed to write to a given filesystem path.
 * @returns true if any filesystem scope matches the path with write or read-write mode.
 */
export function canWrite(boundary: IsolationBoundary, path: string): boolean {
  return boundary.filesystem.some(
    (scope) =>
      (scope.mode === "write" || scope.mode === "read-write") &&
      matchesPath(scope.path, path),
  );
}

/**
 * Check whether an agent type is allowed to read a given filesystem path.
 */
export function canRead(boundary: IsolationBoundary, path: string): boolean {
  return boundary.filesystem.some(
    (scope) =>
      (scope.mode === "read" || scope.mode === "read-write") &&
      matchesPath(scope.path, path),
  );
}

/**
 * Check whether an agent type has network access to a given host.
 */
export function hasNetworkAccess(
  boundary: IsolationBoundary,
  host: string,
): boolean {
  return boundary.network.some((target) => hostMatches(target.host, host));
}

/**
 * Simple glob matching for filesystem paths.
 * - "root" matches any path.
 * - "files-in-scope" matches any path (resolved by the ticket pack).
 * - Exact paths match exactly.
 * - Glob patterns with `*` are matched literally for MVP simplicity.
 */
function matchesPath(pattern: string, path: string): boolean {
  if (pattern === "root" || pattern === "files-in-scope") return true;
  // Strip trailing slash for consistent matching.
  const cleaned = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  if (cleaned.endsWith("*")) {
    return path.startsWith(cleaned.slice(0, -1));
  }
  return path === cleaned || path.startsWith(cleaned + "/");
}

/**
 * Match a host against a pattern.
 * - "*" matches any host.
 * - "*.domain" matches any subdomain of "domain".
 * - Exact host match.
 */
function hostMatches(pattern: string, host: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host === suffix.slice(1) || host.endsWith(suffix);
  }
  return pattern === host;
}
