import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'chatpilot-data.json');

const PORT = Number(process.env.PORT || 4000);
const TZ = process.env.TZ || 'Asia/Kolkata';
process.env.TZ = TZ;
const debugEvents = [];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultStore(), null, 2));
  }
}

function defaultStore() {
  return {
    version: 2,
    globalSettings: {
      myMode: 'Neutral',
      talkingTo: 'Neutral',
      replyMode: 'Copy-Paste',
      tone: 'Friendly',
      emojiLevel: 'Low',
      flirting: false,
      romantic: false,
      mature: false,
      customInstructions: '',
      quietStart: process.env.QUIET_START || '02:00',
      quietEnd: process.env.QUIET_END || '07:00',
      timezone: TZ
    },
    conversations: []
  };
}

function loadStore() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    const fresh = defaultStore();
    saveStore(fresh);
    return fresh;
  }
}

function saveStore(store) {
  ensureDataFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let store = loadStore();

function debug(event, details = {}) {
  debugEvents.unshift({
    id: makeId('debug'),
    timestamp: now(),
    event,
    details
  });
  if (debugEvents.length > 100) debugEvents.length = 100;
}

function now() {
  return new Date().toISOString();
}

function safeJson(value) {
  return JSON.stringify(value);
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return res.end(body);
  res.end(typeof body === 'string' ? body : safeJson(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON body'); }
}

function routePath(url) {
  return new URL(url, `http://localhost:${PORT}`).pathname;
}

function getConversation(id) {
  return store.conversations.find(c => c.id === id);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeConversationInput(input = {}) {
  const label = String(input.label || 'New Chat').trim().slice(0, 120) || 'New Chat';
  return {
    label,
    myMode: ['Boy', 'Girl', 'Neutral'].includes(input.myMode) ? input.myMode : store.globalSettings.myMode,
    talkingTo: ['Boy', 'Girl', 'Neutral'].includes(input.talkingTo) ? input.talkingTo : store.globalSettings.talkingTo,
    replyMode: ['Copy-Paste', 'Manual Send'].includes(input.replyMode) ? input.replyMode : store.globalSettings.replyMode,
    tone: ['Casual', 'Friendly', 'Funny', 'Caring', 'Flirty', 'Custom'].includes(input.tone) ? input.tone : store.globalSettings.tone,
    emojiLevel: ['Low', 'Normal', 'High'].includes(input.emojiLevel) ? input.emojiLevel : store.globalSettings.emojiLevel,
    flirting: Boolean(input.flirting ?? store.globalSettings.flirting),
    romantic: Boolean(input.romantic ?? store.globalSettings.romantic),
    mature: Boolean(input.mature ?? store.globalSettings.mature),
    customInstructions: String(input.customInstructions ?? store.globalSettings.customInstructions ?? '').slice(0, 4000),
    memory: String(input.memory ?? '').slice(0, 8000)
  };
}

function createConversation(input) {
  const settings = normalizeConversationInput(input);
  const conversation = {
    id: makeId('conv'),
    createdAt: now(),
    updatedAt: now(),
    memory: '',
    unreadCount: 0,
    ...settings,
    messages: []
  };
  store.conversations.unshift(conversation);
  saveStore(store);
  debug('Conversation created', { conversationId: conversation.id });
  return conversation;
}

function addMessage(conversation, direction, text, status = 'local') {
  const message = {
    id: makeId('msg'),
    conversationId: conversation.id,
    direction,
    text: String(text || '').trim().slice(0, 12000),
    timestamp: now(),
    status
  };
  conversation.messages.push(message);
  conversation.updatedAt = message.timestamp;
  if (direction === 'incoming') conversation.unreadCount = (conversation.unreadCount || 0) + 1;
  saveStore(store);
  debug(direction === 'incoming' ? 'Incoming message received' : 'Local outgoing save status', {
    conversationId: conversation.id,
    status,
    textLength: message.text.length
  });
  return message;
}

function mergedSettings(conversation) {
  return {
    ...store.globalSettings,
    ...Object.fromEntries([
      'myMode', 'talkingTo', 'replyMode', 'tone', 'emojiLevel', 'flirting', 'romantic', 'mature', 'customInstructions'
    ].map(k => [k, conversation[k]]))
  };
}

function quietHoursActive() {
  const start = String(store.globalSettings.quietStart || process.env.QUIET_START || '02:00');
  const end = String(store.globalSettings.quietEnd || process.env.QUIET_END || '07:00');
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s < e ? mins >= s && mins < e : mins >= s || mins < e;
}

function configurationIssues() {
  const issues = [];
  const add = (key, message) => issues.push(`${key}: ${message}`);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) add('PORT', 'must be a valid TCP port');
  if (TZ !== 'Asia/Kolkata') add('TZ', 'should remain Asia/Kolkata');
  if (!/^\d{2}:\d{2}$/.test(process.env.QUIET_START || '02:00')) add('QUIET_START', 'must use HH:MM format');
  if (!/^\d{2}:\d{2}$/.test(process.env.QUIET_END || '07:00')) add('QUIET_END', 'must use HH:MM format');
  return issues;
}

function normalizeGlobalSettings(input = {}) {
  const output = {};
  if (['Boy', 'Girl', 'Neutral'].includes(input.myMode)) output.myMode = input.myMode;
  if (['Boy', 'Girl', 'Neutral'].includes(input.talkingTo)) output.talkingTo = input.talkingTo;
  if (['Copy-Paste', 'Manual Send'].includes(input.replyMode)) output.replyMode = input.replyMode;
  if (['Casual', 'Friendly', 'Funny', 'Caring', 'Flirty', 'Custom'].includes(input.tone)) output.tone = input.tone;
  if (['Low', 'Normal', 'High'].includes(input.emojiLevel)) output.emojiLevel = input.emojiLevel;
  for (const key of ['flirting', 'romantic', 'mature']) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  if (typeof input.customInstructions === 'string') output.customInstructions = input.customInstructions.slice(0, 4000);
  if (/^\d{2}:\d{2}$/.test(String(input.quietStart || ''))) output.quietStart = input.quietStart;
  if (/^\d{2}:\d{2}$/.test(String(input.quietEnd || ''))) output.quietEnd = input.quietEnd;
  output.timezone = TZ;
  return output;
}

function buildPrompt(conversation) {
  const s = mergedSettings(conversation);
  const lastMessages = conversation.messages.slice(-16).map(m => `${m.direction === 'incoming' ? 'THEM' : 'ME'}: ${m.text}`).join('\n');
  const mature = s.mature ? 'Mature mode is enabled, but keep the content non-explicit and consensual.' : 'Mature mode is OFF.';
  return `You are ChatPilot, a reply suggestion assistant. Generate one natural message the user can manually copy and send. Never claim to be human. Never manipulate, guilt-trip, pressure, threaten, or encourage spam/chasing. Respect short/cold replies and keep follow-ups proportional.\n\nMy mode: ${s.myMode}\nTalking to: ${s.talkingTo}\nTone: ${s.tone}\nEmoji level: ${s.emojiLevel}\nFlirting: ${s.flirting ? 'ON' : 'OFF'}\nRomantic: ${s.romantic ? 'ON' : 'OFF'}\n${mature}\nCustom instructions: ${s.customInstructions || 'None'}\nConversation memory: ${conversation.memory || 'None'}\n\nConversation:\n${lastMessages || '(no messages yet)'}\n\nReturn only the suggested reply text. Use Hindi/Hinglish naturally with occasional English when it fits. Keep emoji usage consistent with the setting.`;
}

function configured(value) {
  return Boolean(value && !String(value).startsWith('replace_with_'));
}

async function generateGeminiReply(conversation) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!configured(apiKey)) return null;

  const prompt = buildPrompt(conversation);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.8
      }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = data?.error?.message || `Gemini HTTP ${r.status}`;
    throw new Error(message);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty reply.');
  return { text, provider: 'gemini', model };
}

