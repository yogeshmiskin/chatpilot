import fs from 'node:fs';

function loadEnv() {
  try {
    const text = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const i = trimmed.indexOf('=');
      const key = trimmed.slice(0, i).trim();
      let value = trimmed.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  } catch {}
}
loadEnv();

const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
const bool = (v, d=false) => v == null ? d : /^(1|true|yes|on)$/i.test(String(v));

export const config = {
  port: num(process.env.PORT, 4000),
  timezone: process.env.TZ || 'Asia/Kolkata',
  instagram: {
    verifyToken: process.env.IG_VERIFY_TOKEN || '',
    accessToken: process.env.IG_ACCESS_TOKEN || '',
    accountId: process.env.IG_ACCOUNT_ID || '',
    apiVersion: process.env.IG_API_VERSION || 'v25.0',
    appSecret: process.env.META_APP_SECRET || ''
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  },
  bot: {
    enabled: bool(process.env.BOT_ENABLED, true),
    minDelayMs: num(process.env.BOT_REPLY_MIN_DELAY_MS, 10000),
    maxDelayMs: num(process.env.BOT_REPLY_MAX_DELAY_MS, 45000),
    quietStart: process.env.QUIET_START || '02:00',
    quietEnd: process.env.QUIET_END || '07:00',
    tone: process.env.BOT_TONE || 'Friendly, casual, natural Hinglish with occasional English',
    flirtLevel: process.env.FLIRT_LEVEL || 'light',
    emojiLevel: process.env.EMOJI_LEVEL || 'low',
    matureMode: bool(process.env.MATURE_MODE, false)
  }
};
