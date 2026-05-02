import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUN_ARTIFACT_SCHEMA_VERSION,
  buildRunArtefact,
  formatArtefactCompactRef,
  renderRunArtefactJson,
  type RunArtefactInput,
} from "./run-artifact.js";

function baseInput(overrides: Partial<RunArtefactInput> = {}): RunArtefactInput {
  const start = new Date("2026-05-01T12:00:00.000Z");
  const end = new Date("2026-05-01T12:01:30.000Z");
  return {
    invocation_id: "run_abc123",
    surface: "dispatcher",
    producer: "lat129-dispatcher",
    outcome: "ready_for_review",
    started_at: start,
    ended_at: end,
    ticket_id: "LAT-127",
    branch: "lat-127-foo",
    ...overrides,
  };
}

test("buildRunArtefact: stamps schema version and conservative defaults", () => {
  const a = buildRunArtefact(baseInput());
  assert.equal(a.schema_version, RUN_ARTIFACT_SCHEMA_VERSION);
  assert.equal(a.artefact_class, "operational_log");
  assert.equal(a.training_eligibility, "needs_human_decision");
  assert.equal(a.quality_label, "unknown");
  assert.equal(a.cost_class, "unknown");
  assert.equal(a.risk_level, "unknown");
  assert.equal(a.duration_ms, 90_000);
  assert.equal(a.refusal_message, "");
  assert.equal(a.checks.length, 0);
  assert.equal(a.acceptance_criteria_coverage.length, 0);
});

test("buildRunArtefact: redacts tokens from refusal_message and producer", () => {
  const a = buildRunArtefact(
    baseInput({
      producer: "lat129-dispatcher (lin_api_ABCDEFGHIJ12345 leaked)",
      refusal_message: "live mode required Bearer ghp_1234567890abcdef but got nothing",
    }),
  );
  assert.doesNotMatch(a.producer, /lin_api_/);
  assert.match(a.producer, /<redacted>/);
  assert.doesNotMatch(a.refusal_message, /ghp_/);
  assert.doesNotMatch(a.refusal_message, /Bearer ghp_/);
  assert.match(a.refusal_message, /<redacted>/);
});

test("buildRunArtefact: redacts non-allowlisted URLs from refusal_message", () => {
  const a = buildRunArtefact(
    baseInput({
      refusal_message:
        "would have hit https://api.runpod.io/v2/pod_abcdefghijkl plus https://linear.app/lat/issue/LAT-127",
    }),
  );
  assert.doesNotMatch(a.refusal_message, /api\.runpod\.io/);
  assert.match(a.refusal_message, /<redacted-url>/);
  assert.match(a.refusal_message, /<redacted-pod-id>/);
  // Linear URLs survive
  assert.match(a.refusal_message, /linear\.app\/lat\/issue\/LAT-127/);
});

test("buildRunArtefact: scrubs extra-secret literals from every free-text field", () => {
  const a = buildRunArtefact(
    baseInput({
      sandbox_path: "/work/sandbox-supersecretvalue123",
      runtime_id: "runner-supersecretvalue123",
      refusal_message: "dropped supersecretvalue123 mid-run",
      checks: [
        {
          name: "build supersecretvalue123",
          command: "npm run build supersecretvalue123",
          outcome: "passed",
          durationMs: 100,
          kind: "shell",
          detail: "ok supersecretvalue123",
        },
      ],
      extra_secrets: ["supersecretvalue123"],
    }),
  );
  for (const text of [
    a.sandbox_path ?? "",
    a.runtime_id ?? "",
    a.refusal_message,
    a.checks[0]?.name ?? "",
    a.checks[0]?.command ?? "",
    a.checks[0]?.detail ?? "",
  ]) {
    assert.doesNotMatch(text, /supersecretvalue123/);
  }
});

test("buildRunArtefact: only allows github.com / linear.app pr_url", () => {
  const ok = buildRunArtefact(
    baseInput({ pr_url: "https://github.com/owner/repo/pull/42" }),
  );
  assert.equal(ok.pr_url, "https://github.com/owner/repo/pull/42");

  const linearOk = buildRunArtefact(
    baseInput({ pr_url: "https://linear.app/lat/issue/LAT-127" }),
  );
  assert.equal(linearOk.pr_url, "https://linear.app/lat/issue/LAT-127");

  const dropped = buildRunArtefact(
    baseInput({ pr_url: "https://evil.example.com/pull/42" }),
  );
  assert.equal(dropped.pr_url, null);
});

