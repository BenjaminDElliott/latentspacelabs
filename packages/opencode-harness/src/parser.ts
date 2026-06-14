/**
 * Ticket-pack markdown parser.
 *
 * Parses a ticket-pack file authored against `docs/templates/opencode-ticket-pack.md`
 * into a `TicketPack` structure. Best-effort and lenient on whitespace, but
 * strict on the section names the contract fixes. Callers should pipe the
 * parsed pack through `validate()` before using it.
 *
 * The parser is deliberately small: no markdown library, no AST. The contract
 * surface is shallow (header bullets + a handful of named sections), and a
 * 200-line regex-driven reader is easier to audit than a tree walker.
 */

import type {
  CostBand,
  ReadinessStatus,
  RiskLevel,
  TicketPack,
  TicketPackBranchRules,
  TicketPackHeader,
} from './types.js';

const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/;
const HEADER_BULLET_RE = /^[-*]\s+\*\*([^*]+):\*\*\s*(.*?)\s*$/;
const ALT_HEADER_BULLET_RE = /^[-*]\s+([A-Za-z][^:]+):\s*(.*?)\s*$/;
const CHECKBOX_BULLET_RE = /^[-*]\s+\[[ xX]\]\s+(.*?)\s*$/;
const PLAIN_BULLET_RE = /^[-*]\s+(.*?)\s*$/;

const READINESS_VALUES = new Set<ReadinessStatus>([
  'ready',
  'blocked',
  'needs_clarification',
  'too_large',
]);
const COST_BAND_VALUES = new Set<CostBand>(['low', 'medium', 'high']);
const RISK_VALUES = new Set<RiskLevel>(['low', 'medium', 'high']);

interface ParsedSections {
  header: Map<string, string>;
  sections: Map<string, string[]>;
}

function splitIntoSections(raw: string): ParsedSections {
  const lines = raw.split(/\r?\n/);
  const header = new Map<string, string>();
  const sections = new Map<string, string[]>();

  let current: string | null = null;
  let inHeader = false;

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      const name = (sectionMatch[1] ?? '').trim();
      current = name;
      inHeader = name.toLowerCase() === 'header';
      if (!sections.has(name)) sections.set(name, []);
      continue;
    }
    if (current === null) continue;

    if (inHeader) {
      const m = line.match(HEADER_BULLET_RE) ?? line.match(ALT_HEADER_BULLET_RE);
      if (m) {
        const key = (m[1] ?? '').trim().toLowerCase();
        const value = (m[2] ?? '').trim();
        header.set(key, value);
        continue;
      }
    }

    sections.get(current)?.push(line);
  }

  return { header, sections };
}

function getSection(sections: Map<string, string[]>, name: string): string[] {
  for (const [key, value] of sections.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return [];
}

function extractBullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const checkbox = line.match(CHECKBOX_BULLET_RE);
    if (checkbox) {
      const text = (checkbox[1] ?? '').trim();
      if (text.length > 0) out.push(text);
      continue;
    }
    const plain = line.match(PLAIN_BULLET_RE);
    if (plain) {
      const text = (plain[1] ?? '').trim();
      if (text.length > 0 && !text.startsWith('**')) out.push(text);
    }
  }
  return out;
}

/**
 * Extracts the goal as the first non-empty paragraph in the `## Goal` section,
 * collapsed onto a single line. The contract requires one sentence; the parser
 * does not enforce sentence count — that is `validate`'s job.
 */
function extractGoal(lines: string[]): string {
  const collected: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(trimmed);
  }
  return collected.join(' ').trim();
}

/**
 * Pulls `Files in scope (allowlist)` and `Files / paths forbidden` out of the
 * `## Constraints` section. Both are sub-bullets in the template; the parser
 * accepts either inline (`- **Files in scope (allowlist):** path1, path2`) or
 * nested-bullet form (`  - path1`).
 */
function extractFileList(lines: string[], labels: string[]): string[] {
  const labelMatchers = labels.map((l) => l.toLowerCase());
  const result: string[] = [];
  let inLabel = false;
  let inlineDone = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    const labelMatch =
      trimmed.match(/^[-*]\s+\*\*([^*]+):\*\*\s*(.*)$/) ??
      trimmed.match(/^[-*]\s+([A-Za-z][^:]+):\s+(.*)$/);

    if (labelMatch) {
      const key = (labelMatch[1] ?? '').trim().toLowerCase();
      const inline = (labelMatch[2] ?? '').trim();
      if (labelMatchers.some((m) => key.includes(m))) {
        inLabel = true;
        inlineDone = false;
        if (inline.length > 0) {
          for (const piece of inline.split(',')) {
            const value = piece
              .trim()
              .replace(/\(new\)$/, '')
              .trim()
              .replace(/^`+/, '')
              .replace(/`+$/, '')
              .trim();
            if (value.length > 0) result.push(value);
          }
          inlineDone = true;
        }
      } else {
        inLabel = false;
      }
      continue;
    }

    if (inLabel) {
      const nested = line.match(/^\s{2,}[-*]\s+(.*?)\s*$/);
      if (nested) {
        const value = (nested[1] ?? '')
          .trim()
          .replace(/\(new\)$/, '')
          .trim()
          .replace(/^`+/, '')
          .replace(/`+$/, '')
          .trim();
        if (value.length > 0) result.push(value);
      } else if (trimmed.length === 0) {
        if (inlineDone || result.length > 0) inLabel = false;
      } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        inLabel = false;
      }
    }
  }

  return result;
}

