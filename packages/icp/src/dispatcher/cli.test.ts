import { test } from "node:test";
import assert from "node:assert/strict";

import { main } from "./cli.js";

class StringSink {
  buffer = "";
  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
  on(): void {}
  end(): void {}
}

test("cli: --help prints usage and exits 0", async () => {
  const out = new StringSink();
  const err = new StringSink();
  const code = await main(
    ["--help"],
    out as unknown as NodeJS.WritableStream,
    err as unknown as NodeJS.WritableStream,
    {},
    { importMetaUrl: import.meta.url },
  );
  assert.equal(code, 0);
  assert.match(out.buffer, /icp-dispatch-next/);
});

test("cli: bad flag returns exit code 64", async () => {
  const out = new StringSink();
  const err = new StringSink();
  const code = await main(
    ["--nope"],
    out as unknown as NodeJS.WritableStream,
    err as unknown as NodeJS.WritableStream,
    {},
    { importMetaUrl: import.meta.url },
  );
  assert.equal(code, 64);
});

test("cli: --dry-run with full env reports resolution and exits 2", async () => {
  const out = new StringSink();
  const err = new StringSink();
  const code = await main(
    ["--dry-run", "--mode", "mock"],
    out as unknown as NodeJS.WritableStream,
    err as unknown as NodeJS.WritableStream,
    {
      LINEAR_API_KEY: "lin_api_FAKE",
      LAT_DISPATCH_ISSUE: "LAT-126",
    },
    { importMetaUrl: import.meta.url },
  );
  assert.equal(code, 2);
  assert.match(out.buffer, /dispatchIssue:\s+LAT-126/);
  assert.match(out.buffer, /linearKeyPresent:\s+yes/);
  // Never echoes the secret value itself.
  assert.doesNotMatch(out.buffer, /lin_api_FAKE/);
});

test("cli: missing LINEAR_API_KEY without dry-run still produces config_error exit 2", async () => {
  const out = new StringSink();
  const err = new StringSink();
  const code = await main(
    [],
    out as unknown as NodeJS.WritableStream,
    err as unknown as NodeJS.WritableStream,
    { LAT_DISPATCH_ISSUE: "LAT-126" },
    { importMetaUrl: import.meta.url },
  );
  assert.equal(code, 2);
  // Output should be a JSON report; assert key field present.
  assert.match(out.buffer, /"outcome":\s*"config_error"/);
});
