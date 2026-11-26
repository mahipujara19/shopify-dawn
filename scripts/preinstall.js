#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

function check(cmd, args, label) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  if (r.status !== 0) {
    console.warn(`[33m[preinstall] ${label} not found. Install: https://shopify.dev/docs/themes/tools/cli[0m`);
    return false;
  }
  console.log(`[preinstall] ${label}: ${(r.stdout || '').trim().split('\n')[0]}`);
  return true;
}

const node = process.versions.node;
const [major] = node.split('.').map(Number);
if (major < 18) {
  console.error(`[31m[preinstall] Node 18+ required (found ${node}). Upgrade.[0m`);
  process.exit(1);
}

check('shopify', ['version'], 'Shopify CLI');
check('git', ['--version'], 'git');
