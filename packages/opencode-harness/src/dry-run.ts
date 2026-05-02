/**
 * Dry-run engine.
 *
 * Given a ticket pack path, the dry-run engine:
 *
 * 1. Reads the pack from disk.
 * 2. Validates it against the LAT-104 contract.
 * 3. Decides whether the runtime would *start* a real opencode + Qwen run,
 *    or refuse it as `blocked` / `needs_clarification` / `too_large`.
 * 4. Emits a structured run summary.
 *
 * What this engine deliberately does NOT do:
 *
 * - It does not invoke opencode.
 * - It does not contact the local Qwen endpoint.
 * - It does not require an endpoint URL, token, or any configuration that
 *   would surface secret material.
 * - It does not create a branch, edit any file, or open a PR.
 * - It does not write back to Linear.
 *
 * The point is to fail before a real run — per ADR-0019 *Confirmation*:
 * "LAT-105 lands a dry-run harness that exercises a ticket pack against
 * opencode + Qwen without opening a PR (no GitHub side-effects, no Linear
 * write-back) and produces the same evidence artifact a real run would,
 * redacted." The evidence here is the dry-run summary.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  BranchPlan,
  CheckPlanItem,
  DryRunSummary,
  HarnessStatus,
  RefusalReason,
  SizeLimits,
  TicketPack,
  ValidationFinding,
} from "./types.js";
import { DEFAULT_SIZE_LIMITS } from "./types.js";
import { validateTicketPack } from "./validate.js";

export interface DryRunOptions {
  sizeLimits?: SizeLimits;
  /**
   * Optional override for the timestamp embedded in the summary. Tests pass a
   * frozen value so snapshots are stable; production callers leave this unset
   * to use the real wall clock.
   */
  now?: () => Date;
}

export interface DryRunResult {
  summary: DryRunSummary;
  findings: ValidationFinding[];
  pack: TicketPack | null;
}

function buildBranchPlan(pack: TicketPack): BranchPlan {
  const example = pack.branchRules.prTitlePrefix.length > 0
    ? `${pack.branchRules.prTitlePrefix} <one-line description>`
    : `${pack.header.linearId}: <one-line description>`;
  return {
    branch: pack.branchRules.branch,
    prTitlePrefix: pack.branchRules.prTitlePrefix.length > 0
      ? pack.branchRules.prTitlePrefix
      : `${pack.header.linearId}:`,
    prBase: pack.branchRules.prBase.length > 0 ? pack.branchRules.prBase : "main",
    prTitleExample: example,
  };
}

/**
 * Recognise an `Expected checks` bullet that names a forbidden-path
 * guardrail (e.g. "No edits under forbidden paths.", "Do not modify
 * `.github/workflows/**`."). These are policy validations, not shell
 * commands; LAT-135 separates them so the runtime stops trying to
 * execute the bullet text as shell.
 */
function isForbiddenPathBullet(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  return (
    lower.includes("forbidden path") ||
    lower.includes("forbidden paths") ||
    (lower.includes("no edits") && (lower.includes("forbidden") || lower.includes("path")))
  );
}

/**
 * Extract the literal shell command from a bullet, if the bullet looks
 * like a shell instruction. We accept either the LAT-104 canonical form
 * `` `<cmd>` passes. `` (a code-spanned command followed by a verb) or
 * a plain backticked command that begins with one of a small allowlist
 * of binaries (`npm`, `npx`, `node`, `pnpm`, `yarn`, `bun`, `tsc`,
 * `tsx`, `vitest`, `jest`). Anything else is treated as policy/manual
 * to stay safely on the side of "do not exec random English".
 */
