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
   lines.push(`- **Pack version:** 2`);
   lines.push(`- **Source:** LAT-129 polling dispatcher (auto-generated, LAT-136 enhanced)`);
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
   lines.push("## Concrete scope");
   lines.push("");
   lines.push(
     "The following sections must be populated for the agent to produce deterministic output. If any section is empty, the agent must note it in its implementation plan.",
   );
   lines.push("");
   lines.push("### Target files");
   lines.push("");
   lines.push(
     "- **Files to edit:** identify from the Linear issue description (e.g. `packages/icp/src/dispatcher/ticket-pack.ts`).",
   );
   lines.push(
     "- **Files to create:** if the issue requires new files, list them here with a one-sentence purpose.",
   );
   lines.push("");
   lines.push("### Non-churn expectations (files NOT to change)");
   lines.push("");
   lines.push(
     "- **Existing files outside scope:** do NOT modify. If a dependency must be updated, justify it and list the specific file(s).",
   );
   lines.push(
     "- **docs/decisions/**, **docs/prds/**, **.github/workflows/**:** forbidden paths — no edits.",
   );
   lines.push(
     "- **README-only gate:** when the ticket asks for cross-doc or cross-file changes, a single README edit is NOT sufficient. Evidence must show edits in at least one non-README file.",
   );
   lines.push("");
   lines.push("## Implementation plan requirement");
   lines.push("");
   lines.push(
     "Before making changes, the agent MUST produce a short implementation plan (≤200 words) that covers:",
   );
   lines.push("");
   lines.push("- **What files will be edited and why.**");
   lines.push("- **What files will NOT be edited (non-churn).**");
   lines.push("- **How each acceptance criterion will be satisfied.**");
   lines.push(
     "- **Expected checks and their pass/fail criteria.**",
   );
   lines.push(
     "The plan must be written to a file named `.impl-plan.md` in the invocation directory and referenced in the final evidence.",
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
   lines.push("- PR link, files changed, checks pass/fail, acceptance criteria status, redacted run artifact, final status.");
   lines.push("");
   lines.push("### Evidence must include:");
   lines.push("");
   lines.push("- **Implementation plan:** path to `.impl-plan.md` confirming the plan was written before changes.");
   lines.push("- **AC-to-change mapping:** each acceptance criterion mapped to at least one file or diff section.");
   lines.push("- **Non-churn confirmation:** statement that no unexpected files were modified.");
   lines.push(
     "- **README-only gate:** if the ticket asks for cross-file changes, at least one non-README file must appear in the diff.",
   );
   lines.push(
     "- **Final status:** `ready_for_review`, `insufficient_change`, `needs_better_pack`, or `checks_failed`.",
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
