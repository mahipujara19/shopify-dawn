#!/usr/bin/env node
/** Push to personal dev theme. No pull-state gate (dev themes are personal). */
const path = require('node:path');
const { ROOT } = require('./lib/env');
const { push } = require('./lib/shopify');
const { hashDir, isCodeFile, isJsonFile } = require('./lib/hash');
const { parseArgs } = require('./lib/args');

const ARG_SPEC = {
  usage: 'node scripts/push-dev.js [--json]',
  flags: { '--json': 'json' },
};

(async () => {
  const args = parseArgs(process.argv.slice(2), ARG_SPEC);
  const themeDir = path.join(ROOT, 'theme');

  // Same empty-theme guard as safe-push: `shopify theme push` deletes remote
  // files missing locally, so pushing 0 files would wipe your dev theme too.
  const { fileCount } = hashDir(themeDir, { only: args.json ? isJsonFile : isCodeFile });
  if (fileCount === 0) {
    console.error(`\x1b[31m[push-dev] BLOCKED — local theme/ has zero ${args.json ? 'json' : 'code'} files.\x1b[0m`);
    console.error('Pushing would delete everything on your dev theme. Pull first:');
    console.error(`  npm run pull${args.json ? '-json' : ''}         (from your dev theme)`);
    console.error(`  npm run pull-live${args.json ? '-json' : ''}    (from live)`);
    process.exit(3);
  }

  const status = await push({ target: 'dev', json: args.json, path: themeDir });
  process.exit(status);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
