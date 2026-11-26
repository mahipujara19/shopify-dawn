/**
 * Per-developer pull state — local, gitignored.
 *
 * The deploy gate: every `push-live` requires a matching `pull-live` to have
 * happened first, AND live cannot have changed in between. We track this by
 * recording the live theme's hash at the moment of pull. push-live re-pulls,
 * re-hashes, and refuses unless the recorded hash matches the current live.
 *
 * The file lives at repo root so each developer has their own state. It is
 * gitignored — never commit it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./env');

const STATE_FILE = path.join(ROOT, '.shopify-pull-state.json');

function read() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function write(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

/** Record a successful pull-live for a given kind ('code' or 'json'). */
function recordPull(kind, liveHash) {
  const state = read();
  state[kind] = {
    liveHash,
    pulledAt: new Date().toISOString(),
  };
  write(state);
}

/** Get the recorded pull state for a kind, or null if not present. */
function getPull(kind) {
  const state = read();
  return state[kind] || null;
}

/** Clear the pull state for a kind (called after a successful push). */
function clearPull(kind) {
  const state = read();
  delete state[kind];
  if (Object.keys(state).length === 0) {
    if (fs.existsSync(STATE_FILE)) fs.rmSync(STATE_FILE, { force: true });
  } else {
    write(state);
  }
}

module.exports = { recordPull, getPull, clearPull, STATE_FILE };
