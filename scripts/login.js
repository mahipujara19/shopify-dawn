#!/usr/bin/env node
/**
 * Authenticate the Shopify CLI for this store.
 *
 * Why not `shopify auth login`: that command doesn't exist in modern Shopify
 * CLI (v3+). It only has `auth logout`. The CLI does fuzzy command matching
 * and helpfully points `auth login` to `auth logout`, then auto-confirms
 * "Yes" without a proper TTY — so the naive first-time login actually logs
 * the user out.
 *
 * Instead we run `shopify theme list -s <store>`. In modern CLI, any command
 * that needs auth will trigger the browser-based OAuth flow if you're not
 * logged in. If you are logged in, it just returns the list (quick, harmless).
 * Either way, we've verified the auth state for this store.
 */
const { required } = require('./lib/env');
const { shopify } = require('./lib/shopify');

(async () => {
  const store = required('STORE');
  console.log(`\x1b[36m[login] Verifying Shopify CLI auth for ${store}...\x1b[0m`);
  console.log('\x1b[36m[login] If a browser opens, complete the sign-in there and return here.\x1b[0m\n');
  // interactive: true so the CLI has a real TTY — it may prompt (browser flow,
  // "open URL?", etc.) and we want stdin to work.
  const status = await shopify(['theme', 'list', '-s', store], { interactive: true });
  if (status !== 0) {
    console.error('\x1b[31m[login] auth verification failed\x1b[0m');
    process.exit(status);
  }
  console.log('\n\x1b[32m[login] auth OK for ' + store + '\x1b[0m');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
