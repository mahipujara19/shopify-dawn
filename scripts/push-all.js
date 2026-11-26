#!/usr/bin/env node
/**
 * push-all: run the code push then the JSON push to live, forwarding flags
 * to BOTH phases.
 *
 * Why this exists: the old npm chain
 *   "push-all-live": "npm run push-live && npm run push-json-live"
 * silently mis-forwarded arguments — `npm run push-all-live -- --force`
 * appends --force only to the LAST command in the chain, so the code push
 * ran ungated-check and blocked, and nothing deployed. A Node runner
 * forwards args to both phases correctly and exits with the right code.
 *
 * The JSON phase always gets --skip-rollback: the code phase (seconds
 * earlier) already created a full rollback snapshot of live; creating a
 * second identical one would just waste a theme slot and a minute of upload.
 */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseArgs } = require('./lib/args');

const ARG_SPEC = {
  usage: 'node scripts/push-all.js [--force] [--skip-lock] [--skip-backup] [--skip-rollback]',
  flags: {
    '--force': 'force',
    '--skip-lock': 'skipLock',
    '--skip-backup': 'skipBackup',
    '--skip-rollback': 'skipRollback',
  },
};

const SAFE_PUSH = path.join(__dirname, 'safe-push.js');

function runNode(args) {
  return new Promise((resolve) => {
    // process.execPath = this exact node binary; no shell → no cmd.exe quirks.
    const child = spawn(process.execPath, [SAFE_PUSH, ...args], { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`[push-all] failed to launch: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2), ARG_SPEC);
  const shared = [];
  if (args.force) shared.push('--force');
  if (args.skipLock) shared.push('--skip-lock');
  if (args.skipBackup) shared.push('--skip-backup');

  console.log('\x1b[36m[push-all] phase 1/2: code\x1b[0m');
  const codeArgs = ['--target', 'live', ...shared];
  if (args.skipRollback) codeArgs.push('--skip-rollback');
  const codeStatus = await runNode(codeArgs);
  if (codeStatus !== 0) {
    console.error(`\x1b[31m[push-all] code push failed (exit ${codeStatus}) — JSON phase not attempted.\x1b[0m`);
    process.exit(codeStatus);
  }

  console.log('\x1b[36m[push-all] phase 2/2: json\x1b[0m');
  // JSON phase always skips rollback creation — phase 1 just made a snapshot.
  const jsonStatus = await runNode(['--target', 'live', '--json', '--skip-rollback', ...shared]);
  if (jsonStatus !== 0) {
    console.error(`\x1b[31m[push-all] json push failed (exit ${jsonStatus}). Code phase already deployed.\x1b[0m`);
    process.exit(jsonStatus);
  }

  console.log('\x1b[32m[push-all] both phases complete.\x1b[0m');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
