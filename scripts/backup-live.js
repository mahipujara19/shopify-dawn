#!/usr/bin/env node
/**
 * Pull current live theme to ./backups/<timestamp>/ as a local rollback snapshot.
 *
 * Two modes:
 *   - Standalone (`npm run backup-live`): pulls fresh from live.
 *   - As a helper (`run({ sourceDir })`): copies an existing pulled snapshot,
 *     skipping the network roundtrip. Used by safe-push to avoid duplicate pulls.
 *
 * To restore: copy contents over ./theme/, then `npm run push-live -- --force`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, optional } = require('./lib/env');
const { pull } = require('./lib/shopify');
const { safeRm } = require('./lib/fs-utils');

const BACKUPS_KEEP = parseInt(optional('BACKUPS_KEEP', '5'), 10) || 5;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function pruneOldBackups({ silent = false } = {}) {
  const root = path.join(ROOT, 'backups');
  if (!fs.existsSync(root)) return;
  const dirs = fs.readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .sort()
    .reverse(); // newest first (timestamp prefix sorts lexically)
  const stale = dirs.slice(BACKUPS_KEEP);
  for (const name of stale) {
    if (!silent) console.log(`[backup-live] pruning old backup ${name}`);
    safeRm(path.join(root, name), { silent: true });
  }
}

async function run({ silent = false, sourceDir = null } = {}) {
  const dir = path.join(ROOT, 'backups', timestamp());
  fs.mkdirSync(dir, { recursive: true });

  if (sourceDir) {
    if (!silent) console.log(`[backup-live] copying pre-pulled snapshot → ${path.relative(ROOT, dir)}`);
    fs.cpSync(sourceDir, dir, { recursive: true });
  } else {
    if (!silent) console.log(`[backup-live] pulling live → ${path.relative(ROOT, dir)}`);
    const codeStatus = await pull({ target: 'live', json: false, path: dir });
    if (codeStatus !== 0) {
      console.error('[backup-live] code pull failed');
      process.exit(codeStatus);
    }
    const jsonStatus = await pull({ target: 'live', json: true, path: dir });
    if (jsonStatus !== 0) {
      console.error('[backup-live] json pull failed');
      process.exit(jsonStatus);
    }
  }

  fs.writeFileSync(
    path.join(dir, 'BACKUP_INFO.txt'),
    `Backup of live theme taken at ${new Date().toISOString()}\n` +
    `From repo: ${ROOT}\n` +
    `To restore: copy contents over ./theme/, then run\n` +
    `  npm run push-live -- --force\n` +
    `(use only after coordinating with the team).\n`
  );
  if (!silent) console.log(`[32m[backup-live] saved to ${path.relative(ROOT, dir)}[0m`);
  pruneOldBackups({ silent });
  return dir;
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
