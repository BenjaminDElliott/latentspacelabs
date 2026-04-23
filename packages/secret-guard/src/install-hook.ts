#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const HOOK_MARKER = "# latentspacelabs:secret-guard:pre-commit";
const HOOK_SCRIPT = `#!/usr/bin/env sh
${HOOK_MARKER}
# Installed by @latentspacelabs/secret-guard. Blocks staged .env files and
# obvious literal API keys/tokens. See docs/process/secret-commit-guardrails.md.
# To temporarily bypass (use sparingly): git commit --no-verify
set -e
exec npm run --silent secret-guard:staged
`;

interface Args {
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  let force = false;
  let help = false;
  for (const a of argv) {
    if (a === "--force") force = true;
    else if (a === "--help" || a === "-h") help = true;
  }
  return { force, help };
}

function usage(): string {
  return [
    "Usage: secret-guard-install [--force]",
    "",
    "Installs a local git pre-commit hook that runs secret-guard on staged",
    "files. Safe to re-run: refuses to overwrite an existing hook unless",
    "--force is passed (existing hook is backed up to pre-commit.bak).",
    "",
  ].join("\n");
}

function gitDir(): string {
  const r = spawnSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git rev-parse --git-dir failed: ${r.stderr.trim()}`);
  }
  return resolve(r.stdout.trim());
}

function configuredHooksPath(): string | null {
  const r = spawnSync("git", ["config", "--get", "core.hooksPath"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const v = r.stdout.trim();
  return v.length > 0 ? v : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const custom = configuredHooksPath();
  const hooksDir = custom ? resolve(custom) : join(gitDir(), "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");

  if (await exists(hookPath)) {
    const existing = await readFile(hookPath, "utf8");
    if (existing.includes(HOOK_MARKER)) {
      await writeFile(hookPath, HOOK_SCRIPT, "utf8");
      await chmod(hookPath, 0o755);
      process.stdout.write(`secret-guard: refreshed existing hook at ${hookPath}\n`);
      return;
    }
    if (!args.force) {
      process.stderr.write(
        `secret-guard: refusing to overwrite existing ${hookPath}. ` +
          `Inspect it, then re-run with --force to back up and replace.\n`,
      );
      process.exit(1);
    }
    await writeFile(`${hookPath}.bak`, existing, "utf8");
    process.stdout.write(`secret-guard: backed up existing hook to ${hookPath}.bak\n`);
  }

  await writeFile(hookPath, HOOK_SCRIPT, "utf8");
  await chmod(hookPath, 0o755);
  process.stdout.write(
    `secret-guard: installed pre-commit hook at ${hookPath}\n` +
      (custom
        ? `  (core.hooksPath = ${custom} — the hook lives there, not in .git/hooks)\n`
        : ""),
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`secret-guard-install: ${(err as Error).message}\n`);
  process.exit(2);
});
