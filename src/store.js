import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'instagram-bot-data.json');

function load() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { conversations: {}, messages: [] }; }
}
function save(db) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function upsertConversation(id, name=null) {
  const db = load();
  const now = Date.now();
  const c = db.conversations[id];
  db.conversations[id] = {
    participant_id: id,
    participant_name: name || c?.participant_name || null,
    ai_enabled: c?.ai_enabled ?? 1,
    last_message_at: now,
    created_at: c?.created_at ?? now
  };
  save(db);
}

export function addMessage({participantId, direction, text, externalId=null}) {
  const db = load();
  const now = Date.now();
  db.messages.push({
    id: (db.messages.at(-1)?.id || 0) + 1,
    participant_id: participantId,
    direction,
    text,
    external_id: externalId,
    created_at: now
  });
  if (!db.conversations[participantId]) {
    db.conversations[participantId] = { participant_id: participantId, participant_name: null, ai_enabled: 1, created_at: now, last_message_at: now };
  } else db.conversations[participantId].last_message_at = now;
  save(db);
}

export function conversations() {
  const db = load();
  return Object.values(db.conversations).sort((a,b)=>b.last_message_at-a.last_message_at).map(c=>({
    ...c,
    last_text: db.messages.filter(m=>m.participant_id===c.participant_id).at(-1)?.text || ''
  }));
}
export function conversation(id) { return load().conversations[id] || null; }
export function messages(id, limit=40) { return load().messages.filter(m=>m.participant_id===id).slice(-limit); }
export function setAI(id, enabled) {
  const db = load();
  db.conversations[id] ??= { participant_id:id, participant_name:null, ai_enabled:1, created_at:Date.now(), last_message_at:Date.now() };
  db.conversations[id].ai_enabled = enabled ? 1 : 0;
  save(db);
}
