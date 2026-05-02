import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateTicketPack } from "./validate.js";

function packBuilder(overrides: {
  linearId?: string;
  branch?: string;
  prTitlePrefix?: string;
  prBase?: string;
  filesInScope?: string;
  filesForbidden?: string;
  expectedCheck?: string;
  acceptance?: string;
  goal?: string;
  extra?: string;
} = {}): string {
  const linearId = overrides.linearId ?? "LAT-42";
  const branch = overrides.branch ?? "lat-42-touch-file";
  const prTitlePrefix = overrides.prTitlePrefix ?? "LAT-42:";
  const prBase = overrides.prBase ?? "main";
  const filesInScope = overrides.filesInScope ?? "  - packages/foo/src/index.ts";
  const filesForbidden = overrides.filesForbidden ?? ".github/workflows/**, docs/decisions/**";
  const expectedCheck = overrides.expectedCheck ?? "- [ ] `npm run check` passes.";
  const acceptance = overrides.acceptance ?? "- [ ] file is touched.";
  const goal = overrides.goal ?? "Touch one file.";
  const extra = overrides.extra ?? "";

  return `# opencode Ticket Pack: tiny

## Header

- **Linear ID:** ${linearId}
- **Pack version:** 1
- **Planner run / source:** unit test
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal

${goal}

## Acceptance criteria

${acceptance}

## Constraints

- **Files in scope (allowlist):**
${filesInScope}
- **Files / paths forbidden:** ${filesForbidden}
- **Dependency policy:** no new deps.
${extra}

## Expected checks

${expectedCheck}

## Branch / PR rules

- **Branch:** \`${branch}\`
- **PR title prefix:** \`${prTitlePrefix}\`
- **PR base:** \`${prBase}\`
`;
}

describe("validateTicketPack", () => {
  it("accepts a well-formed minimal pack", () => {
    const result = validateTicketPack(packBuilder(), "/tmp/p.md");
    const errs = result.findings.filter((f) => f.severity === "error");
    assert.deepEqual(errs, [], `unexpected errors: ${JSON.stringify(errs)}`);
    assert.equal(result.ok, true);
  });

  it("rejects malformed Linear ID", () => {
    const result = validateTicketPack(packBuilder({ linearId: "LATTE-1" }), "/tmp/p.md");
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((f) => f.code === "linear_id_shape" || f.code === "parse_error"),
    );
  });

  it("rejects branch that does not match the Linear ID", () => {
    const result = validateTicketPack(
      packBuilder({ branch: "lat-99-other-thing" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "branch_ticket_mismatch"));
  });

  it("rejects PR base that is not main", () => {
    const result = validateTicketPack(
      packBuilder({ prBase: "develop" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "pr_base_invalid"));
  });

  it("rejects missing repo gate check", () => {
    const result = validateTicketPack(
      packBuilder({ expectedCheck: "- [ ] vibes pass." }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "missing_repo_gate_check"));
  });

  it("rejects empty allowlist", () => {
    const result = validateTicketPack(
      packBuilder({ filesInScope: "" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some(
        (f) => f.code === "files_in_scope_empty" || f.code === "parse_error",
      ),
    );
  });

  it("rejects allowlist that touches a forbidden root", () => {
    const result = validateTicketPack(
      packBuilder({ filesInScope: "  - .github/workflows/icp.yml" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((f) => f.code === "allowlist_in_forbidden_root"),
    );
  });

  it("rejects pack containing a local endpoint URL", () => {
    const result = validateTicketPack(
      packBuilder({ extra: "- **Note:** see http://127.0.0.1:8080/v1 for the model" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "secret_url_http"));
  });

  it("rejects pack containing an Authorization header", () => {
    const result = validateTicketPack(
      packBuilder({ extra: "- **Note:** Authorization: Bearer abcd1234abcd1234abcd1234" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some(
        (f) => f.code === "secret_authorization_header" || f.code === "secret_bearer",
      ),
    );
  });

  it("rejects empty acceptance criteria", () => {
    const result = validateTicketPack(
      packBuilder({ acceptance: "" }),
      "/tmp/p.md",
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((f) => f.code === "acceptance_criteria_empty"),
    );
  });
});
