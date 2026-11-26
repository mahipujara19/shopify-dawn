# Theme deploy & collaboration guide

## The whole model in one paragraph

You develop on a feature branch against your **personal dev theme** (a separate Shopify theme that's yours alone). When the work is ready, you open a PR; reviewers preview by visiting your dev theme's URL. After the PR merges to `main`, you deploy to live from your machine in three steps: **pull live**, **review the diff**, **push live**. There's no CI, no auto-deploy, no GitHub Actions — every live deploy is a deliberate manual act with full visibility into what's about to change.

The harness enforces one rule: **you cannot push live unless you just pulled live**, and live must not have changed in the gap between your pull and your push. That's it. Everything else (lock, backups, rollback themes, webhooks) is plumbing around that rule.

---

## First-time setup (per developer)

```bash
git clone <repo-url>
cd shopify-theme-base-template
npm run setup
```

That's it. `npm run setup` walks you through it in one shot:

1. Copies `.env.example` → `.env` (gitignored)
2. Prompts for the required values, using any existing values as defaults:
   - `STORE` — store handle (e.g. `demo-hwpl`)
   - `PROD_THEME_ID` — live theme's numeric ID (same for everyone)
   - `DEV_THEME_ID` — YOUR personal dev theme ID
3. Optionally prompts for a webhook URL (Slack / Discord / Google Chat)
4. Runs `npm install` if needed
5. Verifies Shopify CLI auth — opens a browser to sign in the first time

You can re-run `npm run setup` any time; existing `.env` values become the defaults so it's safe to walk through again.

### If you don't have a personal dev theme yet

Create one manually before running setup:

```bash
shopify theme push --store <STORE> --unpublished --theme "dev-<yourname>" --path ./theme --json
# Copy the printed theme id and use it as DEV_THEME_ID in the setup prompt.
```

### Just re-authenticating

If you just need to re-authenticate (e.g. token expired), skip full setup:

```bash
npm run login
```

This uses `shopify theme list -s <STORE>` under the hood, which triggers OAuth if you're not logged in. (We don't use `shopify auth login` — that command was removed in Shopify CLI v3 and older scripts calling it get fuzzy-matched to `auth logout`, which will log you out on first run.)

---

## Daily development flow

```bash
# Start a feature
git checkout main && git pull
git checkout -b feature/banner-update

# Develop against your dev theme
npm run dev               # opens a localhost URL with hot-reload
# ...edit files in your IDE...
npm run push              # push to YOUR dev theme (unrestricted, no checks)

# Open a PR
git push origin feature/banner-update
# Reviewers can preview your dev theme directly at:
#   https://<STORE>.myshopify.com/?preview_theme_id=<DEV_THEME_ID>
# Or just paste that URL into the PR description.

# After review, merge the PR to main.
```

The PR doesn't trigger any deploy. Live ships only when you decide to ship it (next section).

---

## Deploying to live

### Pull live, review, push live

You can deploy from any branch — `main`, a feature branch, or a hotfix branch. The flow is always the same three commands:

```bash
# 1. Pull live (overlays live's content onto theme/, records pull state)
npm run pull-live              # code only
# or
npm run pull-json-live         # JSON only (templates, sections, locales, settings_data)
# or
npm run pull-all-live          # code + JSON in one go

# 2. Review what came in
git diff theme/                # see what live had vs your branch
# Decide per-file: keep your version, take live's, or merge.
# Edit, commit any reconciliation work.

# 3. Push to live
npm run push-live              # code only
# or
npm run push-json-live         # JSON only
# or
npm run push-all-live          # code + JSON in one go
```

### What `push-live` does step by step

1. **Acquires the deploy lock** so two devs don't push simultaneously
2. **Pulls live** to a temp dir and hashes it
3. **Pull-state gate**: refuses unless you ran `pull-live` recently AND live hasn't changed since
4. **No-op skip**: if your `theme/` matches live exactly, exits cleanly without deploying
5. **Saves a local backup** to `./backups/<timestamp>/` (last 5 kept, rest pruned)
6. **Creates a Shopify-side rollback theme** named `rollback-<timestamp>` (last 5 kept, rest pruned)
7. **Pushes** your `theme/` to live
8. **Clears the pull state** (so the next deploy needs another fresh pull)
9. **Notifies your webhook** (Slack / Discord / Google Chat)
10. **Releases the lock**

If step 7 fails, the local backup and rollback theme are still there for recovery.

---

## When `push-live` blocks you

There are exactly two reasons it'll refuse. Both have a clear single fix.

### "BLOCKED — no recent pull-live for this deploy"

You haven't pulled yet (or your pull state was cleared by a previous successful push). Just pull:

