import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_KEYS = [
  "id",
  "title",
  "status",
  "date",
  "decision_makers",
] as const;

const FILENAME_RE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ID_RE = /^ADR-(\d{4})$/;

export interface AdrValidationError {
  file: string;
  message: string;
}

export interface AdrValidationResult {
  directory: string;
  filesChecked: string[];
  errors: AdrValidationError[];
}

interface ParsedFrontmatter {
  raw: string;
  fields: Record<string, string | string[] | null>;
}

export async function validateAdrDirectory(
  directory: string,
): Promise<AdrValidationResult> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
    .map((e) => e.name)
    .sort();

  const errors: AdrValidationError[] = [];
  const prefixOwners = new Map<string, string[]>();
  const idOwners = new Map<string, string[]>();

  for (const file of files) {
    const filenameMatch = FILENAME_RE.exec(file);
    if (!filenameMatch) {
      errors.push({
        file,
        message: `filename does not match NNNN-title-with-dashes.md`,
      });
      continue;
    }
    const prefix = filenameMatch[1]!;
    prefixOwners.set(prefix, [...(prefixOwners.get(prefix) ?? []), file]);

    const full = join(directory, file);
    const text = await readFile(full, "utf8");
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      errors.push({ file, message: `missing or malformed YAML frontmatter` });
      continue;
    }

    for (const key of REQUIRED_KEYS) {
      const value = parsed.fields[key];
      if (value === undefined || value === null) {
        errors.push({ file, message: `missing required frontmatter key '${key}'` });
        continue;
      }
      if (typeof value === "string" && value.trim() === "") {
        errors.push({ file, message: `frontmatter key '${key}' is empty` });
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        errors.push({ file, message: `frontmatter key '${key}' is empty` });
      }
    }

    const idRaw = parsed.fields["id"];
    if (typeof idRaw === "string") {
      const idMatch = ID_RE.exec(idRaw);
      if (!idMatch) {
        errors.push({
          file,
          message: `frontmatter id '${idRaw}' does not match ADR-NNNN`,
        });
      } else {
        const idPrefix = idMatch[1]!;
        idOwners.set(idRaw, [...(idOwners.get(idRaw) ?? []), file]);
        if (idPrefix !== prefix) {
          errors.push({
            file,
            message: `filename prefix '${prefix}' does not match frontmatter id '${idRaw}'`,
          });
        }
      }
    }
  }

  for (const [prefix, owners] of prefixOwners) {
    if (owners.length > 1) {
      errors.push({
        file: owners.join(", "),
        message: `duplicate filename prefix '${prefix}'`,
      });
    }
  }
  for (const [id, owners] of idOwners) {
    if (owners.length > 1) {
      errors.push({
        file: owners.join(", "),
        message: `duplicate frontmatter id '${id}'`,
      });
    }
  }

  return { directory, filesChecked: files, errors };
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

export function formatResult(result: AdrValidationResult): string {
  if (result.errors.length === 0) {
    return `ADR validation passed for ${result.directory} (${result.filesChecked.length} files)`;
  }
  const lines = [
    `ADR validation FAILED for ${result.directory} (${result.errors.length} error(s))`,
  ];
  for (const e of result.errors) {
    lines.push(`  - ${e.file}: ${e.message}`);
  }
  return lines.join("\n");
}
