#!/usr/bin/env node
const { shopify } = require('./lib/shopify');

(async () => {
  // theme info is a quick informational command; use interactive so output
  // formatting is identical to running shopify directly.
  const status = await shopify(['theme', 'info'], { interactive: true });
  process.exit(status);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
