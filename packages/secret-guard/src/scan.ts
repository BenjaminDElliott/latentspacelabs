import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type Severity = "error" | "warn";

export interface SecretFinding {
  rule: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
}

export interface ScanResult {
  findings: SecretFinding[];
  filesScanned: number;
}

const ALLOWED_DOTENV_SUFFIXES = new Set<string>([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
]);

/**
 * Returns true when the path's basename looks like a real local dotenv file
 * (`.env`, `.env.local`, `.env.production`, …) rather than a committed template.
 */
export function isForbiddenDotenvFile(path: string): boolean {
  const name = basename(path);
  if (ALLOWED_DOTENV_SUFFIXES.has(name)) return false;
  if (name === ".env") return true;
  return /^\.env\.[A-Za-z0-9._-]+$/.test(name);
}

interface LiteralPattern {
  rule: string;
  regex: RegExp;
  describe: string;
}

/**
 * Patterns for high-signal, widely-documented secret formats. We intentionally
 * keep this list tight to minimise false positives; placeholder detection below
 * handles generic `KEY=...` lines.
 */
const LITERAL_PATTERNS: LiteralPattern[] = [
  {
    rule: "aws-access-key-id",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    describe: "AWS access key id",
  },
  {
    rule: "github-token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    describe: "GitHub personal / OAuth / server / user / refresh token",
  },
  {
    rule: "slack-token",
    regex: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
    describe: "Slack token",
  },
  {
    rule: "openai-api-key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
    describe: "OpenAI API key",
  },
  {
    rule: "anthropic-api-key",
    regex: /\bsk-ant-(?:api|admin)[0-9]{2}-[A-Za-z0-9_-]{20,}\b/,
    describe: "Anthropic API key",
  },
  {
    rule: "google-api-key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    describe: "Google API key",
  },
  {
    rule: "stripe-live-secret",
    regex: /\bsk_live_[0-9A-Za-z]{20,}\b/,
    describe: "Stripe live secret key",
  },
  {
    rule: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
    describe: "PEM private key block",
  },
];

const ASSIGNMENT_REGEX =
  /(?:^|[\s,;{(])([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|CREDENTIALS)[A-Z0-9_]*)\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^"'\s,;}\)]+))/;

/**
 * Values we treat as obvious placeholders — never a real secret. Comparison is
 * case-insensitive and done after trimming surrounding punctuation.
 */
const PLACEHOLDER_VALUES = new Set<string>([
  "",
  "changeme",
  "change-me",
  "change_me",
  "example",
  "placeholder",
  "secret",
  "token",
  "password",
  "xxx",
  "xxxx",
  "xxxxx",
  "todo",
  "tbd",
  "redacted",
  "null",
  "none",
  "undefined",
  "dummy",
  "fake",
  "test",
]);

function isPlaceholderValue(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (/^<.+>$/.test(trimmed)) return true;
  if (/^\$\{[^}]+\}$/.test(trimmed)) return true;
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) return true;
  if (/^(your[-_]|my[-_]|sample[-_]|example[-_]|placeholder[-_])/.test(lower)) return true;
  if (/^x{3,}$/i.test(trimmed)) return true;
  if (/^\*{3,}$/.test(trimmed)) return true;
  if (/^[.]{3,}$/.test(trimmed)) return true;
  return false;
}

function hasSecretCharacteristics(value: string): boolean {
  if (value.length < 20) return false;
  // Must contain at least one digit AND at least one letter to be a credible
  // high-entropy token (cuts down on English word false positives).
  if (!/[A-Za-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  return true;
}

export interface ScanTextOptions {
  file: string;
  text: string;
}

/**
 * Escape hatch for test fixtures and documentation that legitimately need to
 * include example credential strings. Put `secret-guard:allow` on the same line
 * (typically inside a comment) to silence findings for that line. Prefer this
 * over loosening the patterns. Use only in `*.test.*`, `__fixtures__/`, or docs.
 */
const ALLOW_LINE_DIRECTIVE = /secret-guard:allow/;

export function scanText({ file, text }: ScanTextOptions): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    if (ALLOW_LINE_DIRECTIVE.test(line)) continue;
    for (const pat of LITERAL_PATTERNS) {
      if (pat.regex.test(line)) {
        findings.push({
          rule: pat.rule,
          severity: "error",
          file,
          line: lineNo,
          message: `looks like a literal ${pat.describe}`,
        });
      }
    }
    const m = ASSIGNMENT_REGEX.exec(line);
    if (m) {
      const keyName = m[1] ?? "";
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (!isPlaceholderValue(value) && hasSecretCharacteristics(value)) {
        findings.push({
          rule: "credential-assignment",
          severity: "error",
          file,
          line: lineNo,
          message: `variable ${keyName} appears to hold a literal credential (>=20 chars, mixed digits/letters, no placeholder marker)`,
        });
      }
    }
  }
  return dedupeFindings(findings);
}

function dedupeFindings(findings: SecretFinding[]): SecretFinding[] {
  const seen = new Set<string>();
  const out: SecretFinding[] = [];
  for (const f of findings) {
    const key = `${f.file}:${f.line ?? 0}:${f.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export interface ScanPathsOptions {
  files: string[];
  readFile?: (path: string) => Promise<string>;
}

export async function scanPaths(options: ScanPathsOptions): Promise<ScanResult> {
  const reader = options.readFile ?? ((p: string) => readFile(p, "utf8"));
  const findings: SecretFinding[] = [];
  let filesScanned = 0;
  for (const file of options.files) {
    if (isForbiddenDotenvFile(file)) {
      findings.push({
        rule: "dotenv-file-staged",
        severity: "error",
        file,
        message:
          "local .env files must not be committed; use .env.example / .env.template for shareable placeholders",
      });
      // Do not open the file — it may be missing on disk, and we block regardless.
      continue;
    }
    let text: string;
    try {
      text = await reader(file);
    } catch {
      continue;
    }
    filesScanned++;
    findings.push(...scanText({ file, text }));
  }
  return { findings, filesScanned };
}

export function hasBlockingFindings(result: ScanResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}

export function formatResult(result: ScanResult): string {
  if (result.findings.length === 0) {
    return `secret-guard: scanned ${result.filesScanned} file(s), no findings.`;
  }
  const lines: string[] = [];
  lines.push(`secret-guard: ${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    const loc = f.line ? `:${f.line}` : "";
    lines.push(`  [${f.severity}] ${f.rule} ${f.file}${loc}: ${f.message}`);
  }
  return lines.join("\n");
}
