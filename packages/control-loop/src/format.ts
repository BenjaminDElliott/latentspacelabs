/**
 * Formatters for the control-loop run summary. Pure transforms; no I/O.
 *
 * The JSON form is canonical evidence — it is what a future Linear /
 * GitHub write-back will consume. The Markdown form is what an operator
 * pastes into a ticket comment for a human reviewer.
 */

import type { RunState, RunSummary } from './types.js';

const STATE_LABELS: Record<RunState, string> = {
  planned: 'PLANNED (no dispatch)',
  running: 'RUNNING',
  refused: 'REFUSED',
  failed: 'FAILED',
  checks_failed: 'CHECKS_FAILED',
  ready_for_review: 'READY_FOR_REVIEW',
};

export function formatRunSummaryJson(summary: RunSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatRunSummaryMarkdown(summary: RunSummary): string {
  const ev = summary.evidence;
  const lines: string[] = [];
  lines.push(`# control-loop run — ${ev.ticket}`);
  lines.push('');
  lines.push(`- **State:** ${STATE_LABELS[ev.state]}`);
  lines.push(`- **Mode:** ${ev.mode}`);
  lines.push(`- **Pack:** \`${ev.packPath}\``);
  lines.push(`- **Cost band:** ${ev.costBand}`);
  lines.push(`- **Risk level:** ${ev.riskLevel}`);
  lines.push(`- **Started:** ${ev.startedAt}`);
  lines.push(`- **Finished:** ${ev.finishedAt}`);
  if (ev.provider !== null) {
    lines.push(
      `- **Provider:** \`${ev.provider.adapter}\` runtime=\`${ev.provider.runtimeId}\` cost=\`${ev.provider.costClass}\``,
    );
  } else {
    lines.push(`- **Provider:** (none — no adapter contacted)`);
  }
  lines.push('');

  if (ev.branch !== null) {
    lines.push('## Branch / PR plan');
    lines.push('');
    lines.push(`- Branch: \`${ev.branch.branch}\``);
    lines.push(`- PR base: \`${ev.branch.prBase}\``);
    lines.push(`- PR title prefix: \`${ev.branch.prTitlePrefix}\``);
    lines.push(
      `- PR URL: ${ev.branch.prUrl ?? '(not opened — control loop never opens PRs in MVP)'}`,
    );
    lines.push('');
  }

  if (ev.checks.length > 0) {
    lines.push('## Checks');
    lines.push('');
    for (const c of ev.checks) {
      const detail = c.detail !== undefined ? ` — ${c.detail}` : '';
      lines.push(`- ${c.outcome.toUpperCase()} \`${c.command}\` (${c.durationMs}ms)${detail}`);
    }
    lines.push('');
  }

  if (ev.refusals.length > 0) {
    lines.push('## Refusals');
    lines.push('');
    for (const r of ev.refusals) {
      lines.push(`- **${r.code}** — ${r.message}`);
    }
    lines.push('');
  }

  if (ev.logs !== null) {
    lines.push(`## Logs`);
    lines.push('');
    lines.push(`- Type: \`${ev.logs.type}\``);
    lines.push(`- Path: \`${ev.logs.path}\``);
    lines.push('');
  }

  lines.push('## Next human action');
  lines.push('');
  lines.push(ev.nextHumanAction);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(
    '_Produced by `@latentspacelabs/control-loop` (LAT-117). ' +
      'MVP loop never opens PRs, never auto-merges, and never deploys._',
  );
  return lines.join('\n');
}
