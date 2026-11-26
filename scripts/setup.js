#!/usr/bin/env node
/**
 * One-command first-time setup for a new developer on this repo.
 *
 * Steps:
 *   1. If .env is missing, copy from .env.example.
 *   2. Prompt for the required values (STORE, PROD_THEME_ID, DEV_THEME_ID).
 *      Existing values become defaults so re-running setup is safe.
 *   3. Optionally prompt for a webhook URL.
 *   4. Write .env.
 *   5. Run `npm install` if node_modules is missing.
 *   6. Verify Shopify CLI auth (runs scripts/login.js internally).
 *
 * Zero dependencies — uses Node's built-in readline.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function writeEnv(file, values) {
  // Preserve comments and structure of existing .env when possible.
  const src = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : (fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8') : '');

  let content = src;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue;
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content += (content.endsWith('\n') ? '' : '\n') + line + '\n';
    }
  }
  fs.writeFileSync(file, content);
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, ...opts });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function main() {
  console.log('\n\x1b[36m=== Shopify theme harness setup ===\x1b[0m\n');

  // Step 1: ensure .env exists.
  if (!fs.existsSync(ENV_PATH)) {
    if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
      console.error('.env.example not found; cannot bootstrap .env.');
      process.exit(1);
    }
    fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    console.log('Created .env from .env.example');
  }

  const current = readEnv(ENV_PATH);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  async function ask(key, label, hint) {
    const existing = current[key];
    const dflt = existing ? ` [\x1b[33m${existing}\x1b[0m]` : (hint ? ` (${hint})` : '');
    const answer = (await rl.question(`  ${label}${dflt}: `)).trim();
    return answer || existing || '';
  }

  async function askYesNo(question, defaultNo = true) {
    const hint = defaultNo ? 'y/N' : 'Y/n';
    const answer = (await rl.question(`  ${question} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return !defaultNo;
    return answer === 'y' || answer === 'yes';
  }

  // Step 2: collect values.
  console.log('Fill in the required values below. Press Enter to keep the existing value.\n');
  const values = {};
  values.STORE = await ask('STORE', 'Shopify store handle', 'e.g. demo-hwpl');
  values.PROD_THEME_ID = await ask('PROD_THEME_ID', 'Live theme ID', 'find in admin theme URL');
  values.DEV_THEME_ID = await ask('DEV_THEME_ID', 'Your personal dev theme ID', 'find or create in admin');

  // Step 3: optional webhook.
  if (!current.DEPLOY_WEBHOOK_URL) {
    if (await askYesNo('Add a deploy-notification webhook URL?')) {
      values.DEPLOY_WEBHOOK_URL = await ask('DEPLOY_WEBHOOK_URL', 'Webhook URL', 'Slack / Discord / Google Chat');
    }
  }

  rl.close();

  // Step 4: write .env.
  writeEnv(ENV_PATH, values);
  console.log('\n\x1b[32mSaved .env\x1b[0m');

  // Step 5: install dependencies if needed.
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('\nRunning npm install...\n');
    const code = await runCmd('npm', ['install']);
    if (code !== 0) {
      console.error('\x1b[31mnpm install failed\x1b[0m');
      process.exit(code);
    }
  } else {
    console.log('\nnode_modules already present — skipping install');
  }

  // Step 6: verify auth.
  if (!values.STORE) {
    console.log('\n\x1b[33mSkipping login: STORE not set. Run `npm run login` after filling it in.\x1b[0m');
    return;
  }
  console.log('\nVerifying Shopify CLI auth (browser may open)...\n');
  await runCmd('node', [path.join('scripts', 'login.js')]);

  console.log('\n\x1b[32m=== Setup complete ===\x1b[0m');
  console.log('\nNext steps:');
  console.log('  npm run dev              # start hot-reload against your dev theme');
  console.log('  See DEPLOY.md for the full deploy flow.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
