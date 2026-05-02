/**
 * Pre-dispatch guardrails. These run before any adapter is contacted and
 * are independent of the LAT-105 dry-run validation (which checks the pack
 * contract). The guardrails here check things the harness deliberately
 * does not: secret-shaped strings in the pack, cost-class escalation, and
 * non-TypeScript/npm dependency policy.
 *
 * Each guardrail returns either `null` (pass) or a refusal reason. The
 * control loop aggregates them and refuses without dispatching when any
 * fire.
 */

import type { TicketPack } from "@latentspacelabs/opencode-harness";

import type { RefusalEvidence } from "./types.js";

/**
 * Patterns we treat as secret-shaped. The point is to refuse a pack that
 * was authored with credentials accidentally pasted in — not to be a
 * full-strength scanner. The repo's `secret-guard` package handles the
 * authoritative scan elsewhere; this is a last-mile check on the pack
 * specifically before we send its raw text to a runtime.
 */
const SECRET_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "secret_aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "secret_github_token", pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { code: "secret_anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { code: "secret_openai_key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { code: "secret_private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { code: "secret_bearer_header", pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i },
];

const FORBIDDEN_DEP_KEYWORDS: ReadonlyArray<{ code: string; needle: RegExp; label: string }> = [
  { code: "forbidden_python_dep", needle: /\bpython\b/i, label: "Python" },
  { code: "forbidden_pnpm_dep", needle: /\bpnpm\b/i, label: "pnpm" },
  { code: "forbidden_yarn_dep", needle: /\byarn\b/i, label: "yarn" },
];

export function checkSecrets(pack: TicketPack): RefusalEvidence[] {
  const refusals: RefusalEvidence[] = [];
  for (const { code, pattern } of SECRET_PATTERNS) {
    if (pattern.test(pack.raw)) {
      refusals.push({
        code,
        message:
          "ticket pack contains a secret-shaped string. Refusing before any runtime sees it. " +
          "Rotate the value, rewrite the pack, and retry.",
      });
    }
  }
  return refusals;
}

/**
 * The repo policy is TypeScript/npm only. If the pack's dependency policy
 * field invites Python, pnpm, or yarn, refuse: a ready ticket should not
 * be asking the agent to violate the repo's stack.
 */
export function checkDependencyPolicy(pack: TicketPack): RefusalEvidence[] {
  const refusals: RefusalEvidence[] = [];
  const policy = pack.dependencyPolicy.toLowerCase();
  // Allow phrases like "no python", "no pnpm" — those are good. Only
  // refuse when the policy *invites* a forbidden tool (e.g. "may add
  // python").
  const invites = /(?:add|install|use|introduce)\s+(?:a\s+)?(?:python|pnpm|yarn)/i;
  if (invites.test(policy)) {
    for (const { code, needle, label } of FORBIDDEN_DEP_KEYWORDS) {
      if (needle.test(policy) && invites.test(policy)) {
        refusals.push({
          code,
          message: `ticket pack invites ${label} tooling, which violates the repo policy (TypeScript/Node/npm only).`,
        });
      }
    }
  }
  return refusals;
}

/**
 * If the operator selected a mode that would skip dispatch (e.g. plan)
 * but the cost band is `high`, we still refuse to escalate silently. The
 * control loop never bumps cost class on its own.
 */
export function checkCostBandSafety(pack: TicketPack): RefusalEvidence[] {
  // No-op for now. The MVP loop honors the pack's costBand verbatim and
  // never escalates. Kept as a hook so future versions can refuse
  // mismatches between requested cost class and adapter capability.
  void pack;
  return [];
}

export function runAllGuardrails(pack: TicketPack): RefusalEvidence[] {
  return [
    ...checkSecrets(pack),
    ...checkDependencyPolicy(pack),
    ...checkCostBandSafety(pack),
  ];
}
