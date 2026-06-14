/**
 * Ticket-pack validator.
 *
 * Enforces the rules `docs/templates/opencode-ticket-pack.md` calls out at
 * the bottom under *Validation notes (for LAT-103 / LAT-105)*. A pack that
 * fails validation is rejected before the harness simulates a run.
 *
 * Validation produces a list of findings, each with a severity. `error`
 * findings cause the harness to refuse the pack; `warning` findings are
 * surfaced in the run summary but do not block.
 *
 * Notably forbidden: secret-shaped values inside the pack itself (endpoint
 * URLs, tokens, internal hostnames). The harness uses a small in-package
 * matcher rather than depending on `secret-guard` so that this package can
 * be consumed without pulling in the broader scanner — the rules below are
 * a deliberately narrow subset focused on the LAT-104 contract surface.
 */

import type { TicketPack, ValidationFinding, ValidationResult } from './types.js';
import { parseTicketPack } from './parser.js';

const LINEAR_ID_RE = /^LAT-\d+$/;
const BRANCH_NAME_RE = /^lat-\d+-[a-z0-9-]+$/;

const FORBIDDEN_PATH_GLOBS = ['.github/workflows/', 'docs/decisions/', 'docs/prds/'];

const SECRET_LIKE_PATTERNS: { code: string; re: RegExp; description: string }[] = [
  {
    code: 'secret_url_http',
    re: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/i,
    description: 'looks like a local endpoint URL',
  },
  {
    code: 'secret_bearer',
    re: /bearer\s+[A-Za-z0-9._\-]{16,}/i,
    description: 'looks like an auth bearer token',
  },
  {
    code: 'secret_api_key',
    re: /\b(?:sk|api|qwen|anthropic)[-_][A-Za-z0-9]{16,}/i,
    description: 'looks like an API key',
  },
  {
    code: 'secret_authorization_header',
    re: /authorization\s*:\s*[A-Za-z]+\s+\S+/i,
    description: 'looks like an Authorization header',
  },
];

function pushError(out: ValidationFinding[], code: string, message: string): void {
  out.push({ severity: 'error', code, message });
}

function pushWarning(out: ValidationFinding[], code: string, message: string): void {
  out.push({ severity: 'warning', code, message });
}

function checkAllowlistDisjoint(pack: TicketPack, out: ValidationFinding[]): void {
  const allow = new Set(pack.filesInScope);
  for (const forbidden of pack.filesForbidden) {
    if (allow.has(forbidden)) {
      pushError(
        out,
        'allowlist_overlap',
        `path "${forbidden}" appears in both Files in scope and Files / paths forbidden`,
      );
    }
  }
  for (const path of pack.filesInScope) {
    for (const glob of FORBIDDEN_PATH_GLOBS) {
      if (path.startsWith(glob)) {
        pushError(
          out,
          'allowlist_in_forbidden_root',
          `Files in scope path "${path}" lives under a forbidden root (${glob}). Editing it requires an ADR diff, not a ticket pack.`,
        );
      }
    }
  }
}

function checkSecretShaped(pack: TicketPack, out: ValidationFinding[]): void {
  for (const pattern of SECRET_LIKE_PATTERNS) {
    if (pattern.re.test(pack.raw)) {
      pushError(
        out,
        pattern.code,
        `ticket pack contains a value that ${pattern.description}; secrets and endpoint URLs must not appear in the pack (ADR-0014, ADR-0017)`,
      );
    }
  }
}

function checkHeader(pack: TicketPack, out: ValidationFinding[]): void {
  if (!LINEAR_ID_RE.test(pack.header.linearId)) {
    pushError(
      out,
      'linear_id_shape',
      `Linear ID "${pack.header.linearId}" does not match ^LAT-\\d+$`,
    );
  }
  const allowedReadiness = ['ready', 'blocked', 'needs_clarification', 'too_large'];
  if (!allowedReadiness.includes(pack.header.readinessStatus)) {
    pushError(
      out,
      'readiness_status_invalid',
      `Readiness status "${pack.header.readinessStatus}" is not one of ${allowedReadiness.join(', ')}`,
    );
  }
}

function checkGoal(pack: TicketPack, out: ValidationFinding[]): void {
  if (pack.goal.length === 0) {
    pushError(out, 'goal_missing', 'Goal section is empty');
    return;
  }
  const sentenceCount = pack.goal.split(/[.!?](?:\s|$)/).filter((s) => s.trim().length > 0).length;
  if (sentenceCount > 2) {
    pushWarning(
      out,
      'goal_multi_sentence',
      'Goal appears to span more than two sentences; consider whether this pack is actually two tickets',
    );
  }
}

