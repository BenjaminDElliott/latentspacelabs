import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isForbiddenDotenvFile,
  scanText,
  scanPaths,
  hasBlockingFindings,
  formatResult,
} from "./scan.js";

test("isForbiddenDotenvFile blocks local dotenv but allows templates", () => {
  assert.equal(isForbiddenDotenvFile(".env"), true);
  assert.equal(isForbiddenDotenvFile("pkg/.env"), true);
  assert.equal(isForbiddenDotenvFile(".env.local"), true);
  assert.equal(isForbiddenDotenvFile(".env.production"), true);
  assert.equal(isForbiddenDotenvFile(".env.development.local"), true);

  assert.equal(isForbiddenDotenvFile(".env.example"), false);
  assert.equal(isForbiddenDotenvFile(".env.sample"), false);
  assert.equal(isForbiddenDotenvFile(".env.template"), false);
  assert.equal(isForbiddenDotenvFile("pkg/.env.example"), false);
  assert.equal(isForbiddenDotenvFile("README.md"), false);
});

test("scanText flags obvious literal AWS access key id", () => {
  const findings = scanText({
    file: "leak.ts",
    text: `const id = "AKIAIOSFODNN7EXAMPLE";`, // secret-guard:allow fake fixture
  });
  assert.ok(findings.some((f) => f.rule === "aws-access-key-id"));
});

test("scanText flags GitHub personal token", () => {
  const findings = scanText({
    file: "notes.md",
    text: `token: ghp_abcdefghijklmnopqrstuvwxyz0123456789`, // secret-guard:allow fake fixture
  });
  assert.ok(findings.some((f) => f.rule === "github-token"));
});

test("scanText flags Anthropic-style api key", () => {
  const findings = scanText({
    file: "a.ts",
    text: `ANTHROPIC_API_KEY="sk-ant-api03-abcdefghijklmnop_qrstuvwxyz012345"`, // secret-guard:allow fake fixture
  });
  assert.ok(
    findings.some((f) => f.rule === "anthropic-api-key" || f.rule === "credential-assignment"),
  );
});

test("scanText flags a high-entropy credential assignment", () => {
  const findings = scanText({
    file: ".env.local",
    text: `DATABASE_PASSWORD=ZkQw9vP2nT4rB7yL3xH8uMcEgJdF0sA6`, // secret-guard:allow fake fixture
  });
  assert.ok(findings.some((f) => f.rule === "credential-assignment"));
});

test("scanText allows placeholder values", () => {
  const findings = scanText({
    file: ".env.example",
    text: [
      `ANTHROPIC_API_KEY=your-anthropic-api-key`,
      `DATABASE_PASSWORD=<your-db-password>`,
      `SESSION_SECRET=\${SESSION_SECRET}`,
      `STRIPE_KEY=changeme`,
      `GITHUB_TOKEN=`,
      `SLACK_TOKEN=xxxxxxxxxxxx`,
      `FOO_SECRET=example-secret`,
    ].join("\n"),
  });
  assert.deepEqual(findings, [], formatResult({ findings, filesScanned: 0 }));
});

test("scanText does not flag short or low-entropy values", () => {
  const findings = scanText({
    file: "config.ts",
    text: [
      `API_KEY="abc"`, // too short
      `TOKEN_NAME="mytoken"`, // no digit
      `PORT=3000`, // numeric only, no letters
    ].join("\n"),
  });
  assert.deepEqual(findings, []);
});

test("scanText flags a PEM private key block", () => {
  const findings = scanText({
    file: "id_rsa",
    text: `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...`, // secret-guard:allow fake fixture
  });
  assert.ok(findings.some((f) => f.rule === "private-key-block"));
});

test("scanPaths blocks staged .env file regardless of content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "secret-guard-"));
  try {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "FOO=your-placeholder\n");
    const result = await scanPaths({ files: [envPath] });
    assert.equal(hasBlockingFindings(result), true);
    assert.ok(result.findings.some((f) => f.rule === "dotenv-file-staged"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanPaths allows .env.example templates with placeholder values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "secret-guard-"));
  try {
    const examplePath = join(dir, ".env.example");
    await writeFile(
      examplePath,
      [
        `# Copy to .env.local and fill in real values.`,
        `ANTHROPIC_API_KEY=your-anthropic-api-key`,
        `DATABASE_URL=postgres://user:<password>@localhost/db`,
        `LINEAR_API_TOKEN=\${LINEAR_API_TOKEN}`,
      ].join("\n"),
    );
    const result = await scanPaths({ files: [examplePath] });
    assert.equal(hasBlockingFindings(result), false, formatResult(result));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanPaths surfaces literal credential inside nested path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "secret-guard-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    const leak = join(dir, "src", "client.ts");
    await writeFile(
      leak,
      `const OPENAI_API_KEY = "sk-proj-abcdefghij0123456789klmnopqrstuv";\n`, // secret-guard:allow fake fixture
    );
    const result = await scanPaths({ files: [leak] });
    assert.equal(hasBlockingFindings(result), true);
    assert.ok(result.findings.some((f) => f.file === leak));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inline secret-guard:allow directive suppresses line findings", () => {
  const findings = scanText({
    file: "fixture.ts",
    // The inline directive is the sanctioned escape hatch for fixtures/docs.
    text: `const id = "AKIAIOSFODNN7EXAMPLE"; // secret-guard:allow doc fixture`,
  });
  assert.deepEqual(findings, []);
});

test("formatResult summarises clean and dirty results", () => {
  assert.match(
    formatResult({ findings: [], filesScanned: 3 }),
    /no findings/,
  );
  const dirty = formatResult({
    findings: [
      { rule: "x", severity: "error", file: "a", line: 2, message: "m" },
    ],
    filesScanned: 1,
  });
  assert.match(dirty, /\[error\] x a:2: m/);
});
