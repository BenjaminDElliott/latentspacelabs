import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_KEYS = [
  "prd_id",
  "title",
  "status",
  "owner",
  "date",
  "related_linear",
  "related_adrs",
  "derived_from",
  "supersedes",
  "superseded_by",
] as const;

export const REQUIRED_NONEMPTY_KEYS = [
  "prd_id",
  "title",
  "status",
  "owner",
  "date",
] as const;

export const ALLOWED_STATUSES = [
  "draft",
  "in-review",
  "approved",
  "superseded",
  "archived",
] as const;

const ROOT_FILENAME_RE = /^root-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const FEATURE_FILENAME_RE = /^(LAT-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const NUMERIC_FILENAME_RE = /^\d{4}-/;

export interface PrdValidationError {
  file: string;
  message: string;
}

export interface PrdValidationResult {
  directory: string;
  filesChecked: string[];
  errors: PrdValidationError[];
}

interface ParsedFrontmatter {
  raw: string;
  fields: Record<string, string | string[] | null>;
}

type PrdKind = "root" | "feature";

interface PrdSummary {
  file: string;
  stem: string;
  kind: PrdKind;
  linearPrefix: string | null;
  fields: Record<string, string | string[] | null>;
}

export async function validatePrdDirectory(
  directory: string,
): Promise<PrdValidationResult> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
    .map((e) => e.name)
    .sort();

  const errors: PrdValidationError[] = [];
  const summaries: PrdSummary[] = [];
  const prdIdOwners = new Map<string, string[]>();

  for (const file of files) {
    if (NUMERIC_FILENAME_RE.test(file)) {
      errors.push({
        file,
        message: `numeric filename 'NNNN-*.md' is not allowed for PRDs; use 'root-<slug>.md' or 'LAT-NN-<slug>.md'`,
      });
      continue;
    }

    let kind: PrdKind | null = null;
    let linearPrefix: string | null = null;
    if (ROOT_FILENAME_RE.test(file)) {
      kind = "root";
    } else {
      const m = FEATURE_FILENAME_RE.exec(file);
      if (m) {
        kind = "feature";
        linearPrefix = m[1]!;
      }
    }

    if (!kind) {
      errors.push({
        file,
        message: `filename does not match 'root-<slug>.md' or 'LAT-NN-<slug>.md'`,
      });
      continue;
    }

    const stem = file.replace(/\.md$/, "");
    const full = join(directory, file);
    const text = await readFile(full, "utf8");
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      errors.push({ file, message: `missing or malformed YAML frontmatter` });
      continue;
    }

    for (const key of REQUIRED_KEYS) {
      if (!(key in parsed.fields)) {
        errors.push({ file, message: `missing required frontmatter key '${key}'` });
      }
    }

    for (const key of REQUIRED_NONEMPTY_KEYS) {
      const value = parsed.fields[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "string" && value.trim() === "") {
        errors.push({ file, message: `frontmatter key '${key}' is empty` });
      } else if (Array.isArray(value) && value.length === 0) {
        errors.push({ file, message: `frontmatter key '${key}' is empty` });
      }
    }

    const prdId = parsed.fields["prd_id"];
    if (typeof prdId === "string" && prdId.trim() !== "") {
      prdIdOwners.set(prdId, [...(prdIdOwners.get(prdId) ?? []), file]);
      if (prdId !== stem) {
        errors.push({
          file,
          message: `frontmatter prd_id '${prdId}' does not match filename stem '${stem}'`,
        });
      }
    }

    const status = parsed.fields["status"];
    if (typeof status === "string" && status.trim() !== "") {
      if (!ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
        errors.push({
          file,
          message: `status '${status}' is not one of ${ALLOWED_STATUSES.join(", ")}`,
        });
      }
    }

    summaries.push({ file, stem, kind, linearPrefix, fields: parsed.fields });
  }

  for (const [id, owners] of prdIdOwners) {
    if (owners.length > 1) {
      errors.push({
        file: owners.join(", "),
        message: `duplicate frontmatter prd_id '${id}'`,
      });
    }
  }

  const knownStems = new Set(summaries.map((s) => s.stem));
  const rootStems = new Set(
    summaries.filter((s) => s.kind === "root").map((s) => s.stem),
  );

  for (const s of summaries) {
    const derivedFrom = s.fields["derived_from"];
    const derivedList = asList(derivedFrom);

    if (s.kind === "root") {
      if (derivedList.length > 0) {
        errors.push({
          file: s.file,
          message: `root PRD must have empty derived_from; found ${derivedList.join(", ")}`,
        });
      }
    } else {
      if (derivedList.length === 0) {
        errors.push({
          file: s.file,
          message: `feature PRD must set derived_from to a root PRD stem`,
        });
      } else {
        for (const ref of derivedList) {
          if (!knownStems.has(ref)) {
            errors.push({
              file: s.file,
              message: `derived_from '${ref}' does not match any PRD file in ${s.file.includes("/") ? "this directory" : "this directory"}`,
            });
          } else if (!rootStems.has(ref)) {
            errors.push({
              file: s.file,
              message: `derived_from '${ref}' is not a root PRD (must be 'root-<slug>')`,
            });
          }
        }
      }

      if (s.linearPrefix) {
        const relatedLinear = asList(s.fields["related_linear"]);
        if (relatedLinear.length > 0 && !relatedLinear.includes(s.linearPrefix)) {
          errors.push({
            file: s.file,
            message: `filename prefix '${s.linearPrefix}' does not appear in related_linear`,
          });
        }
      }
    }
  }

  return { directory, filesChecked: files, errors };
}

function asList(value: string | string[] | null | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v) => v.trim() !== "");
  if (typeof value === "string") {
    return value.trim() === "" ? [] : [value.trim()];
  }
  return [];
}

export function parseFrontmatter(text: string): ParsedFrontmatter | null {
  if (!text.startsWith("---")) return null;
  const afterFirst = text.indexOf("\n");
  if (afterFirst === -1) return null;
  const rest = text.slice(afterFirst + 1);
  const endIdx = rest.indexOf("\n---");
  if (endIdx === -1) return null;
  const raw = rest.slice(0, endIdx);
  return { raw, fields: parseMinimalYaml(raw) };
}

function parseMinimalYaml(raw: string): Record<string, string | string[] | null> {
  const out: Record<string, string | string[] | null> = {};
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1]!;
    const rawValue = match[2]!;
    if (rawValue === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j]!)) {
        items.push(lines[j]!.replace(/^\s+-\s+/, "").trim());
        j += 1;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
      } else {
        out[key] = null;
        i += 1;
      }
      continue;
    }
    out[key] = stripQuotes(rawValue.trim());
    i += 1;
  }
  return out;
}

function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

export function formatResult(result: PrdValidationResult): string {
  if (result.errors.length === 0) {
    return `PRD validation passed for ${result.directory} (${result.filesChecked.length} files)`;
  }
  const lines = [
    `PRD validation FAILED for ${result.directory} (${result.errors.length} error(s))`,
  ];
  for (const e of result.errors) {
    lines.push(`  - ${e.file}: ${e.message}`);
  }
  return lines.join("\n");
}
