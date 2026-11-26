const { optional } = require('./env');
const { spawnSync } = require('node:child_process');

function gitUserName() {
  const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function author() {
  return optional('DEPLOY_AUTHOR') || gitUserName() || 'unknown';
}

function detectProvider(url) {
  if (url.includes('discord.com') || url.includes('discordapp.com')) return 'discord';
  if (url.includes('chat.googleapis.com')) return 'gchat';
  if (url.includes('hooks.slack.com')) return 'slack';
  return 'generic';
}

// Slack and Discord render :shortcode: emoji natively. Google Chat (and most
// generic webhook receivers) don't — they show the literal text. Translate
// the small set of shortcodes our deploy messages use into Unicode.
const EMOJI_MAP = {
  ':rocket:': '🚀',
  ':white_check_mark:': '✅',
  ':x:': '❌',
  ':warning:': '⚠️',
  ':tada:': '🎉',
  ':fire:': '🔥',
  ':bell:': '🔔',
  ':lock:': '🔒',
  ':unlock:': '🔓',
  ':hourglass:': '⏳',
  ':wave:': '👋',
};

function transformEmoji(text) {
  return text.replace(/:[a-z_+-]+:/gi, (m) => EMOJI_MAP[m.toLowerCase()] || m);
}

function buildBody(provider, text) {
  const formatted = (provider === 'gchat' || provider === 'generic')
    ? transformEmoji(text)
    : text;
  switch (provider) {
    case 'discord':
      return { content: formatted };
    case 'gchat':
    case 'slack':
    case 'generic':
    default:
      return { text: formatted };
  }
}

function buildHeaders(provider) {
  if (provider === 'gchat') {
    return { 'Content-Type': 'application/json; charset=UTF-8' };
  }
  return { 'Content-Type': 'application/json' };
}

async function notify(text) {
  const url = optional('DEPLOY_WEBHOOK_URL');
  if (!url) return;
  const provider = detectProvider(url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider),
      body: JSON.stringify(buildBody(provider, text)),
    });
    if (!res.ok) {
      console.warn(`[notify] ${provider} webhook returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[notify] webhook error: ${err.message}`);
  }
}

module.exports = { notify, author, detectProvider };
