#!/usr/bin/env node
import { resolve } from "node:path";
import { validatePrdDirectory, formatResult } from "./validate.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = resolve(args[0] ?? "docs/prds");
  const result = await validatePrdDirectory(dir);
  const output = formatResult(result);
  if (result.errors.length === 0) {
    process.stdout.write(output + "\n");
    process.exit(0);
  }
  process.stderr.write(output + "\n");
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`prd-validate: ${(err as Error).message}\n`);
  process.exit(2);
});