function checkAcceptanceCriteria(pack: TicketPack, out: ValidationFinding[]): void {
  if (pack.acceptanceCriteria.length === 0) {
    pushError(
      out,
      'acceptance_criteria_empty',
      'Acceptance criteria must contain at least one checkbox bullet',
    );
  }
}

function checkConstraints(pack: TicketPack, out: ValidationFinding[]): void {
  if (pack.filesInScope.length === 0) {
    pushError(
      out,
      'files_in_scope_empty',
      'Constraints → Files in scope (allowlist) is empty; opencode refuses to start without an explicit allowlist',
    );
  }
  if (pack.filesForbidden.length === 0) {
    pushWarning(
      out,
      'files_forbidden_empty',
      'Constraints → Files / paths forbidden is empty; the contract recommends listing at least .github/workflows/**, docs/decisions/**, docs/prds/**',
    );
  }
  if (pack.dependencyPolicy.length === 0) {
    pushWarning(
      out,
      'dependency_policy_missing',
      "Constraints → Dependency policy not declared; the harness assumes 'no new deps'",
    );
  }
}

function checkBranchRules(pack: TicketPack, out: ValidationFinding[]): void {
  if (pack.branchRules.branch.length === 0) {
    pushError(out, 'branch_missing', 'Branch / PR rules → Branch name is missing');
  } else if (!BRANCH_NAME_RE.test(pack.branchRules.branch)) {
    pushError(
      out,
      'branch_shape',
      `Branch name "${pack.branchRules.branch}" does not match lat-<digits>-<slug>`,
    );
  } else {
    const branchTicketMatch = pack.branchRules.branch.match(/^lat-(\d+)-/);
    const linearMatch = pack.header.linearId.match(/^LAT-(\d+)$/);
    if (branchTicketMatch && linearMatch && branchTicketMatch[1] !== linearMatch[1]) {
      pushError(
        out,
        'branch_ticket_mismatch',
        `Branch "${pack.branchRules.branch}" does not match Linear ID "${pack.header.linearId}"`,
      );
    }
  }

  if (pack.branchRules.prBase.length === 0) {
    pushWarning(out, 'pr_base_missing', 'PR base not declared; assuming `main`');
  } else if (pack.branchRules.prBase !== 'main') {
    pushError(
      out,
      'pr_base_invalid',
      `PR base "${pack.branchRules.prBase}" is not main; the runtime only opens PRs against main`,
    );
  }

  const expectedPrefix = `${pack.header.linearId}:`;
  if (pack.branchRules.prTitlePrefix.length === 0) {
    pushWarning(
      out,
      'pr_title_prefix_missing',
      `PR title prefix not declared; expected to start with "${expectedPrefix}"`,
    );
  } else if (!pack.branchRules.prTitlePrefix.startsWith(pack.header.linearId)) {
    pushError(
      out,
      'pr_title_prefix_mismatch',
      `PR title prefix "${pack.branchRules.prTitlePrefix}" does not start with the Linear ID "${pack.header.linearId}"`,
    );
  }
}

function checkExpectedChecks(pack: TicketPack, out: ValidationFinding[]): void {
  const joined = pack.expectedChecks.join('\n').toLowerCase();
  if (!joined.includes('npm run check')) {
    pushError(
      out,
      'missing_repo_gate_check',
      'Expected checks must include `npm run check` (the repo gate)',
    );
  }
}

export function validateTicketPack(raw: string, packPath: string): ValidationResult {
  const findings: ValidationFinding[] = [];
  const parsed = parseTicketPack(raw, packPath);

  for (const err of parsed.errors) {
    pushError(findings, 'parse_error', err);
  }

  if (parsed.pack === null) {
    return { ok: false, findings };
  }

  const pack = parsed.pack;
  checkSecretShaped(pack, findings);
  checkHeader(pack, findings);
  checkGoal(pack, findings);
  checkAcceptanceCriteria(pack, findings);
  checkConstraints(pack, findings);
  checkAllowlistDisjoint(pack, findings);
  checkBranchRules(pack, findings);
  checkExpectedChecks(pack, findings);

  const hasError = findings.some((f) => f.severity === 'error');
  return { ok: !hasError, findings, pack };
}
