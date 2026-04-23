#!/usr/bin/env node
/**
 * Bin wrapper for the LAT-67 Direct-Path Anthropic proof.
 *
 * Kept thin so the testable entrypoint (`cliMain`) can be unit-tested
 * without spawning a child process. This file is the compiled shim that
 * `bin/direct-anthropic-proof` resolves to at install time.
 */
import { cliMain } from "./direct-anthropic-proof.js";

async function main(): Promise<void> {
  const code = await cliMain(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: () => process.cwd(),
    env: process.env,
  });
  process.exit(code);
}

void main();
