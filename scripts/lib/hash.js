const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function walk(dir, base = dir) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full, base));
    } else if (stat.isFile()) {
      entries.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return entries;
}

function hashDir(dir, { only, ignore } = {}) {
  const files = walk(dir).filter((rel) => {
    if (only && !only(rel)) return false;
    if (ignore && ignore(rel)) return false;
    return true;
  });
  files.sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(dir, rel)));
    h.update('\0');
  }
  return { hash: h.digest('hex'), fileCount: files.length };
}

// File classification — MUST stay in sync with CODE_FILTERS / JSON_FILTERS in
// lib/shopify.js. The two buckets are mutually exclusive: every file is either
// code or json (or neither, if it doesn't match any rule — those are skipped
// by both filters and excluded from both hashes).
//
// Special case: config/settings_schema.json belongs to CODE (developers own
// the schema), config/settings_data.json belongs to JSON (merchants own data).

function isCodeFile(rel) {
  if (rel === 'config/settings_data.json') return false;
  if (rel.startsWith('templates/') && rel.endsWith('.json')) return false;
  if (rel.startsWith('sections/') && rel.endsWith('.json')) return false;
  if (rel.startsWith('locales/') && rel.endsWith('.json')) return false;
  return true;
}

function isJsonFile(rel) {
  if (rel === 'config/settings_schema.json') return false;
  if (rel === 'config/settings_data.json') return true;
  if (rel.startsWith('templates/') && rel.endsWith('.json')) return true;
  if (rel.startsWith('sections/') && rel.endsWith('.json')) return true;
  if (rel.startsWith('locales/') && rel.endsWith('.json')) return true;
  return false;
}

module.exports = { hashDir, isCodeFile, isJsonFile, walk };
