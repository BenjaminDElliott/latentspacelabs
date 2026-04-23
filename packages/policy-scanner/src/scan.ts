import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

export type Severity = "error" | "warn";

export interface PolicyFinding {
  rule: string;
  severity: Severity;
  file: string;
  message: string;
}

export interface PolicyConfig {
  allowedPackageManagerFiles: string[];
  allowedPythonPaths: string[];
  sharedMarkdownHubs: string[];
  markdownIndexTableMinRows: number;
  markdownIndexListMinLinks: number;
  ignoreDirectories: string[];
  pythonToolingDirectories: string[];
}

export const DEFAULT_CONFIG: PolicyConfig = {
  allowedPackageManagerFiles: [],
  allowedPythonPaths: [],
  sharedMarkdownHubs: [
    "docs/README.md",
    "docs/process/README.md",
    "docs/decisions/README.md",
    "docs/prds/README.md",
  ],
  markdownIndexTableMinRows: 3,
  markdownIndexListMinLinks: 6,
  ignoreDirectories: [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    ".cache",
  ],
  pythonToolingDirectories: [
    "scripts",
    "tools",
    "bin",
    ".github/scripts",
    ".github/workflows",
  ],
};

const FORBIDDEN_PACKAGE_MANAGER_FILES = new Set<string>([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".pnpmfile.cjs",
  "yarn.lock",
  ".yarnrc",
  ".yarnrc.yml",
]);

export interface ScanOptions {
  root: string;
  config?: Partial<PolicyConfig>;
}

export interface ScanResult {
  root: string;
  findings: PolicyFinding[];
  filesScanned: number;
}

interface ResolvedConfig extends PolicyConfig {}

function resolveConfig(partial: Partial<PolicyConfig> | undefined): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    allowedPackageManagerFiles: [
      ...DEFAULT_CONFIG.allowedPackageManagerFiles,
      ...(partial?.allowedPackageManagerFiles ?? []),
    ],
    allowedPythonPaths: [
      ...DEFAULT_CONFIG.allowedPythonPaths,
      ...(partial?.allowedPythonPaths ?? []),
    ],
    sharedMarkdownHubs: partial?.sharedMarkdownHubs ?? DEFAULT_CONFIG.sharedMarkdownHubs,
    ignoreDirectories: [
      ...DEFAULT_CONFIG.ignoreDirectories,
      ...(partial?.ignoreDirectories ?? []),
    ],
    pythonToolingDirectories:
      partial?.pythonToolingDirectories ?? DEFAULT_CONFIG.pythonToolingDirectories,
  };
}

export async function loadConfigFromFile(
  root: string,
): Promise<Partial<PolicyConfig> | undefined> {
  const path = join(root, ".repo-policy.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`${path}: top-level value must be a JSON object`);
    }
    return parsed as Partial<PolicyConfig>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function scanRepository(options: ScanOptions): Promise<ScanResult> {
  const config = resolveConfig(options.config);
  const findings: PolicyFinding[] = [];
  const files: string[] = [];
  await walk(options.root, options.root, config, files);

  for (const relPath of files) {
    const name = basename(relPath);
    if (FORBIDDEN_PACKAGE_MANAGER_FILES.has(name)) {
      if (!config.allowedPackageManagerFiles.includes(relPath)) {
        findings.push({
          rule: "package-manager",
          severity: "error",
          file: relPath,
          message: `${name} is not allowed (repo uses npm workspaces per ADR-0011 / LAT-25). Remove the file or add '${relPath}' to .repo-policy.json → allowedPackageManagerFiles with a written exception.`,
        });
      }
    }
  }

  for (const relPath of files) {
    if (!relPath.endsWith(".py")) continue;
    if (config.allowedPythonPaths.includes(relPath)) continue;
    if (!isPythonToolingPath(relPath, config)) continue;
    findings.push({
      rule: "python-tooling",
      severity: "error",
      file: relPath,
      message: `Python tooling is not allowed here. ADR-0011 / coding-agent-preflight.md pin repo tooling to TypeScript on Node.js. If this script is genuinely required, add '${relPath}' to .repo-policy.json → allowedPythonPaths with a linked ADR.`,
    });
  }

  for (const hub of config.sharedMarkdownHubs) {
    const abs = join(options.root, hub);
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const hit = detectMarkdownIndexHotspot(text, {
      minTableRows: config.markdownIndexTableMinRows,
      minListLinks: config.markdownIndexListMinLinks,
    });
    if (hit) {
      findings.push({
        rule: "markdown-index-hotspot",
        severity: "warn",
        file: hub,
        message: `Shared hub looks like a hand-maintained index (${hit}). Hand-maintained indexes in shared hubs were removed in LAT-33; rely on directory listings instead.`,
      });
    }
  }

  return { root: options.root, findings, filesScanned: files.length };
}

async function walk(
  root: string,
  dir: string,
  config: ResolvedConfig,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (config.ignoreDirectories.includes(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, abs, config, out);
    } else if (entry.isFile()) {
      out.push(toRepoRelative(root, abs));
    } else if (entry.isSymbolicLink()) {
      try {
        const target = await stat(abs);
        if (target.isFile()) out.push(toRepoRelative(root, abs));
      } catch {
        // dangling symlink; skip
      }
    }
  }
}

