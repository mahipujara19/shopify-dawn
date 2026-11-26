#!/usr/bin/env node
/**
 * safe-push: pushes the local theme to Shopify only after verifying the
 * developer has recently pulled live AND live hasn't changed since.
 *
 * Algorithm:
 *   1. Pull current remote theme into a temp dir (full theme: code + json).
 *   2. Read .shopify-pull-state.json (per-dev, gitignored).
 *      - If missing for this kind → refuse: "run pull-live first".
 *      - If recorded liveHash differs from current → refuse: "live changed
 *        since you pulled, re-run pull-live to see what's new".
 *   3. If local theme matches current live exactly → no-op skip.
 *   4. Otherwise: backup, rollback theme, push.
 *   5. On success: clear the pull state (next push requires another pull).
 *
 * Usage:
 *   node scripts/safe-push.js --target live           (code only)
 *   node scripts/safe-push.js --target live --json    (json only)
 *   node scripts/safe-push.js --target dev
 *   node scripts/safe-push.js --target live --skip-lock --skip-backup
 *   node scripts/safe-push.js --target live --force   (bypass pull-state gate)
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ROOT, bool } = require('./lib/env');
const { pull, push, targetThemeId } = require('./lib/shopify');
const { hashDir, isCodeFile, isJsonFile } = require('./lib/hash');
const { notify, author } = require('./lib/notify');
const { safeRm } = require('./lib/fs-utils');
const { getPull, clearPull } = require('./lib/pull-state');
const { parseArgs } = require('./lib/args');
const lockLib = require('./lib/lock');

const ARG_SPEC = {
  usage: 'node scripts/safe-push.js --target live|dev [--json] [--force] [--skip-lock] [--skip-backup] [--skip-rollback]',
  flags: {
    '--json': 'json',
    '--force': 'force',
    '--skip-lock': 'skipLock',
    '--skip-backup': 'skipBackup',
    '--skip-rollback': 'skipRollback',
  },
  options: {
    '--target': { key: 'target', values: ['live', 'dev'], default: 'dev' },
  },
};

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hashThemeDir(dir, { json }) {
  return hashDir(dir, { only: json ? isJsonFile : isCodeFile });
}

async function pullFullTheme({ target, outDir }) {
  const codeStatus = await pull({ target, json: false, path: outDir });
  if (codeStatus !== 0) return codeStatus;
  const jsonStatus = await pull({ target, json: true, path: outDir });
  return jsonStatus;
}

function printPullStateError(args, recorded, current) {
  const kindFlag = args.json ? '-json' : '';
  console.error('');
  console.error('[31m================================================================[0m');
  if (!recorded) {
    console.error('[31m[safe-push] BLOCKED — no recent pull-live for this deploy.[0m');
    console.error('[31m================================================================[0m');
    console.error('You must pull live before pushing live so you can review what changed.');
    console.error('');
    console.error(`Run:  npm run pull-live${kindFlag}`);
    console.error('Then review with `git diff theme/`, decide what to keep, and re-run push-live.');
  } else {
    console.error('[31m[safe-push] BLOCKED — live has changed since your last pull-live.[0m');
    console.error('[31m================================================================[0m');
    console.error(`You pulled live at: ${recorded.pulledAt}  (hash ${recorded.liveHash.slice(0, 12)})`);
    console.error(`Live right now is:                       hash ${current.hash.slice(0, 12)}`);
    console.error('');
    console.error('Someone (a teammate, a theme app, or an admin edit) modified live since.');
    console.error(`Run:  npm run pull-live${kindFlag}`);
    console.error('Review what came in with `git diff theme/`, reconcile, then push-live.');
  }
  console.error('');
  console.error('Or, if you are *certain* you want to overwrite, re-run with --force.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ARG_SPEC);
  targetThemeId(args.target);

  const useLock = args.target === 'live' && !args.skipLock && bool('USE_DEPLOY_LOCK', true);
  const wantBackup = args.target === 'live' && !args.skipBackup;
  const wantRollback = args.target === 'live' && !args.skipRollback && bool('CREATE_ROLLBACK_THEME', true);
  const kind = args.json ? 'json' : 'code';

  console.log(`[36m[safe-push] target=${args.target} json=${args.json}[0m`);

  if (useLock) {
    const ok = await lockLib.acquire();
    if (!ok) process.exit(1);
  }
  const releaseLock = async () => {
    if (useLock) await lockLib.release();
  };

  const liveDir = tmpDir('shopify-live-');
  let liveDirCleanedUp = false;
  const cleanupLiveDir = () => {
    if (liveDirCleanedUp) return;
    safeRm(liveDir);
    liveDirCleanedUp = true;
  };

  try {
    console.log('[36m[safe-push] pulling current remote state...[0m');
    const pullStatus = await pullFullTheme({ target: args.target, outDir: liveDir });
    if (pullStatus !== 0) {
      console.error('[31m[safe-push] live pull failed[0m');
      process.exit(1);
    }

    const current = hashThemeDir(liveDir, { json: args.json });
    console.log(`[safe-push] remote ${kind} files=${current.fileCount} hash=${current.hash.slice(0, 12)}`);

    // ---- Pull-state gate (only for live; dev pushes are unrestricted) ----
    if (args.target === 'live' && !args.force) {
      const recorded = getPull(kind);
      if (!recorded || recorded.liveHash !== current.hash) {
        printPullStateError(args, recorded, current);
        cleanupLiveDir();
        await releaseLock();
        process.exit(2);
      }
    }

    // ---- No-op short-circuit ----
    const local = hashThemeDir(path.join(ROOT, 'theme'), { json: args.json });
    if (local.hash === current.hash && !args.force) {
      console.log(`[32m[safe-push] no changes — local matches live (${current.hash.slice(0, 12)}). Nothing to push.[0m`);
      clearPull(kind);
      cleanupLiveDir();
      await releaseLock();
      process.exit(0);
    }

    // ---- Sanity guards on the local theme (protects live from bad pushes) ----
    // `shopify theme push` DELETES remote files that don't exist locally.
    // Pushing an empty theme/ would wipe the target theme. This can happen on
    // a fresh clone (theme/ has only empty folders) — block it uncondition-
    // ally, --force included. There is no legitimate reason to push 0 files.
    if (local.fileCount === 0) {
      console.error('');
      console.error('[31m================================================================[0m');
      console.error(`[31m[safe-push] BLOCKED — local theme/ has ZERO ${kind} files.[0m`);
      console.error('[31m================================================================[0m');
      console.error('Pushing an empty theme would DELETE every matching file on the target');
      console.error('theme. This usually means a fresh clone that has never pulled.');
      console.error('');
      console.error(`Run:  npm run pull-${args.target === 'live' ? 'live' : 'dev'}${args.json ? '-json' : ''}   first.`);
      console.error('(This check cannot be bypassed with --force.)');
      cleanupLiveDir();
      await releaseLock();
      process.exit(3);
    }
    // A large shrink (local has less than half of what live has) is almost
    // always a mistake — partial checkout, deleted folder, wrong branch.
    // The pull-state gate normally prevents this; --force skips that gate,
    // so this is the force-path backstop. Bypassable only by an explicit
    // second confirmation via SAFE_PUSH_ALLOW_SHRINK=1.
    if (args.target === 'live'
        && current.fileCount > 0
        && local.fileCount < current.fileCount / 2
        && process.env.SAFE_PUSH_ALLOW_SHRINK !== '1') {
      console.error('');
      console.error('[31m================================================================[0m');
      console.error(`[31m[safe-push] BLOCKED — local theme/ has far fewer ${kind} files than live.[0m`);
      console.error('[31m================================================================[0m');
      console.error(`Local:  ${local.fileCount} files`);
      console.error(`Live:   ${current.fileCount} files`);
      console.error('');
      console.error('Pushing would delete the missing files from live. If this shrink is');
      console.error('really intentional, re-run with the environment variable set:');
      console.error('  SAFE_PUSH_ALLOW_SHRINK=1 npm run push-live' + (args.json ? '-json' : '') + (args.force ? ':force' : ''));
      cleanupLiveDir();
      await releaseLock();
      process.exit(3);
    }

    // ---- Safety nets, reusing the pulled snapshot ----
    if (wantBackup) {
      console.log('[36m[safe-push] saving local backup snapshot...[0m');
      await require('./backup-live').run({ sourceDir: liveDir });
    }

    let rollbackCreated = false;
    if (wantRollback) {
      console.log('[36m[safe-push] creating Shopify rollback theme...[0m');
      try {
        await require('./rollback-create').create({ sourceDir: liveDir });
        rollbackCreated = true;
      } catch (err) {
        console.warn(`[33m[safe-push] rollback theme creation failed: ${err.message} (continuing)[0m`);
      }
    }

    cleanupLiveDir();

    // ---- Actual push to live ----
    console.log('[36m[safe-push] pushing local theme/ to ' + args.target + '...[0m');
    await notify(`:rocket: ${author()} starting push to ${args.target}${args.json ? ' (json)' : ''}`);
    const pushStatus = await push({ target: args.target, json: args.json, path: path.join(ROOT, 'theme') });
    if (pushStatus !== 0) {
      await notify(`:x: ${author()} push to ${args.target} FAILED`);
      console.error('[31m[safe-push] push failed[0m');
      await releaseLock();
      process.exit(pushStatus);
    }

    // Successful push → clear pull state so next push requires a fresh pull.
    if (args.target === 'live') clearPull(kind);

    console.log(`[32m[safe-push] live push complete.[0m`);
    await notify(`:white_check_mark: ${author()} pushed ${kind} to ${args.target}`);

    // ---- Post-deploy housekeeping (best-effort, does not block deploy) ----
    if (rollbackCreated) {
      try {
        await require('./rollback-create').prune();
      } catch (err) {
        console.warn(`[33m[safe-push] rollback prune warning (non-fatal): ${err.message}[0m`);
      }
    }

    console.log('[32m[safe-push] done.[0m');
  } finally {
    cleanupLiveDir();
    await releaseLock();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
