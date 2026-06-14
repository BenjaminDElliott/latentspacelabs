/**
 * LAT-184 run-record module — produces a Linear sub-issue title and description
 * from a structured run artefact.
 *
 * Every completed dispatcher invocation creates a child sub-issue under the
 * source Linear ticket so the evidence is queryable inside Linear itself
 * (filter by parent, by label, by state, etc.). The sub-issue carries:
 *
 * - A deterministic title so the same ticket / run is never duplicated.
 * - A Markdown description that mirrors the run-report envelope plus the
 *   LAT-140 structured artefact fields.
 * - A `run-record` label (created lazily if absent) and the PR link.
 *
 * Pure module: no I/O. The dispatcher calls `buildRunRecord` and then posts
 * it through the Linear client's `createRunRecord` surface.
 */

import type { RunArtefact } from './run-artifact.js';

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/**
 * The title of the run-record sub-issue. Deterministic so callers can
 * deduplicate before creation.
 *
 * Format: `Run <outcome>: <ticket_id> (<iso_date>)`
 */
export function buildRunRecordTitle(artefact: RunArtefact): string {
  const ticketId = artefact.ticket_id ?? 'unknown';
  const outcome = artefact.outcome;
  const date = artefact.started_at.split('T')[0] ?? '';
  return `Run ${outcome}: ${ticketId} (${date})`;
}

/**
 * Markdown description for the run-record sub-issue. Contains all
 * evidence fields from the artefact, formatted for readability in Linear.
 */
export function buildRunRecordDescription(artefact: RunArtefact): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Run Record`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| **Run ID** | \`${artefact.invocation_id}\` |`);
  lines.push(`| **Outcome** | ${artefact.outcome} |`);
  lines.push(`| **Status** | ${artefact.outcome === 'ready_for_review' ? 'ready' : 'closed'} |`);
  lines.push(`| **Started** | ${artefact.started_at} |`);
  lines.push(`| **Ended** | ${artefact.ended_at} |`);
  lines.push(`| **Duration** | ${formatDuration(artefact.duration_ms)} |`);
  lines.push(`| **Ticket** | ${artefact.ticket_id ?? 'n/a'} |`);
  lines.push(`| **Branch** | ${artefact.branch ?? 'n/a'} |`);
  lines.push(`| **PR** | ${artefact.pr_url ?? 'n/a'} |`);
  lines.push(`| **Provider** | ${artefact.provider ?? 'n/a'} |`);
  lines.push(`| **Cost class** | ${artefact.cost_class} |`);
  lines.push(`| **Risk class** | ${artefact.risk_level} |`);
  lines.push('');

  // Refusal / failure info
  if (artefact.refusal_code || artefact.refusal_message) {
    lines.push('## Refusal / Failure');
    lines.push('');
    if (artefact.refusal_code) {
      lines.push(`- **Code:** ${artefact.refusal_code}`);
    }
    if (artefact.refusal_message) {
      lines.push(`- **Message:** ${artefact.refusal_message}`);
    }
    lines.push('');
  }

  // Checks summary
  if (artefact.checks && artefact.checks.length > 0) {
    lines.push('## Checks');
    lines.push('');
    for (const check of artefact.checks) {
      const icon =
        check.outcome === 'passed'
          ? '✅'
          : check.outcome === 'failed'
            ? '❌'
            : check.outcome === 'skipped'
              ? '⏭️'
              : '🤷';
      lines.push(`- ${icon} \`${check.name}\` — ${check.outcome} (${check.durationMs}ms)`);
    }
    lines.push('');
  }

  // Acceptance criteria coverage
  if (artefact.acceptance_criteria_coverage && artefact.acceptance_criteria_coverage.length > 0) {
    lines.push('## Acceptance Criteria');
    lines.push('');
    for (const ac of artefact.acceptance_criteria_coverage) {
      const statusIcon =
        ac.status === 'covered'
          ? '✅'
          : ac.status === 'partial'
            ? '🔶'
            : ac.status === 'uncovered'
              ? '❌'
              : '❓';
      lines.push(`- ${statusIcon} ${ac.criterion}`);
    }
    lines.push('');
  }

  // Redaction metadata
  lines.push('## Redaction Metadata');
  lines.push('');
  lines.push(`- **Redactor:** ${artefact.redaction.redactor}`);
  lines.push(`- **Patterns:** ${artefact.redaction.applied_patterns.join(', ')}`);
  lines.push(
    `- **Pre-redaction payload SHA-256:** \`${artefact.redaction.pre_redaction_payload_sha256}\``,
  );
  lines.push(
    `- **Redaction counts** — tokens: ${artefact.redaction.redaction_counts.tokens}, urls: ${artefact.redaction.redaction_counts.urls}, pod_ids: ${artefact.redaction.redaction_counts.pod_ids}, extra_secrets: ${artefact.redaction.redaction_counts.extra_secrets}`,
  );
  lines.push('');

  // Artefact provenance
  lines.push('## Provenance');
  lines.push('');
  lines.push(`- **Producer:** ${artefact.producer}`);
  lines.push(`- **Surface:** ${artefact.surface}`);
  lines.push(`- **Schema version:** ${artefact.schema_version}`);
  lines.push(`- **Artefact class:** ${artefact.artefact_class}`);
  lines.push(`- **Training eligibility:** ${artefact.training_eligibility}`);
  lines.push(`- **Quality label:** ${artefact.quality_label}`);
  if (artefact.eligibility_reason) {
    lines.push(`- **Eligibility reason:** ${artefact.eligibility_reason}`);
  }
  lines.push('');

  // Footer
  lines.push(
    `_Auto-generated by @latentspacelabs/icp LAT-184 evidence recorder. Structured run record for queryability inside Linear._`,
  );

  return lines.join('\n');
}

/**
 * Build both the title and description for a run-record sub-issue.
 * Returns a simple tuple so the caller can pass them to the Linear client
 * in one call.
 */
export function buildRunRecord(artefact: RunArtefact): { title: string; description: string } {
  return {
    title: buildRunRecordTitle(artefact),
    description: buildRunRecordDescription(artefact),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  if (ms < 0) return '0ms';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
