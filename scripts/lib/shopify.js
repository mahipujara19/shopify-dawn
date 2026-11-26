const { spawn } = require('node:child_process');
const { required } = require('./env');

// File classification — this MUST stay in sync with isCodeFile / isJsonFile in
// lib/hash.js, otherwise the same live state hashes differently when pulled
// via the code path vs. the json path, producing false "live changed" errors.
//
//   Code bucket: everything except merchant-editable JSONs.
//                Includes config/settings_schema.json (devs own the schema).
//   JSON bucket: merchant-editable JSONs only.
//                config/settings_data.json (NOT settings_schema.json),
//                templates/**/*.json, sections/*.json, locales/*.json.
const CODE_FILTERS = [
  '--ignore', 'config/settings_data.json',
  '--ignore', 'templates/**/*.json',
  '--ignore', 'templates/*.json',
  '--ignore', 'sections/*.json',
  '--ignore', 'locales/*.json',
];

const JSON_FILTERS = [
  '--only', 'config/settings_data.json',
  '--only', 'templates/**/*.json',
  '--only', 'templates/*.json',
  '--only', 'sections/*.json',
  '--only', 'locales/*.json',
];

function targetThemeId(target) {
  if (target === 'live') return required('PROD_THEME_ID');
  if (target === 'dev') return required('DEV_THEME_ID');
  throw new Error(`Unknown target: ${target}`);
}

// Phrases the Shopify CLI prints on successful completion of a theme command.
// Once we see one of these in piped output, we know the work is done — the
// child just hasn't exited yet (Windows cmd.exe + oclif update-notifier issue).
const SUCCESS_RE = /(was pushed successfully|has been pulled|was deleted|was published|theme has been pushed)/i;
const KILL_GRACE_MS = 3000;

/**
 * Internal: spawn the Shopify CLI with three possible stdio modes.
 *
 * Modes:
 *   - interactive (default false): stdio 'inherit'. Required for commands that
 *     prompt the user (theme dev) or that we want to behave like a normal
 *     terminal child. No success-detection / force-kill — the user controls
 *     when to stop (e.g. Ctrl+C on `theme dev`).
 *
 *   - capture (default false): pipe stdout/stderr into strings, don't forward
 *     to parent. For commands whose output we parse (theme list --json).
 *
 *   - neither flag (default): pipe stdout/stderr, FORWARD them live to the
 *     parent's stdout/stderr (so the user sees progress bars), AND watch for
 *     a Shopify CLI "success" marker. Once seen, give the child KILL_GRACE_MS
 *     to exit on its own; if it hasn't, force-kill the process tree. This
 *     works around the Windows hang where the CLI prints its success box but
 *     cmd.exe never exits because oclif's update-notifier subprocess lingers.
 */
function _spawnShopify(args, { cwd, interactive = false, capture = false } = {}) {
  return new Promise((resolve) => {
    const stdio = interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'];
    const child = spawn('shopify', args, { stdio, shell: true, cwd });

    let stdout = '';
    let stderr = '';
    let killTimer = null;
    let resolved = false;

    const done = (code) => {
      if (resolved) return;
      resolved = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({ status: code ?? 0, stdout, stderr });
    };

    const armKill = () => {
      if (killTimer) return;
      killTimer = setTimeout(() => {
        try {
          if (process.platform === 'win32') {
            // /T = kill descendants (covers cmd.exe wrapper + update-notifier)
            // /F = force
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          // ignored — done() resolves regardless
        }
        done(0);
      }, KILL_GRACE_MS);
    };

    if (!interactive) {
      child.stdout.on('data', (d) => {
        const s = d.toString('utf8');
        stdout += s;
        if (!capture) process.stdout.write(s);
        if (SUCCESS_RE.test(s)) armKill();
      });
      child.stderr.on('data', (d) => {
        const s = d.toString('utf8');
        stderr += s;
        if (!capture) process.stderr.write(s);
        if (SUCCESS_RE.test(s)) armKill();
      });
    }

    child.on('error', (err) => {
      stderr += err.message + '\n';
      if (!interactive && !capture) {
        process.stderr.write(`\x1b[31m[shopify] failed to launch: ${err.message}\x1b[0m\n`);
      }
      done(1);
    });
    child.on('close', (code) => done(code));
  });
}

/**
 * Public: run a Shopify CLI command, return its exit code as a number.
 *
 * Pass `{ interactive: true }` for commands that need TTY (theme dev, login,
 * anything that might prompt the user).
 */
async function shopify(args, opts = {}) {
  const r = await _spawnShopify(args, opts);
  return r.status;
}

/**
 * Public: run a Shopify CLI command, capture stdout/stderr, return all three.
 * For commands whose output we parse (e.g. `theme list --json`).
 */
async function shopifyCapture(args, opts = {}) {
  return _spawnShopify(args, { ...opts, capture: true });
}

async function pull({ target, json, path: outPath, extraArgs = [] }) {
  const themeId = targetThemeId(target);
  const store = required('STORE');
  const filters = json ? JSON_FILTERS : CODE_FILTERS;
  return shopify([
    'theme', 'pull',
    '-s', store,
    '-t', themeId,
    ...filters,
    '--path', outPath,
    ...extraArgs,
  ]);
}

async function push({ target, json, path: srcPath, extraArgs = [] }) {
  const themeId = targetThemeId(target);
  const store = required('STORE');
  const filters = json ? JSON_FILTERS : CODE_FILTERS;
  const liveFlag = target === 'live' ? ['--allow-live'] : [];
  return shopify([
    'theme', 'push',
    '-s', store,
    '-t', themeId,
    ...filters,
    ...liveFlag,
    '--path', srcPath,
    ...extraArgs,
  ]);
}

module.exports = { shopify, shopifyCapture, pull, push, targetThemeId, CODE_FILTERS, JSON_FILTERS };
