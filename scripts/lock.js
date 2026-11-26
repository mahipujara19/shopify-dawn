#!/usr/bin/env node
const lock = require('./lib/lock');

const USAGE = 'Usage: node scripts/lock.js <status|acquire|release|break> [--force]';
const cmd = process.argv[2] || 'status';
const flags = process.argv.slice(3);

// Strict: an unknown command (typo like "brake") must error, not silently
// fall through to status — the user would believe their action happened.
const KNOWN = ['status', 'acquire', 'release', 'break'];
if (!KNOWN.includes(cmd)) {
  console.error(`\x1b[31m[lock] unknown command: ${cmd}\x1b[0m`);
  console.error(USAGE);
  process.exit(1);
}
for (const f of flags) {
  if (f !== '--force') {
    console.error(`\x1b[31m[lock] unknown flag: ${f}\x1b[0m`);
    console.error(USAGE);
    process.exit(1);
  }
}

(async () => {
  switch (cmd) {
    case 'acquire': {
      const ok = await lock.acquire();
      process.exit(ok ? 0 : 1);
    }
    case 'release': {
      const ok = await lock.release({ force: flags.includes('--force') });
      process.exit(ok ? 0 : 1);
    }
    case 'break': {
      const ok = await lock.release({ force: true });
      process.exit(ok ? 0 : 1);
    }
    case 'status': {
      await lock.status();
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
