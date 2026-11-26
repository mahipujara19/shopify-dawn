const fs = require('node:fs');

/**
 * rmSync with Windows-friendly retries. The Shopify CLI and git both leave
 * file handles open briefly after writes; an immediate rmSync on a temp dir
 * can hit EBUSY/ENOTEMPTY on Windows. Retries usually clear it; if not, we
 * warn and continue — the OS temp cleaner will eventually reap the dir.
 */
function safeRm(target, { silent = false } = {}) {
  if (!target) return;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    if (!silent) {
      console.warn(`[fs] cleanup warning for ${target} (non-fatal): ${err.code || err.message}`);
    }
  }
}

module.exports = { safeRm };
