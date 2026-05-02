/**
 * Ticket-pack generator for the LAT-129 dispatcher.
 *
 * Reads a Linear issue snapshot and produces a bounded markdown ticket
 * pack the existing control-loop CLI accepts. The pack is intentionally
 * minimal: just enough header / goal / acceptance / branch metadata for
 * the control loop's pre-flight harness to judge readiness.
 *
 * The generator is pure — it does not write files. The caller (the
 * dispatcher orchestration) writes the result to a temp directory that
 * is git-ignored, never to the repo tree.
 */

import type { DispatchIssue } from "./types.js";

export interface BuildPackInput {
  issue: DispatchIssue;
  /** Maximum description characters surfaced into the pack body. */
  maxDescriptionChars?: number;
}

export interface BuildPackResult {
  /** Markdown body of the ticket pack. */
  content: string;
  /** Suggested filename, e.g. `lat-126.pack.md`. */
  filename: string;
  /** Branch name we recommend the agent use. */
  branch: string;
  /** PR title prefix, e.g. `LAT-126:`. */
  prTitlePrefix: string;
}

const DEFAULT_MAX_DESCRIPTION_CHARS = 8000;

export function buildTicketPack(input: BuildPackInput): BuildPackResult {
  const maxChars =
    typeof input.maxDescriptionChars === "number" && input.maxDescriptionChars > 0
      ? input.maxDescriptionChars
      : DEFAULT_MAX_DESCRIPTION_CHARS;

  const issue = input.issue;
  const identifier = issue.identifier;
  const issueNumber = parseIssueNumber(identifier);
  const slug = slugify(issue.title) || `lat-${issueNumber}-task`;
  const branch = `lat-${issueNumber}-${slug}`.slice(0, 80);
  const prTitlePrefix = `${identifier}:`;

  const description = (issue.description ?? "").trim();
  const truncated =
    description.length > maxChars
      ? description.slice(0, maxChars) + "\n\n_[truncated by dispatcher]_"
      : description;

  const lines: string[] = [];
  lines.push(`# opencode Ticket Pack: ${issue.title}`);
  lines.push("");
  lines.push("## Header");
  lines.push("");
  lines.push(`- **Linear ID:** ${identifier}`);
  lines.push(`- **Pack version:** 1`);
  lines.push(`- **Source:** LAT-129 polling dispatcher (auto-generated)`);
  lines.push(`- **Cost band:** low`);
  lines.push(`- **Risk level:** low`);
  lines.push(`- **Readiness status:** ready`);
  lines.push("");
  lines.push("## Goal");
  lines.push("");
  lines.push(
    `Implement the work described in Linear issue ${identifier}. The dispatcher selected this issue under explicit operator override (LAT-129 MVP).`,
  );
  lines.push("");
  lines.push("## Linear context");
  lines.push("");
  lines.push("```");
  lines.push(truncated.length > 0 ? truncated : "(no description provided)");
  lines.push("```");
  lines.push("");
  lines.push("## Acceptance criteria");
  lines.push("");
  lines.push(
    "- [ ] All acceptance criteria from the Linear issue body are satisfied.",
  );
  lines.push(
    "- [ ] No files outside the issue's stated scope are modified without explicit justification.",
  );
  lines.push("");
  lines.push("## Constraints");
  lines.push("");
  lines.push(
    "- **Files in scope (allowlist):** as defined by the Linear issue body.",
  );
  lines.push(
    "- **Files / paths forbidden:** `.github/workflows/**`, `docs/decisions/**`, `docs/prds/**`.",
  );
  lines.push("- **Dependency policy:** no new runtime deps without justification.");
  lines.push("- **API / surface preservation:** no breaking public API changes.");
  lines.push("- **Cost / budget cap:** low cost band; halt on runaway risk.");
  lines.push("");
  lines.push("## Expected checks");
  lines.push("");
  // Executable shell checks only. Policy guardrails (e.g. forbidden-path
  // restrictions) are declared in `Constraints` and surfaced by the
  // LAT-105 harness as `kind: "policy"` items in the check plan; they
  // are NOT executed as shell. See LAT-135 for the contract split.
  lines.push("- [ ] `npm run check` passes.");
  lines.push("");
  lines.push("## Policy guardrails");
  lines.push("");
  lines.push(
    "- [ ] No edits under forbidden paths. _(policy — verified against the diff, not executed as shell.)_",
  );
  lines.push("");
  lines.push("## Branch / PR rules");
  lines.push("");
  lines.push(`- **Branch:** \`${branch}\``);
  lines.push(`- **PR title prefix:** \`${prTitlePrefix}\``);
  lines.push("- **PR base:** `main`");
  lines.push("- One PR. No batching. No auto-merge.");
  lines.push("");
  lines.push("## Forbidden actions");
  lines.push("");
  lines.push(
    "- No deploys, merges, secret rotation, broad architecture changes, or supply-chain edits.",
  );
  lines.push(
    "- No changes outside the explicit issue scope; if the agent finds it must, it should refuse and surface a needs_human signal.",
  );
  lines.push("");
  lines.push("## Evidence expectations");
  lines.push("");
  lines.push(
    "- PR link, files changed, checks pass/fail, acceptance criteria status, redacted run artifact, final status `ready_for_review`.",
  );
  lines.push("");
  lines.push("## Final status");
  lines.push("");
  lines.push("ready");

  const content = lines.join("\n") + "\n";
  const filename = `${identifier.toLowerCase()}.pack.md`;

  return { content, filename, branch, prTitlePrefix };
}

function parseIssueNumber(identifier: string): string {
  const m = /-(\d+)$/.exec(identifier);
  return m && m[1] ? m[1] : "nn";
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
