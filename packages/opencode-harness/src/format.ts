/**
 * Run-summary formatters.
 *
 * Two outputs are supported:
 *
 * - `formatSummaryJson` — the canonical structured artifact. The harness
 *   guarantees no endpoint URL, token, or internal hostname can appear here
 *   because the harness never holds one in the first place.
 * - `formatSummaryMarkdown` — the Linear-ready run summary an operator can
 *   paste into a Linear comment as an "implementation dry-run" artifact.
 *
 * Neither formatter calls out to anything; they are pure transforms.
 */

import type { DryRunSummary, HarnessStatus } from './types.js';

export function formatSummaryJson(summary: DryRunSummary): string {
  return JSON.stringify(summary, null, 2);
}

function codeSpan(value: string): string {
  const cleaned = value.replace(/^`+/, '').replace(/`+$/, '').trim();
  if (cleaned.length === 0) return '``';
  if (cleaned.includes('`')) return cleaned;
  return `\`${cleaned}\``;
}

const STATUS_LABELS: Record<HarnessStatus, string> = {
  ready: 'READY (dry-run pass)',
  blocked: 'BLOCKED',
  needs_clarification: 'NEEDS_CLARIFICATION',
  too_large: 'TOO_LARGE',
  harness_error: 'HARNESS_ERROR',
};

export function formatSummaryMarkdown(summary: DryRunSummary): string {
  const lines: string[] = [];
  lines.push(`# opencode dry-run summary — ${summary.ticket}`);
  lines.push('');
  lines.push(`- **Status:** ${STATUS_LABELS[summary.status]}`);
  lines.push(`- **Pack:** \`${summary.packPath}\``);
  lines.push(`- **Pack readiness:** ${summary.packReadinessStatus}`);
  lines.push(`- **Cost band:** ${summary.costBand}`);
  lines.push(`- **Risk level:** ${summary.riskLevel}`);
  lines.push(`- **Generated at:** ${summary.generatedAt}`);
  lines.push(`- **Endpoint invoked:** no`);
  lines.push(`- **PR opened:** no`);
  lines.push(`- **Linear write-back:** no`);
  lines.push('');

  if (summary.branchPlan !== null) {
    lines.push('## Branch / PR plan (would be opened on a real run)');
    lines.push('');
    lines.push(`- Branch: \`${summary.branchPlan.branch}\``);
    lines.push(`- PR base: \`${summary.branchPlan.prBase}\``);
    lines.push(`- PR title example: \`${summary.branchPlan.prTitleExample}\``);
    lines.push('');
  }

  if (summary.filesInScope.length > 0) {
    lines.push('## Files in scope (allowlist)');
    lines.push('');
    for (const file of summary.filesInScope) lines.push(`- ${codeSpan(file)}`);
    lines.push('');
  }

  if (summary.filesForbidden.length > 0) {
    lines.push('## Files / paths forbidden');
    lines.push('');
    for (const file of summary.filesForbidden) lines.push(`- ${codeSpan(file)}`);
    lines.push('');
  }

  if (summary.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance criteria (would be evaluated on a real run)');
    lines.push('');
    for (const ac of summary.acceptanceCriteria) lines.push(`- [ ] ${ac}`);
    lines.push('');
  }

  if (summary.checkPlan.length > 0) {
    lines.push('## Check plan');
    lines.push('');
    for (const check of summary.checkPlan) {
      const kindTag = check.kind === 'shell' ? '' : `, ${check.kind}`;
      const rendered = check.kind === 'shell' ? `\`${check.command}\`` : check.command;
      lines.push(`- ${check.name} — ${rendered} (${check.source}${kindTag})`);
    }
    lines.push('');
  }

  if (summary.refusals.length > 0) {
    lines.push('## Refusals');
    lines.push('');
    for (const r of summary.refusals) {
      lines.push(`- **${r.code}** — ${r.message}`);
    }
    lines.push('');
  }

  if (summary.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const n of summary.notes) lines.push(`- ${n}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_Produced by `@latentspacelabs/opencode-harness` (LAT-105). ' +
      'This harness never invokes opencode, the local Qwen endpoint, GitHub, or Linear._',
  );

  return lines.join('\n');
}