function extractDependencyPolicy(lines: string[]): string {
  for (const raw of lines) {
    const trimmed = raw.trim();
    const m =
      trimmed.match(/^[-*]\s+\*\*Dependency policy:\*\*\s*(.*)$/i) ??
      trimmed.match(/^[-*]\s+Dependency policy:\s+(.*)$/i);
    if (m) return (m[1] ?? '').trim();
  }
  return '';
}

function extractBranchRules(lines: string[]): TicketPackBranchRules {
  let branch = '';
  let prTitlePrefix = '';
  let prBase = '';
  for (const raw of lines) {
    const trimmed = raw.trim();
    const branchMatch =
      trimmed.match(/^[-*]\s+\*\*Branch(?:\s+name)?:\*\*\s*`?([^`\s]+)`?/i) ??
      trimmed.match(/^[-*]\s+Branch(?:\s+name)?:\s+`?([^`\s]+)`?/i);
    if (branchMatch) branch = (branchMatch[1] ?? '').trim();

    const titleMatch =
      trimmed.match(/^[-*]\s+\*\*PR title(?:\s+prefix)?:\*\*\s*`?([^`]*)`?/i) ??
      trimmed.match(/^[-*]\s+PR title(?:\s+prefix)?:\s+`?([^`]*)`?/i);
    if (titleMatch) prTitlePrefix = (titleMatch[1] ?? '').trim();

    const baseMatch =
      trimmed.match(/^[-*]\s+\*\*PR base:\*\*\s*`?([^`\s]+)`?/i) ??
      trimmed.match(/^[-*]\s+PR base:\s+`?([^`\s]+)`?/i);
    if (baseMatch) prBase = (baseMatch[1] ?? '').trim();
  }
  return { branch, prTitlePrefix, prBase };
}

function asReadiness(value: string): ReadinessStatus | '' {
  const v = value.trim().toLowerCase();
  return READINESS_VALUES.has(v as ReadinessStatus) ? (v as ReadinessStatus) : '';
}

function asCostBand(value: string): CostBand | '' {
  const v = value.trim().toLowerCase();
  return COST_BAND_VALUES.has(v as CostBand) ? (v as CostBand) : '';
}

function asRiskLevel(value: string): RiskLevel | '' {
  const v = value.trim().toLowerCase();
  return RISK_VALUES.has(v as RiskLevel) ? (v as RiskLevel) : '';
}

export interface ParseResult {
  pack: TicketPack | null;
  errors: string[];
}

export function parseTicketPack(raw: string, packPath: string): ParseResult {
  const errors: string[] = [];
  const { header, sections } = splitIntoSections(raw);

  const linearId = (header.get('linear id') ?? '').trim();
  const packVersion = (header.get('pack version') ?? '').trim();
  const plannerSource = (
    header.get('planner run / source') ??
    header.get('planner run') ??
    ''
  ).trim();
  const costBand = asCostBand(header.get('cost band') ?? '');
  const riskLevel = asRiskLevel(header.get('risk level') ?? '');
  const readinessStatus = asReadiness(header.get('readiness status') ?? '');

  if (linearId.length === 0) errors.push('missing header field: Linear ID');
  if (packVersion.length === 0) errors.push('missing header field: Pack version');
  if (costBand === '') errors.push('missing or invalid header field: Cost band');
  if (riskLevel === '') errors.push('missing or invalid header field: Risk level');
  if (readinessStatus === '') errors.push('missing or invalid header field: Readiness status');

  if (errors.length > 0 && (linearId.length === 0 || readinessStatus === '')) {
    return { pack: null, errors };
  }

  const headerOut: TicketPackHeader = {
    linearId,
    packVersion,
    plannerSource,
    costBand: costBand === '' ? 'low' : costBand,
    riskLevel: riskLevel === '' ? 'low' : riskLevel,
    readinessStatus: readinessStatus === '' ? 'ready' : readinessStatus,
  };

  const goal = extractGoal(getSection(sections, 'Goal'));
  const acceptanceCriteria = extractBullets(getSection(sections, 'Acceptance criteria'));
  const constraintsLines = getSection(sections, 'Constraints');
  const filesInScope = extractFileList(constraintsLines, [
    'files in scope',
    'files in scope (allowlist)',
    'allowlist',
  ]);
  const filesForbidden = extractFileList(constraintsLines, [
    'files / paths forbidden',
    'files forbidden',
    'forbidden',
  ]);
  const dependencyPolicy = extractDependencyPolicy(constraintsLines);

  const expectedChecks = extractBullets(getSection(sections, 'Expected checks'));
  const branchRules = extractBranchRules(getSection(sections, 'Branch / PR rules'));

  const pack: TicketPack = {
    header: headerOut,
    goal,
    acceptanceCriteria,
    filesInScope,
    filesForbidden,
    dependencyPolicy,
    expectedChecks,
    branchRules,
    raw,
    rawPath: packPath,
  };

  return { pack, errors };
}
