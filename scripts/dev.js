#!/usr/bin/env node
const path = require('node:path');
const { ROOT, required } = require('./lib/env');
const { shopify, CODE_FILTERS } = require('./lib/shopify');

(async () => {
  const store = required('STORE');
  const dev = required('DEV_THEME_ID');

  // theme dev is interactive: it may prompt for a store password (password-
  // protected previews), and it streams logs continuously until Ctrl+C.
  // interactive: true → stdio 'inherit', no success-detection / force-kill.
  const status = await shopify([
    'theme', 'dev',
    '-s', store,
    '-t', dev,
    ...CODE_FILTERS,
    '--path', path.join(ROOT, 'theme'),
  ], { interactive: true });
  process.exit(status);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
