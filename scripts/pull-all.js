#!/usr/bin/env node
/**
 * pull-all: pull live code then live JSON into theme/, recording pull state
 * for both. Node runner (not an npm chain) so exit codes and any future
 * flags propagate correctly to both phases.
 */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseArgs } = require('./lib/args');

// No flags today — strict parser still rejects typos like `--json` here
// (use pull-json-live for a json-only pull).
const ARG_SPEC = { usage: 'node scripts/pull-all.js', flags: {} };

const PULL = path.join(__dirname, 'pull.js');

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PULL, ...args], { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`[pull-all] failed to launch: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

(async () => {
  parseArgs(process.argv.slice(2), ARG_SPEC);

  console.log('\x1b[36m[pull-all] phase 1/2: code\x1b[0m');
  const codeStatus = await runNode(['--target', 'live']);
  if (codeStatus !== 0) {
    console.error(`\x1b[31m[pull-all] code pull failed (exit ${codeStatus}) — JSON phase not attempted.\x1b[0m`);
    process.exit(codeStatus);
  }

  console.log('\x1b[36m[pull-all] phase 2/2: json\x1b[0m');
  const jsonStatus = await runNode(['--target', 'live', '--json']);
  if (jsonStatus !== 0) {
    console.error(`\x1b[31m[pull-all] json pull failed (exit ${jsonStatus}).\x1b[0m`);
    process.exit(jsonStatus);
  }

  console.log('\x1b[32m[pull-all] both phases complete. Review with `git diff theme/`.\x1b[0m');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