test("buildRunArtefact: hashes pack content and pre-redaction payload", () => {
  const a = buildRunArtefact(
    baseInput({
      pack_content: "ticket pack body",
      raw_stdout: "stdout text",
      raw_stderr: "stderr text",
      refusal_message: "no problem",
    }),
  );
  assert.match(a.pack_sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.match(a.redaction.pre_redaction_payload_sha256, /^[0-9a-f]{64}$/);
  // A different pack hashes differently.
  const b = buildRunArtefact(baseInput({ pack_content: "different" }));
  assert.notEqual(a.pack_sha256, b.pack_sha256);
});

test("buildRunArtefact: defaults acceptance criteria coverage to unknown placeholders", () => {
  const a = buildRunArtefact(
    baseInput({
      acceptance_criteria: ["AC1: builds", "AC2: tests pass"],
    }),
  );
  assert.equal(a.acceptance_criteria_coverage.length, 2);
  for (const c of a.acceptance_criteria_coverage) {
    assert.equal(c.status, "unknown");
  }
});

test("buildRunArtefact: explicit coverage overrides defaults", () => {
  const a = buildRunArtefact(
    baseInput({
      acceptance_criteria: ["AC1"],
      acceptance_criteria_coverage: [
        { criterion: "AC1", status: "covered" },
        { criterion: "AC2", status: "uncovered" },
      ],
    }),
  );
  assert.deepEqual(
    a.acceptance_criteria_coverage.map((c) => c.status),
    ["covered", "uncovered"],
  );
});

test("buildRunArtefact: redaction metadata records extra-secret count without values", () => {
  const a = buildRunArtefact(
    baseInput({
      refusal_message: "secretA secretB",
      extra_secrets: ["secretA12345", "secretB67890"],
    }),
  );
  assert.equal(a.redaction.extra_secrets_supplied, 2);
  // The artefact serialised to JSON must not contain the literal secret
  // values anywhere — even though they did not match the redaction
  // patterns in the message body, the metadata must not echo them.
  const json = renderRunArtefactJson(a);
  assert.doesNotMatch(json, /secretA12345/);
  assert.doesNotMatch(json, /secretB67890/);
});

test("buildRunArtefact: classifies and operational_log/dataset_candidate is selectable", () => {
  const a = buildRunArtefact(
    baseInput({
      artefact_class: "dataset_candidate",
      training_eligibility: "eligible",
      quality_label: "ready_for_review",
      eligibility_reason: "passed all checks; PR opened; reviewer-validated diff",
    }),
  );
  assert.equal(a.artefact_class, "dataset_candidate");
  assert.equal(a.training_eligibility, "eligible");
  assert.equal(a.quality_label, "ready_for_review");
  assert.match(a.eligibility_reason, /passed all checks/);
});

test("renderRunArtefactJson: stable JSON output (ends with newline)", () => {
  const a = buildRunArtefact(baseInput());
  const out = renderRunArtefactJson(a);
  assert.equal(out.endsWith("\n"), true);
  const parsed = JSON.parse(out);
  assert.equal(parsed.invocation_id, "run_abc123");
});

test("formatArtefactCompactRef: compact, references path and short hash", () => {
  const a = buildRunArtefact(
    baseInput({
      raw_stdout: "anything",
      artefact_class: "dataset_candidate",
      quality_label: "ready_for_review",
    }),
  );
  const ref = formatArtefactCompactRef({
    artefact: a,
    artefactPath: "runs/run_abc123.json",
  });
  assert.match(ref, /runs\/run_abc123\.json/);
  assert.match(ref, /payload-sha256: `[0-9a-f]{12}`/);
  assert.match(ref, /class=dataset/);
  assert.match(ref, /quality=ready_for_review/);
  assert.match(ref, /outcome=ready_for_review/);
});

test("buildRunArtefact: tolerates missing optional fields", () => {
  const a = buildRunArtefact(baseInput({ ticket_id: null, branch: null }));
  assert.equal(a.ticket_id, null);
  assert.equal(a.branch, null);
  assert.equal(a.sandbox_path, null);
  assert.equal(a.provider, null);
  assert.equal(a.changed_files, null);
});

test("buildRunArtefact: sanitises path-like fields without collapsing them", () => {
  const a = buildRunArtefact(
    baseInput({
      sandbox_path: "/tmp/sandbox/lat-127",
      pack_path: "/tmp/lat129-dispatcher-XYZ/lat-127-pack.md",
    }),
  );
  // Paths are not URLs; redactor should leave them intact.
  assert.equal(a.sandbox_path, "/tmp/sandbox/lat-127");
  assert.equal(a.pack_path, "/tmp/lat129-dispatcher-XYZ/lat-127-pack.md");
});

test("buildRunArtefact: scrubs token-shaped substring inside a path", () => {
  const a = buildRunArtefact(
    baseInput({
      sandbox_path: "/tmp/lin_api_ABCDEFGHIJ12345/work",
    }),
  );
  assert.doesNotMatch(a.sandbox_path ?? "", /lin_api_/);
  assert.match(a.sandbox_path ?? "", /<redacted>/);
});

test("buildRunArtefact: empty raw_stdout still produces deterministic payload hash", () => {
  const a = buildRunArtefact(baseInput());
  const b = buildRunArtefact(baseInput());
  assert.equal(
    a.redaction.pre_redaction_payload_sha256,
    b.redaction.pre_redaction_payload_sha256,
  );
});
