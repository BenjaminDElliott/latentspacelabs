/**
 * Agent-ready ticket contract validator (ADR-0023, LAT-142).
 *
 * Validates a ticket against the agent-ready contract defined in:
 * - ADR-0023: docs/decisions/0023-agent-ready-ticket-contract.md
 * - Lane policy: docs/process/ticket-lane-policy.md
 *
 * The validator is pure (no I/O) so the dispatcher can call it before
 * any network or process I/O. The shape is designed so future LLM-backed
 * implementations can drop in behind the same schema.
 */

// --- Types ---

/** Valid lane identifiers. */
export type LaneId = 'docs/adr/prd' | 'implementation' | 'harness/meta' | 'research/spike';

/** Valid agent types. */
export type AgentType = 'coding' | 'qa' | 'review' | 'research' | 'sre' | 'pm' | 'observability';

/** Risk level for the ticket. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Refusal reason codes. Stable strings for tests. */
export type RefusalCode =
  | 'missing_field'
  | 'vague_spike_no_ac'
  | 'secret_rotation_hard_stop'
  | 'deploy_release_in_implementation'
  | 'auto_merge_scope'
  | 'primary_adr_decision'
  | 'description_too_short'
  | 'no_acceptance_criteria_heading'
  | 'empty_out_of_scope'
  | 'invalid_lane'
  | 'invalid_agent_type'
  | 'invalid_risk_level'
  | 'missing_budget_cap_numeric';

/** A single refusal finding. */
export interface Refusal {
  code: RefusalCode;
  message: string;
  /** Which check number in the ADR-0023 contract (1-10). */
  checkNumber?: number;
}

/** Full validation result. */
export interface ValidationResult {
  /** True if the ticket passes all checks. */
  valid: boolean;
  /** Refusal findings (empty when valid). */
  refusals: ReadonlyArray<Refusal>;
  /** Resolved lane, when the ticket has one. */
  lane?: LaneId;
  /** Resolved agent type, when the ticket has one. */
  agentType?: AgentType;
  /** Resolved risk level, when the ticket has one. */
  riskLevel?: RiskLevel;
}

// --- Validation functions ---

/**
 * Validate a ticket description/body against the agent-ready contract.
 *
 * The ticket is expected to be a Markdown string containing the sections
 * defined in ADR-0023's required-fields table and lane policy.
 *
 * @param body - The ticket body (description text from Linear).
 * @param options - Optional validation controls.
 * @returns A ValidationResult.
 */