```bash
npm run pull-live
git diff theme/             # review
npm run push-live           # retry — succeeds now
```

### "BLOCKED — live has changed since your last pull-live"

Someone or something modified live between your pull and your push attempt. Possible causes: a teammate just deployed, a theme app installation modified files, an admin used the code editor in Shopify admin.

```bash
npm run pull-live           # re-pull to see the new state on top of yours
git diff theme/             # see what's now different from your branch
# Decide per-file: keep your code, take live's, or merge.
# Commit anything you want to preserve.
npm run push-live           # retry — pull state is fresh, succeeds now
```

### Bypass (use sparingly)

```bash
npm run push-live:force              # code, skipping the pull-state gate
npm run push-json-live:force         # JSON, skipping the gate
npm run push-all-live:force          # code + JSON, skipping the gate
```

(`npm run push-all-live -- --force` also works — `push-all-live` is a Node
runner that forwards flags to both phases, not an npm chain.)

Use force only when you've verified the live state another way and don't need the gate. It's a safety valve, not a default.

Two guards apply **even under force**, because there's no legitimate use for them:

- **Empty theme block** — if local `theme/` has zero files of the kind being
  pushed, the push is refused outright. `shopify theme push` deletes remote
  files missing locally, so pushing an empty theme would wipe live. Fresh
  clones hit this until their first `pull-live`.
- **Shrink block** — if local has less than half the files live has, the push
  is refused. If a large shrink is genuinely intended, re-run with
  `SAFE_PUSH_ALLOW_SHRINK=1` in the environment.

### Argument validation

All harness scripts validate their arguments strictly. A misspelled flag
(`--forc`, `--Force`) is a hard error with usage text — never silently
ignored. If a command exits complaining about an unknown argument, check
the spelling against the usage line it prints.

---

## Why code and JSON are separate

Your theme has two kinds of files:

| Kind | Examples | Owner |
| --- | --- | --- |
| **Code** | `*.liquid`, assets, `settings_schema.json` | Developers (in git) |
| **JSON data** | `templates/*.json`, `sections/*.json`, `config/settings_data.json`, `locales/*.json` | Merchants (in Shopify admin) |

Merchants edit JSON files via the Shopify theme editor — adding sections, changing settings, etc. We **don't track those JSON files in git** (they're in `.gitignore`) because git would constantly fight with merchant edits.

That's why we have separate code/JSON pull and push commands. Most PRs only touch code, so just `pull-live` + `push-live` is enough. Use the `-json-` variants only when you actually need to ship JSON changes (rare — usually only after a content-architecture change you discussed with the merchant).

`pull-all-live` and `push-all-live` chain both flows when you do need to ship a code+JSON change together.

---

## Rollback

Two recovery paths, fastest first:

### Fast: publish a rollback theme

Every successful `push-live` creates an unpublished `rollback-<timestamp>` theme on the store before pushing. To revert:

1. Shopify admin → Online Store → Themes
2. Find the most recent `rollback-<timestamp>` (the timestamp is right before the bad deploy)
3. Click **Publish**

You're rolled back in seconds, no code changes needed.

### Full: restore from local backup

`./backups/<timestamp>/` holds a snapshot of live taken right before each push. To restore from there:

```bash
ls backups/                                  # pick the timestamp you want
cp -r backups/2026-04-30_14-22-10/* theme/
npm run push-live -- --force                 # we have what we want, force-push
```

---

## Deploy lock

The harness uses a dedicated orphan branch called `deploy-lock` on the remote as a mutex. `push-live` acquires it via a git push to that branch — git's non-fast-forward rule means whoever pushes second loses, naturally serializing concurrent attempts.

```bash
npm run lock:status       # see who currently holds the lock
npm run lock:break        # force-clear (use only if you're sure a deploy crashed)
```

Locks auto-expire after `DEPLOY_LOCK_TTL_MINUTES` (default 15 min) so a crashed deploy doesn't permanently block the team. Disable per-deploy with `--skip-lock`, or globally via `USE_DEPLOY_LOCK=false` in `.env`.

---

## Webhook notifications

Set `DEPLOY_WEBHOOK_URL` in your `.env` to a Slack, Discord, or Google Chat incoming webhook URL. The harness auto-detects the provider and formats messages accordingly:

```
🚀 ronit starting push to live
✅ ronit pushed code to live
❌ ronit push to live FAILED
```

For Google Chat, Slack-style `:rocket:` shortcodes are converted to Unicode emoji automatically (Slack/Discord render them natively). Leave `DEPLOY_WEBHOOK_URL` empty to disable notifications entirely.

---

## Emergency: deploy from a fresh machine

