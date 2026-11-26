#!/usr/bin/env node
/**
 * Creates Shopify-side rollback themes by pushing snapshots of live as new
 * unpublished themes named `rollback-<timestamp>`. If a deploy goes wrong,
 * a teammate can publish the rollback theme from admin in one click.
 *
 * Exports two operations:
 *   - create({ sourceDir? }): creates a single new rollback theme.
 *   - prune({ keep? }):       deletes old rollback-* themes beyond the keep
 *                             count. Decoupled from create so safe-push can
 *                             run pruning AFTER the actual live push, keeping
 *                             housekeeping off the critical path.
 *
 * Standalone (`npm run rollback-create`) runs both: create, then prune.
 *
 * Requires Shopify CLI to be authenticated (`npm run login` once).
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { required, optional } = require('./lib/env');
const { safeRm } = require('./lib/fs-utils');
const { shopify, shopifyCapture } = require('./lib/shopify');

const KEEP_DEFAULT = parseInt(optional('ROLLBACK_KEEP', '5'), 10) || 5;

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
}

async function listThemes(store) {
  const r = await shopifyCapture(['theme', 'list', '-s', store, '--json']);
  if (r.status !== 0) {
    console.warn('[rollback] could not list themes:', (r.stderr || '').trim());
    return [];
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return [];
  }
}

/** Create a new rollback-<ts> unpublished theme from a local snapshot. */
async function create({ sourceDir = null } = {}) {
  const store = required('STORE');
  const liveId = required('PROD_THEME_ID');

  let snapshotDir = sourceDir;
  let cleanupSnapshot = false;

  if (!snapshotDir) {
    snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-rollback-'));
    cleanupSnapshot = true;
    console.log('[rollback] pulling current live...');
    const pulledStatus = await shopify(['theme', 'pull', '-s', store, '-t', liveId, '--path', snapshotDir]);
    if (pulledStatus !== 0) {
      safeRm(snapshotDir);
      throw new Error('rollback pull failed');
    }
  } else {
    console.log('[rollback] reusing pre-pulled snapshot');
  }

  const name = `rollback-${ts()}`;
  console.log(`[rollback] uploading snapshot as new unpublished theme "${name}"...`);
  const pushedStatus = await shopify(
    ['theme', 'push', '-s', store, '--unpublished', '--theme', name, '--path', snapshotDir],
    { cwd: snapshotDir },
  );

  if (cleanupSnapshot) safeRm(snapshotDir);

  if (pushedStatus !== 0) {
    throw new Error('rollback theme push failed');
  }
  console.log(`\x1b[32m[rollback] created "${name}"\x1b[0m`);
  return name;
}

/** Delete old rollback-* themes beyond the keep count. Best-effort. */
async function prune({ keep = KEEP_DEFAULT } = {}) {
  const store = required('STORE');
  console.log(`[rollback] checking for old rollback themes to prune (keep ${keep})...`);
  const themes = (await listThemes(store))
    .filter((t) => typeof t.name === 'string' && t.name.startsWith('rollback-'))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  const toDelete = themes.slice(keep);
  if (toDelete.length === 0) {
    console.log('[rollback] no rollback themes to prune.');
    return;
  }
  console.log(`[rollback] pruning ${toDelete.length} old theme(s)...`);
  for (const t of toDelete) {
    process.stdout.write(`[rollback] deleting ${t.name} (#${t.id})... `);
    const r = await shopifyCapture(['theme', 'delete', '-s', store, '-t', String(t.id), '--force']);
    process.stdout.write(r.status === 0 ? 'ok\n' : `failed (status ${r.status})\n`);
  }
  console.log('[rollback] prune complete.');
}

async function run({ sourceDir = null } = {}) {
  await create({ sourceDir });
  await prune();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { create, prune, run };