async function generateOpenAIReply(conversation) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!configured(apiKey) || !configured(model)) return null;

  const prompt = buildPrompt(conversation);
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: 'You generate concise, natural reply suggestions for a private conversation.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = data?.error?.message || `OpenAI HTTP ${r.status}`;
    throw new Error(message);
  }
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned an empty reply.');
  return { text, provider: 'openai', model };
}

async function generateAIReply(conversation) {
  // Gemini is the primary provider in this local build; OpenAI remains optional.
  if (configured(process.env.GEMINI_API_KEY)) {
    return await generateGeminiReply(conversation);
  }
  if (configured(process.env.OPENAI_API_KEY) && configured(process.env.OPENAI_MODEL)) {
    return await generateOpenAIReply(conversation);
  }
  return {
    text: heuristicReply(conversation),
    provider: 'local-fallback',
    note: 'GEMINI_API_KEY or OPENAI_API_KEY/OPENAI_MODEL is not configured.'
  };
}

function heuristicReply(conversation) {
  const lastIncoming = [...conversation.messages].reverse().find(m => m.direction === 'incoming')?.text?.trim() || '';
  const s = mergedSettings(conversation);
  if (!lastIncoming) return 'Hey 😄 kya scene hai?';
  const lower = lastIncoming.toLowerCase();
  if (/^(hmm+|hm+|ok+|k|acha+|accha+|haan|ha|yes|yup|thik|theek)\W*$/i.test(lower)) {
    return s.flirting ? 'Haha 😄 waise aaj kya kar rahi ho?' : 'Haha 😄 waise kya chal raha hai?';
  }
  if (lower.includes('busy')) return 'No worries 😄 free ho jao toh baat karte hain.';
  if (lower.includes('thanks') || lower.includes('thank')) return 'Anytime 😊';
  return s.tone === 'Funny' ? 'Achhaaa 😄 ab ye interesting ho gaya.' : 'Haan, samajh raha hoon 😄';
}