If your normal machine is unavailable, any computer with git can deploy in ~5 minutes:

```bash
git clone <repo-url>
cd base-shopify-theme-template
cp .env.example .env             # set STORE, PROD_THEME_ID, DEV_THEME_ID
npm install
npm run login
npm run pull-live
git diff theme/                  # review
npm run push-live
```

Same flow as your daily one — the harness has no special CI button to look for.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `BLOCKED — no recent pull-live` | You haven't pulled yet | `npm run pull-live`, review, retry |
| `BLOCKED — live has changed since your last pull-live` | Someone/something modified live in between | Re-run `pull-live`, `git diff`, reconcile, retry |
| `[lock] held by <other-dev>` | Teammate is mid-deploy | Wait, or coordinate via chat |
| Lock stuck after a crash | Previous deploy crashed mid-flight | `npm run lock:break` |
| Pre-commit hook blocks me | `theme-check` found errors, or you're committing `.env`/`backups/` | Fix the errors, OR `git commit --no-verify` for a known-safe override |
| `shopify` not found | Shopify CLI not installed | `npm install -g @shopify/cli @shopify/theme` |
| Webhook silent | `DEPLOY_WEBHOOK_URL` not set | Add it to `.env` |
| Progress bar stuck during a pull | Network slow, or rare CLI hang | Wait, or Ctrl+C and retry |

---

## Reference: file map

| File | Purpose |
| --- | --- |
| `.env` | Per-dev config (gitignored) |
| `.env.example` | Template for `.env` |
| `.shopify-pull-state.json` | Per-dev pull state (gitignored) — the pull-state gate's storage |
| `package.json` | Scripts and dependencies |
| `scripts/safe-push.js` | The `push-live` entry point with all guards |
| `scripts/pull.js` | `pull-live` — pulls live and records pull state |
| `scripts/push-dev.js` | `push` (to dev theme) — unrestricted |
| `scripts/dev.js` | `dev` (hot-reload server) |
| `scripts/backup-live.js` | Local snapshot creation + auto-prune |
| `scripts/rollback-create.js` | Shopify-side rollback theme creation + auto-prune |
| `scripts/lock.js` | `lock:status` / `lock:acquire` / `lock:release` / `lock:break` CLI |
| `scripts/lib/pull-state.js` | Read/write/clear `.shopify-pull-state.json` |
| `scripts/lib/hash.js` | Deterministic directory hashing |
| `scripts/lib/lock.js` | Git-worktree-based mutex on `deploy-lock` orphan branch |
| `scripts/lib/shopify.js` | Wrappers around `shopify theme` subcommands |
| `scripts/lib/notify.js` | Slack/Discord/Google Chat webhook with emoji transform |
| `scripts/lib/fs-utils.js` | Windows-tolerant `safeRm` helper |
| `scripts/lib/env.js` | Zero-dependency `.env` loader |
| `.husky/pre-commit` | Blocks commits of `.env`/`backups`; runs `theme-check` advisory |
| `theme/` | The Shopify theme files (merchant JSONs gitignored) |
| `theme/.theme-check.yml` | Theme-check config tuned for stock Dawn themes |
| `backups/` | Auto-created local snapshots (gitignored) |

## Reference: full command list

```
npm run dev                  # hot-reload dev server against your DEV_THEME_ID
npm run info                 # show current Shopify theme info
npm run login                # authenticate the Shopify CLI
npm run logout               # sign out of the Shopify CLI

npm run pull                 # pull from your dev theme (code)
npm run pull-json            # pull from your dev theme (JSON)
npm run pull-live            # pull from live theme (code) — records pull state
npm run pull-json-live       # pull from live theme (JSON) — records pull state
npm run pull-all-live        # pull live code + JSON

npm run push                 # push to your dev theme (code, unrestricted)
npm run push-json            # push to your dev theme (JSON, unrestricted)
npm run push-live            # push to live theme (code) — gated by pull state
npm run push-json-live       # push to live theme (JSON) — gated by pull state
npm run push-all-live        # push live code + JSON
npm run push-live:force      # push to live (code) skipping the pull-state gate
npm run push-json-live:force # push to live (JSON) skipping the pull-state gate
npm run push-all-live:force  # push live code + JSON, skipping the gate

npm run backup-live          # take an ad-hoc local snapshot of live
npm run rollback-create      # take an ad-hoc Shopify-side rollback theme

npm run lock:status          # show current lock holder
npm run lock:acquire         # acquire the deploy lock manually (rare)
npm run lock:release         # release the deploy lock manually
npm run lock:break           # force-clear a stuck lock

npm run theme-check          # run shopify theme check on theme/
npm run react-build          # build the embedded React bundle
```
