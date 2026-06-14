import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseComplexityTag,
  parseReasoningTag,
} from "./linear-client.js";

// --- parseComplexityTag --------------------------------------------------

test("parseComplexityTag: complexity/small → small", () => {
  assert.equal(
    parseComplexityTag(["complexity/small", "ready"]),
    "small",
  );
});

test("parseComplexityTag: complexity/medium → medium", () => {
  assert.equal(
    parseComplexityTag(["complexity/medium"]),
    "medium",
  );
});

test("parseComplexityTag: complexity/large → large", () => {
  assert.equal(
    parseComplexityTag(["complexity/large"]),
    "large",
  );
});

test("parseComplexityTag: no complexity label → unknown", () => {
  assert.equal(
    parseComplexityTag(["ready", "agent-ready"]),
    "unknown",
  );
});

test("parseComplexityTag: unknown complexity value → unknown", () => {
  assert.equal(
    parseComplexityTag(["complexity/huge"]),
    "unknown",
  );
});

test("parseComplexityTag: empty labels → unknown", () => {
  assert.equal(
    parseComplexityTag([]),
    "unknown",
  );
});

test("parseComplexityTag: first match wins (small before medium)", () => {
  assert.equal(
    parseComplexityTag(["complexity/small", "complexity/medium"]),
    "small",
  );
});

test("parseComplexityTag: hyphen variant works", () => {
  assert.equal(
    parseComplexityTag(["complexity-small"]),
    "small",
  );
  assert.equal(
    parseComplexityTag(["complexity-large"]),
    "large",
  );
});

// --- parseReasoningTag ---------------------------------------------------

test("parseReasoningTag: reasoning/implementation → implementation", () => {
  assert.equal(
    parseReasoningTag(["reasoning/implementation"]),
    "implementation",
  );
});

test("parseReasoningTag: reasoning/synthesis → synthesis", () => {
  assert.equal(
    parseReasoningTag(["reasoning/synthesis"]),
    "synthesis",
  );
});

test("parseReasoningTag: reasoning/architecture → architecture", () => {
  assert.equal(
    parseReasoningTag(["reasoning/architecture"]),
    "architecture",
  );
});

test("parseReasoningTag: no reasoning label → unknown", () => {
  assert.equal(
    parseReasoningTag(["ready", "agent-ready"]),
    "unknown",
  );
});

test("parseReasoningTag: empty labels → unknown", () => {
  assert.equal(
    parseReasoningTag([]),
    "unknown",
  );
});

test("parseReasoningTag: unknown reasoning value → unknown", () => {
  assert.equal(
    parseReasoningTag(["reasoning/deep-reasoning"]),
    "unknown",
  );
});

test("parseReasoningTag: hyphen variant works", () => {
  assert.equal(
    parseReasoningTag(["reasoning-implementation"]),
    "implementation",
  );
  assert.equal(
    parseReasoningTag(["reasoning-synthesis"]),
    "synthesis",
  );
  assert.equal(
    parseReasoningTag(["reasoning-architecture"]),
    "architecture",
  );
});

// --- Combined: both tags present -----------------------------------------

test("parseComplexityTag + parseReasoningTag: both extracted from same labels", () => {
  const labels = ["complexity/small", "reasoning/implementation", "ready"];
  assert.equal(parseComplexityTag(labels), "small");
  assert.equal(parseReasoningTag(labels), "implementation");
});

test("parseComplexityTag + parseReasoningTag: no tags → both unknown", () => {
  const labels = ["ready", "agent-ready"];
  assert.equal(parseComplexityTag(labels), "unknown");
  assert.equal(parseReasoningTag(labels), "unknown");
});