function toRepoRelative(root: string, abs: string): string {
  const rel = relative(root, abs);
  return rel.split(sep).join("/");
}

function isPythonToolingPath(relPath: string, config: ResolvedConfig): boolean {
  if (!relPath.includes("/")) return true;
  for (const dir of config.pythonToolingDirectories) {
    if (relPath === dir || relPath.startsWith(`${dir}/`)) return true;
  }
  if (relPath.startsWith("packages/")) return true;
  return false;
}

interface MarkdownIndexDetectOptions {
  minTableRows: number;
  minListLinks: number;
}

export function detectMarkdownIndexHotspot(
  markdown: string,
  opts: MarkdownIndexDetectOptions,
): string | null {
  const lines = markdown.split("\n");
  const linkRows = countTableDataRows(lines);
  if (linkRows >= opts.minTableRows) {
    return `Markdown table with ${linkRows} rows containing links`;
  }
  const linkBullets = countConsecutiveLinkBullets(lines);
  if (linkBullets >= opts.minListLinks) {
    return `bulleted list with ${linkBullets} consecutive link entries`;
  }
  return null;
}

function countTableDataRows(lines: string[]): number {
  let maxRows = 0;
  let i = 0;
  while (i < lines.length) {
    const header = lines[i] ?? "";
    const sep = lines[i + 1] ?? "";
    if (isTableRow(header) && isTableSeparator(sep)) {
      let j = i + 2;
      let linkRows = 0;
      while (j < lines.length && isTableRow(lines[j] ?? "")) {
        if (rowContainsMarkdownLink(lines[j] ?? "")) linkRows += 1;
        j += 1;
      }
      if (linkRows > maxRows) maxRows = linkRows;
      i = j;
    } else {
      i += 1;
    }
  }
  return maxRows;
}

const MARKDOWN_LINK_RE = /\[[^\]]+\]\([^)]+\)/;

function rowContainsMarkdownLink(line: string): boolean {
  return MARKDOWN_LINK_RE.test(line);
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cellCount = trimmed.split("|").length - 2;
  return cellCount >= 2;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const inner = trimmed.slice(1, -1);
  const cells = inner.split("|").map((c) => c.trim());
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

const LINK_BULLET_RE = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)/;

function countConsecutiveLinkBullets(lines: string[]): number {
  let best = 0;
  let run = 0;
  for (const line of lines) {
    if (LINK_BULLET_RE.test(line)) {
      run += 1;
      if (run > best) best = run;
    } else if (line.trim() === "") {
      continue;
    } else {
      run = 0;
    }
  }
  return best;
}

export function formatResult(result: ScanResult): string {
  if (result.findings.length === 0) {
    return `policy-scan: OK (${result.filesScanned} files scanned in ${result.root})`;
  }
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warns = result.findings.filter((f) => f.severity === "warn").length;
  const lines = [
    `policy-scan: ${errors} error(s), ${warns} warn(s) across ${result.filesScanned} files in ${result.root}`,
  ];
  for (const f of result.findings) {
    lines.push(`  [${f.severity}] ${f.rule} — ${f.file}: ${f.message}`);
  }
  return lines.join("\n");
}

export function hasBlockingFindings(result: ScanResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