export function validateAgentReadyContract(
  body: string,
  options: {
    /** Skip the vague-spike check (e.g., when title is validated separately). */
    skipVagueSpikeCheck?: boolean;
    /** Skip the description length check. */
    skipDescriptionLengthCheck?: boolean;
  } = {},
): ValidationResult {
  const refusals: Refusal[] = [];
  const { skipVagueSpikeCheck = false, skipDescriptionLengthCheck = false } = options;

  const trimmed = body.trim();

  // Check 1: Required fields exist and are non-blank
  const requiredFields = [
    { key: 'Linear ID', pattern: /^Linear ID:\s*(LAT-\d+)\s*$/im },
    { key: 'Title', pattern: /^Title:\s*(.+)$/m },
    { key: 'Agent type', pattern: /^Agent type:\s*(\S+)/m },
    { key: 'Lane', pattern: /^Lane:\s*(\S+(?:\/\S+)?)$/m },
    { key: 'Risk level', pattern: /^Risk level:\s*(\S+)/m },
    { key: 'Budget cap', pattern: /^Budget cap:\s*(.+)$/m },
    { key: 'Approval required', pattern: /^Approval required:\s*(yes|no)/im },
    { key: 'Goal', pattern: /^(?:## Goal|Goal)\s*(.+)$/m },
    { key: 'Sequencing', pattern: /^## Sequencing/m },
    { key: 'In scope', pattern: /^(?:### In scope|In scope)\s*[-]/m },
    { key: 'Out of scope', pattern: /^(?:### Out of scope|Out of scope)\s*[-]/m },
    { key: 'Acceptance criteria', pattern: /^(?:## Acceptance Criteria|Acceptance Criteria)\s*$/m },
    { key: 'Tests', pattern: /^(?:## Tests|Tests)\s*$/m },
    { key: 'Required evidence', pattern: /^(?:## Required Evidence|Required Evidence)\s*$/m },
    { key: 'Quality gate', pattern: /^(?:## Quality Gate|Quality Gate)\s*$/m },
    { key: 'Rollback', pattern: /^(?:## Rollback|Rollback)\s*$/m },
    { key: 'Definition of Done', pattern: /^(?:## Definition of Done|Definition of Done)\s*$/m },
    { key: 'Links', pattern: /^(?:## Links|Links)\s*$/m },
  ];

  let missingFields: string[] = [];
  for (const f of requiredFields) {
    if (!f.pattern.test(trimmed)) {
      missingFields.push(f.key);
    }
  }

  if (missingFields.length > 0) {
    refusals.push({
      code: 'missing_field',
      message: `missing required field(s): ${missingFields.join(', ')}`,
      checkNumber: 1,
    });
  }

  // Check 2: Valid lane
  const laneMatch = /^Lane:\s*(.+)$/m.exec(trimmed);
  const lane = laneMatch ? laneMatch[1].trim() : null;
  if (lane && !isLane(lane)) {
    refusals.push({
      code: 'invalid_lane',
      message: `lane "${lane}" is not one of: docs/adr/prd, implementation, harness/meta, research/spike`,
      checkNumber: 2,
    });
  }

  // Check 3: Valid agent type
  const agentTypeMatch = /^Agent type:\s*(\S+)/m.exec(trimmed);
  const agentType = agentTypeMatch ? agentTypeMatch[1] : null;
  if (agentType && !isAgentType(agentType)) {
    refusals.push({
      code: 'invalid_agent_type',
      message: `agent type "${agentType}" is not one of: coding, qa, review, research, sre, pm, observability`,
      checkNumber: 3,
    });
  }

  // Check 4: Valid risk level
  const riskMatch = /^Risk level:\s*(\S+)/m.exec(trimmed);
  const riskLevel = riskMatch ? riskMatch[1] : null;
  if (riskLevel && !isRiskLevel(riskLevel)) {
    refusals.push({
      code: 'invalid_risk_level',
      message: `risk level "${riskLevel}" must be: low, medium, or high`,
      checkNumber: 4,
    });
  }

  // Check 5: Budget cap is numeric
  const budgetMatch = /^Budget cap:\s*(.+)$/m.exec(trimmed);
  const budgetCap = budgetMatch ? budgetMatch[1].trim() : null;
  if (budgetCap && !isNumericBudgetCap(budgetCap)) {
    refusals.push({
      code: 'missing_budget_cap_numeric',
      message: `budget cap "${budgetCap}" is not numeric (e.g., "100k tokens", "$5", "10 min")`,
      checkNumber: 5,
    });
  }

  // Check 6: Acceptance criteria have checkbox prefix
  const hasAcceptanceCriteria = /^(?:## Acceptance Criteria|Acceptance Criteria)\s*$/m.test(
    trimmed,
  );
  if (hasAcceptanceCriteria) {
    const acMatch =
      /^(?:## Acceptance Criteria|Acceptance Criteria)\s*\n([\s\S]*?)(?=^## |$)/m.exec(trimmed);
    if (acMatch) {
      const acSection = acMatch[1];
      const lines = acSection.split('\n');
      const nonCheckboxLines: string[] = [];
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) continue;
        if (trimmedLine.startsWith('- [ ]') || trimmedLine.startsWith('- [x]')) continue;
        if (trimmedLine.startsWith('#') || trimmedLine.startsWith('|')) continue;
        nonCheckboxLines.push(trimmedLine);
      }
      if (nonCheckboxLines.length > 0) {
        refusals.push({
          code: 'missing_field',
          message: `acceptance criteria lines without checkbox prefix: ${nonCheckboxLines.slice(0, 3).join(', ')}...`,
          checkNumber: 6,
        });
      }
    }
  }

  // Check 7: Description too short
  if (!skipDescriptionLengthCheck && trimmed.length < 80) {
    refusals.push({
      code: 'description_too_short',
      message: `description is ${trimmed.length} chars (minimum 80 to bound dispatch scope)`,
      checkNumber: 7,
    });
  }

  // Check 8: Empty out-of-scope (section exists but has no items)
  const outOfScopeMatch = /^(?:### Out of scope|Out of scope)\s*\n([\s\S]*?)(?=^## |$)/m.exec(
    trimmed,
  );
  if (outOfScopeMatch) {
    const oosSection = outOfScopeMatch[1];
    const items = oosSection.split('\n').filter((l) => l.trim().startsWith('- '));
    if (items.length === 0) {
      refusals.push({
        code: 'empty_out_of_scope',
        message: 'out-of-scope section exists but contains no items',
        checkNumber: 8,
      });
    }
  }

  // Check 9: Vague spike without AC
  if (!skipVagueSpikeCheck) {
    const titleMatch = /^Title:\s*(.+)$/m.exec(trimmed);
    const title = titleMatch ? titleMatch[1] : '';
    const vaguePatterns = [
      /^investigate\b/i,
      /^explore\b/i,
      /^think about\b/i,
      /^discuss\b/i,
      /^plan\b/i,
    ];
    const isVague = vaguePatterns.some((p) => p.test(title));
    if (isVague && !hasAcceptanceCriteria) {
      refusals.push({
        code: 'vague_spike_no_ac',
        message: `vague spike title "${title.slice(0, 60)}" has no Acceptance Criteria section`,
        checkNumber: 9,
      });
    }
  }

  // Check 10: Secret rotation / deploy/release / auto-merge scope
  const allText = trimmed.toLowerCase();
  const safeContextPatterns = [
    /\bdo(?:es)?\s+not\s+touch\s+(?:the\s+)?(?:secret|credential|token)/i,
    /\bdon'?t\s+touch\s+(?:the\s+)?(?:secret|credential|token)/i,
    /\bno\s+(?:secret|credential|token)/i,
    /\bnever\s+(?:touch|expose|log|leak)\s+(?:the\s+)?(?:secret|credential|token)/i,
    /\badr-\d+/i,
  ];

  // Secret rotation
  const secretRotations = [
    /\b(?:rotate|revoke|reset|regenerate|reissue|replace|cycle)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  ];
  for (const pat of secretRotations) {
    const lines = trimmed.split('\n');
    for (const line of lines) {
      if (!pat.test(line)) continue;
      if (!safeContextPatterns.some((sp) => sp.test(line))) {
        refusals.push({
          code: 'secret_rotation_hard_stop',
          message: `secret/credential scope detected: "${line.trim().slice(0, 80)}"`,
          checkNumber: 10,
        });
        break;
      }
    }
  }

  // Deploy/release in implementation lane
  if (lane === 'implementation') {
    const deployPatterns = [
      /\b(?:deploy(?:ing)?|release(?:ing)?|publish(?:ing)?|ship(?:ping)?|roll\s*out)/i,
    ];
    for (const pat of deployPatterns) {
      if (pat.test(allText)) {
        refusals.push({
          code: 'deploy_release_in_implementation',
          message:
            'deploy/release/publish scope in implementation lane (deploy is a Stop action per ADR-0008)',
          checkNumber: 10,
        });
        break;
      }
    }
  }

  // Auto-merge scope
  const autoMergePatterns = [/\b(?:auto[-\s]?merge|automerge|merge\s+the\s+pr\b)/i];
  for (const pat of autoMergePatterns) {
    if (pat.test(allText)) {
      refusals.push({
        code: 'auto_merge_scope',
        message: 'ticket scope includes merging PRs or auto-merge',
        checkNumber: 10,
      });
      break;
    }
  }

  return {
    valid: refusals.length === 0,
    refusals,
    lane: lane && isLane(lane) ? lane : undefined,
    agentType: agentType && isAgentType(agentType) ? agentType : undefined,
    riskLevel: riskLevel && isRiskLevel(riskLevel) ? riskLevel : undefined,
  };
}

// --- Helper validators ---

function isLane(v: string): v is LaneId {
  return (
    v === 'docs/adr/prd' || v === 'implementation' || v === 'harness/meta' || v === 'research/spike'
  );
}

function isAgentType(v: string): v is AgentType {
  return (
    v === 'coding' ||
    v === 'qa' ||
    v === 'review' ||
    v === 'research' ||
    v === 'sre' ||
    v === 'pm' ||
    v === 'observability'
  );
}

function isRiskLevel(v: string): v is RiskLevel {
  return v === 'low' || v === 'medium' || v === 'high';
}

function isNumericBudgetCap(v: string): boolean {
  return /^\d/.test(v.trim());
}

// --- Export for CLI use ---

export function formatResult(result: ValidationResult): string {
  if (result.valid) {
    const parts = [`ticket-contract: OK`];
    if (result.lane) parts.push(`  lane: ${result.lane}`);
    if (result.agentType) parts.push(`  agent type: ${result.agentType}`);
    if (result.riskLevel) parts.push(`  risk level: ${result.riskLevel}`);
    return parts.join('\n');
  }

  const lines = [`ticket-contract: REFUSED (${result.refusals.length} finding(s))`];
  for (const r of result.refusals) {
    lines.push(`  [check ${r.checkNumber ?? '?'}] ${r.code}: ${r.message}`);
  }
  return lines.join('\n');
}
