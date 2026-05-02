import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dryRun } from "./dry-run.js";
import { formatSummaryJson, formatSummaryMarkdown } from "./format.js";
import { DEFAULT_SIZE_LIMITS } from "./types.js";

const FIXTURE_PATH = new URL("./__fixtures__/lat-999-noop-pack.md", import.meta.url).pathname;

const FROZEN_NOW = () => new Date("2026-05-02T12:00:00.000Z");

async function inTmp<T>(name: string, body: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "opencode-harness-test-"));
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("dryRun — happy path", () => {
  it("returns ready for the bundled fake ticket pack and never invokes anything", async () => {
    const result = await dryRun(FIXTURE_PATH, { now: FROZEN_NOW });
    assert.equal(result.summary.status, "ready");
    assert.equal(result.summary.endpointInvoked, false);
    assert.equal(result.summary.prOpened, false);
    assert.equal(result.summary.linearWriteBack, false);
    assert.equal(result.summary.ticket, "LAT-999");
    assert.equal(result.summary.branchPlan?.branch, "lat-999-noop-probe");
    assert.equal(result.summary.branchPlan?.prBase, "main");
    assert.ok(
      result.summary.checkPlan.some((c) => c.command === "npm run check"),
      "check plan must include the repo gate",
    );
    assert.deepEqual(result.summary.refusals, []);
  });

  it("renders a Linear-ready markdown summary that does not contain any URL or token shape", async () => {
    const result = await dryRun(FIXTURE_PATH, { now: FROZEN_NOW });
    const md = formatSummaryMarkdown(result.summary);
    assert.match(md, /opencode dry-run summary/);
    assert.match(md, /LAT-999/);
    assert.match(md, /Endpoint invoked:.*no/);
    assert.match(md, /PR opened:.*no/);
    assert.match(md, /Linear write-back:.*no/);
    assert.doesNotMatch(md, /https?:\/\//);
    assert.doesNotMatch(md, /Authorization:/i);
    assert.doesNotMatch(md, /sk-[A-Za-z0-9]{8,}/);
  });

  it("renders a JSON summary with a stable schemaVersion and no endpoint material", async () => {
    const result = await dryRun(FIXTURE_PATH, { now: FROZEN_NOW });
    const json = JSON.parse(formatSummaryJson(result.summary)) as Record<string, unknown>;
    assert.equal(json["schemaVersion"], "1.0.0");
    assert.equal(json["endpointInvoked"], false);
    assert.equal(json["prOpened"], false);
    assert.equal(json["linearWriteBack"], false);
    assert.equal(typeof json["generatedAt"], "string");
  });
});

describe("dryRun — refusal modes", () => {
  it("refuses an unreadable pack with harness_error", async () => {
    const result = await dryRun("/nonexistent/does-not-exist.md", { now: FROZEN_NOW });
    assert.equal(result.summary.status, "harness_error");
    assert.ok(result.summary.refusals.some((r) => r.code === "pack_unreadable"));
    assert.equal(result.summary.endpointInvoked, false);
  });

  it("refuses an ambiguous pack as needs_clarification (multiple validation errors)", async () => {
    const ambiguous = `# Pack\n\n## Header\n\n- **Linear ID:** LAT-1\n- **Pack version:** 1\n- **Cost band:** TBD\n- **Risk level:** TBD\n- **Readiness status:** ready\n\n## Goal\n\n\n\n## Acceptance criteria\n\n\n\n## Constraints\n\n\n\n## Expected checks\n\n\n\n## Branch / PR rules\n\n`;
    await inTmp("ambiguous.md", ambiguous, async (path) => {
      const result = await dryRun(path, { now: FROZEN_NOW });
      assert.equal(result.summary.status, "needs_clarification");
      assert.ok(result.summary.refusals.length >= 1);
      assert.equal(result.summary.endpointInvoked, false);
      assert.equal(result.summary.prOpened, false);
    });
  });

  it("refuses an oversized pack as too_large (file count over limit)", async () => {
    const limits = { ...DEFAULT_SIZE_LIMITS, maxFilesInScope: 2 };
    const tooMany = `# Pack

## Header

- **Linear ID:** LAT-77
- **Pack version:** 1
- **Planner run / source:** test
- **Cost band:** medium
- **Risk level:** medium
- **Readiness status:** ready

## Goal

Edit several files.

## Acceptance criteria

- [ ] all files updated.

## Constraints

- **Files in scope (allowlist):**
  - packages/a/src/a.ts
  - packages/a/src/b.ts
  - packages/a/src/c.ts
- **Files / paths forbidden:** .github/workflows/**
- **Dependency policy:** no new deps.

## Expected checks

- [ ] \`npm run check\` passes.

## Branch / PR rules

- **Branch:** \`lat-77-edit-many\`
- **PR title prefix:** \`LAT-77:\`
- **PR base:** \`main\`
`;
    await inTmp("too-large.md", tooMany, async (path) => {
      const result = await dryRun(path, { now: FROZEN_NOW, sizeLimits: limits });
      assert.equal(result.summary.status, "too_large");
      assert.ok(
        result.summary.refusals.some((r) => r.code === "too_many_files_in_scope"),
      );
      assert.equal(result.summary.endpointInvoked, false);
      assert.equal(result.summary.prOpened, false);
    });
  });

  it("refuses a pack that embeds a secret-shaped value", async () => {
    const leaky = `# Pack

## Header

- **Linear ID:** LAT-88
- **Pack version:** 1
- **Planner run / source:** test
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal

Touch a file.

## Acceptance criteria

- [ ] file touched.

## Constraints

- **Files in scope (allowlist):**
  - packages/x/src/index.ts
- **Files / paths forbidden:** .github/workflows/**
- **Dependency policy:** no new deps.
- **Other constraints:** uses endpoint http://127.0.0.1:8080/v1/chat for the model.

## Expected checks

- [ ] \`npm run check\` passes.

## Branch / PR rules

- **Branch:** \`lat-88-touch\`
- **PR title prefix:** \`LAT-88:\`
- **PR base:** \`main\`
`;
    await inTmp("leaky.md", leaky, async (path) => {
      const result = await dryRun(path, { now: FROZEN_NOW });
      assert.equal(result.summary.status, "needs_clarification");
      assert.ok(result.summary.refusals.some((r) => r.code === "secret_url_http"));
    });
  });

  it("propagates pack-declared blocked status without invoking anything", async () => {
    const blocked = `# Pack

## Header

- **Linear ID:** LAT-55
- **Pack version:** 1
- **Planner run / source:** test
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** blocked

## Goal

Touch a file.

## Acceptance criteria

- [ ] file touched.

## Constraints

- **Files in scope (allowlist):**
  - packages/x/src/index.ts
- **Files / paths forbidden:** .github/workflows/**
- **Dependency policy:** no new deps.

## Expected checks

- [ ] \`npm run check\` passes.

## Branch / PR rules

- **Branch:** \`lat-55-touch\`
- **PR title prefix:** \`LAT-55:\`
- **PR base:** \`main\`
`;
    await inTmp("blocked.md", blocked, async (path) => {
      const result = await dryRun(path, { now: FROZEN_NOW });
      assert.equal(result.summary.status, "blocked");
      assert.equal(result.summary.endpointInvoked, false);
    });
  });
});
