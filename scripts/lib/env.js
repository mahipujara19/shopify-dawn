const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEnv() {
  const fromFile = parseEnvFile(path.join(ROOT, '.env'));
  for (const [k, v] of Object.entries(fromFile)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function required(name) {
  loadEnv();
  const v = process.env[name];
  if (!v) {
    console.error(`[31m[env] Missing required variable: ${name}[0m`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  return v;
}

function optional(name, fallback = '') {
  loadEnv();
  return process.env[name] || fallback;
}

function bool(name, fallback = false) {
  const v = optional(name, '').toLowerCase();
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

module.exports = { ROOT, loadEnv, required, optional, bool };