function extractShellCommand(value: string): string | null {
  // Prefer the LAT-104 canonical form: a single backtick-wrapped command,
  // optionally followed by an English verb (e.g. "passes", "is green").
  const codeSpanMatch = /`([^`]+)`/.exec(value);
  if (codeSpanMatch && codeSpanMatch[1] !== undefined) {
    const cmd = codeSpanMatch[1].trim();
    if (looksLikeShellCommand(cmd)) return cmd;
  }
  // Fallback: a bare command line with no code span. Only accept it if
  // the WHOLE bullet looks like a shell command — never accept a bullet
  // that begins with a known binary but trails into English (e.g.
  // "npm test is green." would otherwise pass `looksLikeShellCommand`).
  if (looksLikeShellCommand(value) && !/[.!?]\s|\s(?:passes|fails|is|should)\b/i.test(value)) {
    return value;
  }
  return null;
}

const SHELL_COMMAND_HEADS = [
  "npm",
  "npx",
  "node",
  "pnpm",
  "yarn",
  "bun",
  "tsc",
  "tsx",
  "vitest",
  "jest",
  "make",
  "bash",
  "sh",
];

function looksLikeShellCommand(value: string): boolean {
  const head = value.trim().split(/\s+/, 1)[0];
  if (head === undefined || head.length === 0) return false;
  return SHELL_COMMAND_HEADS.includes(head);
}

function buildCheckPlan(pack: TicketPack): CheckPlanItem[] {
  const out: CheckPlanItem[] = [];
  let sawRepoGate = false;
  let sawForbiddenPathPolicy = false;
  for (const text of pack.expectedChecks) {
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;

    if (isForbiddenPathBullet(trimmed)) {
      sawForbiddenPathPolicy = true;
      out.push({
        name: "Forbidden-path guardrail",
        command: trimmed.replace(/`/g, ""),
        source: "ticket-pack",
        kind: "policy",
        policyId: "forbidden_paths",
      });
      continue;
    }

    const shell = extractShellCommand(trimmed);
    if (shell !== null) {
      const isRepoGate = shell.toLowerCase().includes("npm run check");
      if (isRepoGate) sawRepoGate = true;
      out.push({
        name: isRepoGate ? "Repo gate" : (shell.length > 80 ? shell.slice(0, 77) + "..." : shell),
        command: isRepoGate ? "npm run check" : shell,
        source: "ticket-pack",
        kind: "shell",
      });
      continue;
    }

    // Bullet doesn't name a known shell command and isn't a recognised
    // policy guardrail — preserve it for human review but never exec it.
    const display = trimmed.replace(/`/g, "");
    out.push({
      name: display.length > 80 ? display.slice(0, 77) + "..." : display,
      command: display,
      source: "ticket-pack",
      kind: "manual",
    });
  }
  if (!sawRepoGate) {
    out.unshift({
      name: "Repo gate",
      command: "npm run check",
      source: "repo-gate",
      kind: "shell",
    });
  }
  if (pack.filesForbidden.length > 0 && !sawForbiddenPathPolicy) {
    out.push({
      name: "Forbidden-path guardrail",
      command: "No edits under forbidden paths declared in the pack.",
      source: "repo-gate",
      kind: "policy",
      policyId: "forbidden_paths",
    });
  }
  return out;
}

function decideSizeRefusal(
  pack: TicketPack,
  limits: SizeLimits,
): RefusalReason | null {
  if (pack.filesInScope.length > limits.maxFilesInScope) {
    return {
      code: "too_many_files_in_scope",
      message:
        `Files in scope (${pack.filesInScope.length}) exceeds the small-model surface limit (${limits.maxFilesInScope}). ` +
        "Decompose further or fall back to ADR-0018's runtime per ADR-0019.",
    };
  }
  if (pack.acceptanceCriteria.length > limits.maxAcceptanceCriteria) {
    return {
      code: "too_many_acceptance_criteria",
      message:
        `Acceptance criteria count (${pack.acceptanceCriteria.length}) exceeds the limit (${limits.maxAcceptanceCriteria}). ` +
        "Split the ticket.",
    };
  }
  if (Buffer.byteLength(pack.raw, "utf8") > limits.maxRawBytes) {
    return {
      code: "pack_too_large",
      message:
        `Pack size (${Buffer.byteLength(pack.raw, "utf8")} bytes) exceeds the limit (${limits.maxRawBytes} bytes). ` +
        "The pack itself is too long for the small-model surface.",
    };
  }
  return null;
}

function findingsToRefusals(findings: ValidationFinding[]): RefusalReason[] {
  return findings
    .filter((f) => f.severity === "error")
    .map((f) => ({ code: f.code, message: f.message }));
}

function decideStatus(args: {
  validationOk: boolean;
  packReadiness: TicketPack["header"]["readinessStatus"] | null;
  sizeRefusal: RefusalReason | null;
}): HarnessStatus {
  if (!args.validationOk) return "needs_clarification";
  if (args.sizeRefusal !== null) return "too_large";
  switch (args.packReadiness) {
    case "ready":
      return "ready";
    case "blocked":
      return "blocked";
    case "needs_clarification":
      return "needs_clarification";
    case "too_large":
      return "too_large";
    default:
      return "needs_clarification";
  }
}

export async function dryRun(
  packPath: string,
  options: DryRunOptions = {},
): Promise<DryRunResult> {
  const limits = options.sizeLimits ?? DEFAULT_SIZE_LIMITS;
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const absolutePath = resolve(packPath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const summary: DryRunSummary = {
      schemaVersion: "1.0.0",
      ticket: "unknown",
      packPath: absolutePath,
      status: "harness_error",
      generatedAt,
      packReadinessStatus: "unknown",
      costBand: "unknown",
      riskLevel: "unknown",
      filesInScope: [],
      filesForbidden: [],
      acceptanceCriteria: [],
      branchPlan: null,
      checkPlan: [],
      refusals: [
        {
          code: "pack_unreadable",
          message: `cannot read ticket pack at ${absolutePath}: ${message}`,
        },
      ],
      notes: [],
      endpointInvoked: false,
      prOpened: false,
      linearWriteBack: false,
    };
    return { summary, findings: [], pack: null };
  }

  const validation = validateTicketPack(raw, absolutePath);
  const findings = validation.findings;
  const pack = validation.pack ?? null;

  if (pack === null) {
    const summary: DryRunSummary = {
      schemaVersion: "1.0.0",
      ticket: "unknown",
      packPath: absolutePath,
      status: "needs_clarification",
      generatedAt,
      packReadinessStatus: "unknown",
      costBand: "unknown",
      riskLevel: "unknown",
      filesInScope: [],
      filesForbidden: [],
      acceptanceCriteria: [],
      branchPlan: null,
      checkPlan: [],
      refusals: findingsToRefusals(findings),
      notes: ["pack could not be parsed; see refusals for the missing fields"],
      endpointInvoked: false,
      prOpened: false,
      linearWriteBack: false,
    };
    return { summary, findings, pack: null };
  }

  const refusals = findingsToRefusals(findings);
  const validationOk = refusals.length === 0;
  const sizeRefusal = validationOk ? decideSizeRefusal(pack, limits) : null;
  const allRefusals: RefusalReason[] = [...refusals];
  if (sizeRefusal !== null) allRefusals.push(sizeRefusal);

  const status = decideStatus({
    validationOk,
    packReadiness: pack.header.readinessStatus,
    sizeRefusal,
  });

  const notes: string[] = [];
  for (const w of findings.filter((f) => f.severity === "warning")) {
    notes.push(`warning: ${w.message}`);
  }
  if (status === "ready") {
    notes.push(
      "dry-run only: no opencode run was started, no endpoint contacted, no branch created, no PR opened, no Linear write-back.",
    );
  }

  const summary: DryRunSummary = {
    schemaVersion: "1.0.0",
    ticket: pack.header.linearId,
    packPath: absolutePath,
    status,
    generatedAt,
    packReadinessStatus: pack.header.readinessStatus,
    costBand: pack.header.costBand,
    riskLevel: pack.header.riskLevel,
    filesInScope: pack.filesInScope,
    filesForbidden: pack.filesForbidden,
    acceptanceCriteria: pack.acceptanceCriteria,
    branchPlan: buildBranchPlan(pack),
    checkPlan: buildCheckPlan(pack),
    refusals: allRefusals,
    notes,
    endpointInvoked: false,
    prOpened: false,
    linearWriteBack: false,
  };

  return { summary, findings, pack };
}
