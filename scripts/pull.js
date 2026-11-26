#!/usr/bin/env node
/** Usage: node scripts/pull.js --target dev|live [--json] */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ROOT } = require('./lib/env');
const { pull } = require('./lib/shopify');
const { hashDir, isCodeFile, isJsonFile } = require('./lib/hash');
const { recordPull } = require('./lib/pull-state');
const { safeRm } = require('./lib/fs-utils');
const { parseArgs } = require('./lib/args');

const ARG_SPEC = {
  usage: 'node scripts/pull.js --target dev|live [--json]',
  flags: { '--json': 'json' },
  options: { '--target': { key: 'target', values: ['live', 'dev'], default: 'dev' } },
};

(async () => {
  const args = parseArgs(process.argv.slice(2), ARG_SPEC);
  const themeDir = path.join(ROOT, 'theme');

  // Dev target: simple direct pull, no state tracking.
  if (args.target !== 'live') {
    const status = await pull({ target: args.target, json: args.json, path: themeDir });
    process.exit(status);
  }

  // Live target: pull to a temp dir so we can hash JUST live's content
  // (excluding any dev-only files that exist locally but not on live).
  // Then overlay the temp onto theme/ — same semantics as a direct shopify
  // pull (preserves dev-only files, overwrites shared files with live's).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-pull-live-'));
  try {
    const status = await pull({ target: 'live', json: args.json, path: tmpDir });
    if (status !== 0) process.exit(status);

    const filter = args.json ? isJsonFile : isCodeFile;
    const { hash, fileCount } = hashDir(tmpDir, { only: filter });

    // Overlay onto theme/. fs.cpSync with recursive does NOT delete files
    // in destination that aren't in source — exactly the behavior we want.
    fs.cpSync(tmpDir, themeDir, { recursive: true });

    const kind = args.json ? 'json' : 'code';
    recordPull(kind, hash);

    console.log(`[32m[pull-live] recorded pull state for ${kind} (files=${fileCount}, hash=${hash.slice(0, 12)})[0m`);
    console.log(`[36mReview changes with \`git diff theme/\`. When ready: \`npm run push-live${args.json ? '-json' : ''}\`[0m`);
  } finally {
    safeRm(tmpDir);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
