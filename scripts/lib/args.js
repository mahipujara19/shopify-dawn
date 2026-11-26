/**
 * Strict CLI argument parser shared by all harness scripts.
 *
 * Why strict: a silently-ignored typo (`--forc`, `--Force`) makes the user
 * believe a safety bypass is active when it isn't (or vice versa). Every
 * unknown argument is a hard error with usage text, not a shrug.
 *
 * spec = {
 *   usage:   'node scripts/x.js [--json] [--force]',
 *   flags:   { '--json': 'json', '--force': 'force' },          // booleans
 *   options: { '--target': { key: 'target', values: ['live','dev'], default: 'dev' } },
 * }
 */
function fail(msg, spec) {
  console.error(`\x1b[31m[args] ${msg}\x1b[0m`);
  if (spec && spec.usage) console.error(`Usage: ${spec.usage}`);
  process.exit(1);
}

function parseArgs(argv, spec) {
  const out = {};
  for (const key of Object.values(spec.flags || {})) out[key] = false;
  for (const cfg of Object.values(spec.options || {})) out[cfg.key] = cfg.default;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (spec.flags && Object.prototype.hasOwnProperty.call(spec.flags, a)) {
      out[spec.flags[a]] = true;
      continue;
    }
    if (spec.options && Object.prototype.hasOwnProperty.call(spec.options, a)) {
      const cfg = spec.options[a];
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) {
        fail(`${a} requires a value`, spec);
      }
      if (cfg.values && !cfg.values.includes(val)) {
        fail(`${a} must be one of: ${cfg.values.join(', ')} (got "${val}")`, spec);
      }
      out[cfg.key] = val;
      continue;
    }
    // Catch close-miss typos with a friendly hint.
    const known = [...Object.keys(spec.flags || {}), ...Object.keys(spec.options || {})];
    const hint = known.find((k) => k.toLowerCase() === a.toLowerCase());
    fail(hint ? `Unknown argument: ${a} (did you mean ${hint}?)` : `Unknown argument: ${a}`, spec);
  }
  return out;
}

module.exports = { parseArgs };
