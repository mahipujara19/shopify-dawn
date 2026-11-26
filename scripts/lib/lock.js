const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { ROOT, optional } = require('./env');
const { author } = require('./notify');

const LOCK_BRANCH = 'deploy-lock';
const LOCK_FILE = 'lock.json';

function git(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf8', cwd: opts.cwd || ROOT, ...opts });
}

function ttlMinutes() {
  const v = parseInt(optional('DEPLOY_LOCK_TTL_MINUTES', '15'), 10);
  return Number.isFinite(v) && v > 0 ? v : 15;
}

function hasRemote() {
  const r = git(['remote']);
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

function freshWorktree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-deploy-lock-'));
  fs.rmSync(dir, { recursive: true, force: true });
  const created = git(['worktree', 'add', '--detach', dir]);
  if (created.status !== 0) {
    console.error('[lock] failed to create worktree:', created.stderr);
    process.exit(1);
  }
  return dir;
}

function cleanupWorktree(dir) {
  // git worktree remove releases the worktree from git's POV
  spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT });
  // Belt + suspenders: prune any stale worktree registrations git missed.
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT });
  // Delete the local deploy-lock branch ref so VS Code / Cursor don't surface
  // it in their SCM panel. The remote deploy-lock branch is the actual lock
  // state; the local ref is just scratch space for our worktree commits.
  spawnSync('git', ['branch', '-D', LOCK_BRANCH], { cwd: ROOT, stdio: 'ignore' });
  // On Windows, file handles inside .git/objects/pack can linger briefly after
  // git ops, causing EBUSY on immediate rmdir. Retries handle that; if it still
  // fails the OS tempdir cleaner will eventually reap it — never fatal.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`[lock] worktree temp cleanup warning (non-fatal): ${err.code || err.message}`);
  }
}

function checkoutLockBranch(wt) {
  if (hasRemote()) {
    git(['fetch', 'origin', LOCK_BRANCH], { cwd: wt });
  }
  const localExists = git(['rev-parse', '--verify', LOCK_BRANCH], { cwd: wt }).status === 0;
  const remoteExists = hasRemote()
    && git(['rev-parse', '--verify', `origin/${LOCK_BRANCH}`], { cwd: wt }).status === 0;

  if (remoteExists) {
    git(['checkout', '-B', LOCK_BRANCH, `origin/${LOCK_BRANCH}`], { cwd: wt });
  } else if (localExists) {
    git(['checkout', LOCK_BRANCH], { cwd: wt });
  } else {
    git(['checkout', '--orphan', LOCK_BRANCH], { cwd: wt });
    git(['rm', '-rf', '.'], { cwd: wt });
  }
}

function readLockFile(wt) {
  const p = path.join(wt, LOCK_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function isExpired(lock) {
  if (!lock || !lock.expiresAt) return true;
  return new Date(lock.expiresAt).getTime() < Date.now();
}

function writeLockFile(wt, payload) {
  fs.writeFileSync(path.join(wt, LOCK_FILE), JSON.stringify(payload, null, 2) + '\n');
}

async function acquire({ silent = false } = {}) {
  const wt = freshWorktree();
  try {
    checkoutLockBranch(wt);
    const existing = readLockFile(wt);
    if (existing && !isExpired(existing) && existing.holder !== author()) {
      console.error(`[31m[lock] held by ${existing.holder} since ${existing.acquiredAt} (expires ${existing.expiresAt})[0m`);
      console.error('Wait for them to release, or run `npm run lock:break` if you are sure they are done.');
      return false;
    }
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMinutes() * 60_000);
    writeLockFile(wt, {
      holder: author(),
      acquiredAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      host: os.hostname(),
    });
    git(['add', LOCK_FILE], { cwd: wt });
    const commit = git(['-c', 'user.name=deploy-lock', '-c', 'user.email=deploy-lock@local', 'commit', '-m', `lock: ${author()} @ ${now.toISOString()}`], { cwd: wt });
    if (commit.status !== 0) {
      console.error('[lock] commit failed:', commit.stderr);
      return false;
    }
    if (hasRemote()) {
      const push = git(['push', 'origin', LOCK_BRANCH], { cwd: wt });
      if (push.status !== 0) {
        console.error(`[31m[lock] could not push lock — another developer probably acquired it first.[0m`);
        console.error(push.stderr);
        return false;
      }
    }
    if (!silent) console.log(`[32m[lock] acquired by ${author()} until ${expires.toISOString()}[0m`);
    return true;
  } finally {
    cleanupWorktree(wt);
  }
}

async function release({ force = false, silent = false } = {}) {
  const wt = freshWorktree();
  try {
    checkoutLockBranch(wt);
    const existing = readLockFile(wt);
    if (!existing) {
      if (!silent) console.log('[lock] nothing to release');
      return true;
    }
    if (!force && existing.holder !== author()) {
      console.error(`[31m[lock] held by ${existing.holder}, refusing to release. Use --force if you are sure.[0m`);
      return false;
    }
    fs.rmSync(path.join(wt, LOCK_FILE), { force: true });
    git(['add', '-A'], { cwd: wt });
    const commit = git(['-c', 'user.name=deploy-lock', '-c', 'user.email=deploy-lock@local', 'commit', '-m', `unlock: ${author()} @ ${new Date().toISOString()}`], { cwd: wt });
    if (commit.status !== 0) {
      console.error('[lock] release commit failed:', commit.stderr);
      return false;
    }
    if (hasRemote()) {
      const push = git(['push', 'origin', LOCK_BRANCH], { cwd: wt });
      if (push.status !== 0) {
        console.error('[lock] release push failed:', push.stderr);
        return false;
      }
    }
    if (!silent) console.log('[32m[lock] released[0m');
    return true;
  } finally {
    cleanupWorktree(wt);
  }
}

async function status() {
  const wt = freshWorktree();
  try {
    checkoutLockBranch(wt);
    const existing = readLockFile(wt);
    if (!existing || isExpired(existing)) {
      console.log('[lock] free');
      return;
    }
    console.log(`[lock] held by ${existing.holder} since ${existing.acquiredAt} (expires ${existing.expiresAt})`);
  } finally {
    cleanupWorktree(wt);
  }
}

module.exports = { acquire, release, status };
