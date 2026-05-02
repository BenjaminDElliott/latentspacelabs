import { test } from "node:test";
import assert from "node:assert/strict";

import { redactOutput } from "./redact.js";

test("redactOutput: scrubs Linear-shaped tokens", () => {
  const input = "Authorization: lin_api_ABCDEFGHIJ12345 sample";
  const out = redactOutput(input);
  assert.match(out, /<redacted>/);
  assert.doesNotMatch(out, /lin_api_ABCDEFGHIJ12345/);
});

test("redactOutput: scrubs GitHub PAT, OpenAI, Anthropic, Bearer", () => {
  const out = redactOutput(
    [
      "ghp_zzzzzzzzzzzzzzzzzzz",
      "github_pat_AAAAAAAA",
      "sk-ant-api03_XYZ",
      "sk-1234567890abcdef1234567890",
      "Bearer abc.def.ghi",
    ].join("\n"),
  );
  assert.doesNotMatch(out, /ghp_/);
  assert.doesNotMatch(out, /github_pat_/);
  assert.doesNotMatch(out, /sk-/);
  assert.doesNotMatch(out, /Bearer abc\.def/);
});

test("redactOutput: scrubs RunPod pod ids", () => {
  const out = redactOutput("Connecting to pod_abcdef1234567890");
  assert.match(out, /<redacted-pod-id>/);
  assert.doesNotMatch(out, /pod_abcdef1234567890/);
});

test("redactOutput: collapses non-Linear URLs and keeps linear.app", () => {
  const out = redactOutput(
    "ping https://api.runpod.io/v2/abc see https://linear.app/lat/issue/LAT-1 next",
  );
  assert.match(out, /<redacted-url>/);
  assert.match(out, /https:\/\/linear\.app\/lat\/issue\/LAT-1/);
});

test("redactOutput: scrubs literal extra secret values", () => {
  const out = redactOutput(
    "key is supersecretvalue123 inside",
    { extraSecrets: ["supersecretvalue123"] },
  );
  assert.match(out, /<redacted>/);
  assert.doesNotMatch(out, /supersecretvalue123/);
});

test("redactOutput: returns empty string for empty input", () => {
  assert.equal(redactOutput(""), "");
});

test("redactOutput: ignores tiny extraSecrets to avoid global noise", () => {
  // Less than 8 chars — would be too easy to falsely match. We must NOT
  // replace ordinary tokens just because a 3-char secret happens to be
  // a substring.
  const out = redactOutput("the cat sat", { extraSecrets: ["cat"] });
  assert.equal(out, "the cat sat");
});