function shouldExcludeFromZip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const parts = normalized.split('/');
  const base = parts.at(-1) || '';
  if (parts.some(part => ['node_modules', '.git', '.cache', 'coverage', 'tmp', 'temp'].includes(part))) return true;
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;
  if (base === '.npmrc' || base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.log') || base.endsWith('.zip')) return true;
  if (/^(credentials?|secrets?|cookies?|sessions?)\b/i.test(base)) return true;
  return false;
}

function projectFilesForZip() {
  const files = [];
  const walk = (dir, rel = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue;
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (shouldExcludeFromZip(r)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(abs, r);
      else files.push(r);
    }
  };
  walk(ROOT);
  return files;
}

function createZip(target, done) {
  const files = projectFilesForZip();
  if (!files.length) return done(new Error('No safe project files were found.'));
  const isWin = process.platform === 'win32';
  if (isWin) {
    const ps = [
      `$files = ${JSON.stringify(files)};`,
      `Set-Location -LiteralPath ${JSON.stringify(ROOT)};`,
      `Compress-Archive -LiteralPath $files -DestinationPath ${JSON.stringify(target)} -Force;`
    ].join(' ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], (error, stdout, stderr) => {
      if (error) return done(new Error(stderr?.trim() || 'ZIP creation failed.'));
      done(null);
    });
    return;
  }
  const result = spawnSync('zip', ['-qr', target, ...files], { cwd: ROOT });
  if (result.status !== 0) return done(new Error(result.stderr?.toString() || 'zip command failed'));
  done(null);
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathName = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
      return res.end();
    }

    if (req.method === 'GET' && pathName === '/api/health') {
      return send(res, 200, {
        ok: true,
        port: PORT,
        timezone: TZ,
        mode: 'local-only',
        aiProvider: configured(process.env.GEMINI_API_KEY) ? 'gemini' : (configured(process.env.OPENAI_API_KEY) && configured(process.env.OPENAI_MODEL) ? 'openai' : 'local-fallback'),
        aiModel: configured(process.env.GEMINI_API_KEY) ? (process.env.GEMINI_MODEL || 'gemini-3.8-flash') : (configured(process.env.OPENAI_MODEL) ? process.env.OPENAI_MODEL : null),
        autoReply: false,
        quietHours: `${store.globalSettings.quietStart}–${store.globalSettings.quietEnd}`,
        quietHoursActive: quietHoursActive(),
        configurationIssues: configurationIssues()
      });
    }

    if (req.method === 'GET' && pathName === '/api/bootstrap') {
      return send(res, 200, { globalSettings: store.globalSettings, conversations: store.conversations });
    }

    if (req.method === 'GET' && pathName === '/api/debug') {
      return send(res, 200, { events: debugEvents });
    }

    if (req.method === 'POST' && pathName === '/api/conversations') {
      const body = await readJson(req);
      return send(res, 201, createConversation(body));
    }

    const convMatch = pathName.match(/^\/api\/conversations\/([^/]+)(?:\/(.*))?$/);
    if (convMatch) {
      const id = decodeURIComponent(convMatch[1]);
      const action = convMatch[2] || '';
      const conversation = getConversation(id);
      if (!conversation) return send(res, 404, { error: 'Conversation not found' });

      if (req.method === 'DELETE' && !action) {
        store.conversations = store.conversations.filter(c => c.id !== id);
        saveStore(store);
        debug('Conversation deleted', { conversationId: id });
        return send(res, 200, { ok: true });
      }

      if (req.method === 'PATCH' && !action) {
        const body = await readJson(req);
        const settings = normalizeConversationInput({ ...conversation, ...body });
        Object.assign(conversation, settings, { updatedAt: now() });
        saveStore(store);
        return send(res, 200, conversation);
      }

      if (req.method === 'POST' && action === 'read') {
        conversation.unreadCount = 0;
        saveStore(store);
        return send(res, 200, conversation);
      }

      if (req.method === 'POST' && action === 'incoming') {
        const body = await readJson(req);
        if (!body.text?.trim()) return send(res, 400, { error: 'Incoming message text is required.' });
        const msg = addMessage(conversation, 'incoming', body.text, 'received');
        return send(res, 201, msg);
      }

      if (req.method === 'POST' && action === 'outgoing') {
        const body = await readJson(req);
        if (!body.text?.trim()) return send(res, 400, { error: 'Outgoing message text is required.' });
        const msg = addMessage(conversation, 'outgoing', body.text, 'local');
        return send(res, 201, msg);
      }

      if (req.method === 'POST' && action === 'generate') {
        try {
          debug('AI request status', { conversationId: conversation.id, status: 'started' });
          const result = await generateAIReply(conversation);
          debug('AI response status', { conversationId: conversation.id, provider: result.provider, status: 'success' });
          return send(res, 200, result);
        } catch (error) {
          debug('AI response status', { conversationId: conversation.id, status: 'failed' });
          return send(res, 502, { error: error.message });
        }
      }

    }

    if (req.method === 'GET' && pathName === '/api/settings') {
      return send(res, 200, store.globalSettings);
    }

    if (req.method === 'PATCH' && pathName === '/api/settings') {
      const body = await readJson(req);
      store.globalSettings = { ...store.globalSettings, ...normalizeGlobalSettings(body) };
      saveStore(store);
      return send(res, 200, store.globalSettings);
    }

    if (req.method === 'GET' && pathName === '/api/export') {
      const target = path.join(DATA_DIR, `chatpilot-project-${Date.now()}.zip`);
      debug('ZIP export started');
      createZip(target, (err) => {
        if (err) {
          debug('ZIP export failed');
          return send(res, 500, { error: 'Unable to create ZIP. Please try again.' });
        }
        debug('ZIP export ready');
        const filename = 'chatpilot-project.zip';
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store'
        });
        const stream = fs.createReadStream(target);
        stream.on('close', () => { try { fs.unlinkSync(target); } catch {} });
        stream.pipe(res);
      });
      return;
    }

    if (req.method === 'GET') {
      const requested = pathName === '/' ? 'index.html' : pathName.replace(/^\//, '');
      const safe = path.normalize(requested).replace(/^\.\.(?:[\\/]|$)/, '');
      const file = path.join(PUBLIC_DIR, safe);
      if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      }
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'Internal server error' });
  }
}

const server = http.createServer(handle);
const startupIssues = configurationIssues();
if (startupIssues.length) {
  console.warn(`Configuration warnings (values hidden): ${startupIssues.join('; ')}`);
}
server.listen(PORT, () => {
  console.log(`ChatPilot running on http://localhost:${PORT}`);
  console.log('Mode: LOCAL ONLY — no Instagram/Meta webhook');
  console.log('Automatic replies: OFF');
});
