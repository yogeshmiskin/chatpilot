import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  participant_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  attachment_id TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id, created_at);
CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  base_url TEXT,
  updated_at TEXT NOT NULL
);
`;

let sqlite;
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }

export async function initDb() {
  sqlite = new DatabaseSync(process.env.SQLITE_PATH || './chatpilot.sqlite');
  sqlite.exec(schema);
  // Lightweight migration for databases created by older ChatPilot builds.
  const cols = sqlite.prepare('PRAGMA table_info(messages)').all().map(x=>x.name);
  const add = [
    ['attachment_id','TEXT'],['attachment_name','TEXT'],['attachment_mime','TEXT'],['attachment_size','INTEGER']
  ];
  for (const [name,type] of add) if (!cols.includes(name)) sqlite.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
}
export async function createUser(email, passwordHash) {
  const user = { id: id(), email: email.toLowerCase(), password_hash: passwordHash, created_at: now() };
  try { sqlite.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(user.id,user.email,user.password_hash,user.created_at); return { id:user.id,email:user.email,created_at:user.created_at }; }
  catch(e){ if(String(e.message).includes('UNIQUE')) throw new Error('EMAIL_EXISTS'); throw e; }
}
export async function getUserByEmail(email){ return sqlite.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) ?? null; }
export async function getUserById(userId){ return sqlite.prepare('SELECT id,email,created_at FROM users WHERE id=?').get(userId) ?? null; }
export async function createSession(userId, tokenHash, expiresAt){ const row={id:id(),user_id:userId,token_hash:tokenHash,expires_at:expiresAt,created_at:now()}; sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)').run(row.id,row.user_id,row.token_hash,row.expires_at,row.created_at); return row; }
export async function getUserByTokenHash(tokenHash){ return sqlite.prepare('SELECT u.id,u.email,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?').get(tokenHash,now()) ?? null; }
export async function deleteSession(tokenHash){ sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); }
export async function listConversations(userId){ return sqlite.prepare('SELECT id,name,participant_id,settings_json,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC').all(userId).map(c=>({...c,settings:JSON.parse(c.settings_json||'{}')})); }
export async function createConversation(userId,{name,participantId='',settings={}}){ const row={id:id(),user_id:userId,name:name.trim()||'New Chat',participant_id:participantId||null,settings_json:JSON.stringify(settings),created_at:now(),updated_at:now()}; sqlite.prepare('INSERT INTO conversations (id,user_id,name,participant_id,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(...Object.values(row)); return {...row,settings}; }
export async function getConversation(userId,conversationId){ const c=sqlite.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(conversationId,userId) ?? null; return c ? {...c,settings:JSON.parse(c.settings_json||'{}')} : null; }
export async function updateConversation(userId,conversationId,{name,participantId,settings}={}){ const c=await getConversation(userId,conversationId); if(!c) return null; const nextName = name===undefined?c.name:String(name).trim()||c.name; const nextParticipant = participantId===undefined?c.participant_id:(String(participantId).trim()||null); const nextSettings=settings===undefined?c.settings:settings; const updated=now(); sqlite.prepare('UPDATE conversations SET name=?,participant_id=?,settings_json=?,updated_at=? WHERE id=? AND user_id=?').run(nextName,nextParticipant,JSON.stringify(nextSettings||{}),updated,conversationId,userId); return await getConversation(userId,conversationId); }
export async function deleteConversation(userId,conversationId){ const c=await getConversation(userId,conversationId); if(!c)return false; sqlite.prepare('DELETE FROM messages WHERE conversation_id=? AND user_id=?').run(conversationId,userId); sqlite.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(conversationId,userId); return true; }
export async function touchConversation(userId,conversationId){ sqlite.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?').run(now(),conversationId,userId); }
export async function listMessages(userId,conversationId){ return sqlite.prepare('SELECT id,direction,text,status,attachment_id,attachment_name,attachment_mime,attachment_size,created_at FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at ASC').all(conversationId,userId); }
export async function addMessage(userId,conversationId,direction,text,status='saved',attachment=null){ const row={id:id(),user_id:userId,conversation_id:conversationId,direction,text,status,attachment_id:attachment?.id||null,attachment_name:attachment?.original_name||null,attachment_mime:attachment?.mime||null,attachment_size:attachment?.size||null,created_at:now()}; sqlite.prepare('INSERT INTO messages (id,user_id,conversation_id,direction,text,status,attachment_id,attachment_name,attachment_mime,attachment_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row)); await touchConversation(userId,conversationId); return row; }
export async function createAttachment(userId,{originalName,mime,size,storagePath}){ const row={id:id(),user_id:userId,original_name:originalName,mime,size,storage_path:storagePath,created_at:now()}; sqlite.prepare('INSERT INTO attachments (id,user_id,original_name,mime,size,storage_path,created_at) VALUES (?,?,?,?,?,?,?)').run(...Object.values(row)); return row; }
export async function getAttachment(userId,attachmentId){ return sqlite.prepare('SELECT * FROM attachments WHERE id=? AND user_id=?').get(attachmentId,userId) ?? null; }

export async function getUserAISettings(userId){ return sqlite.prepare('SELECT * FROM user_ai_settings WHERE user_id=?').get(userId) ?? null; }
export async function upsertUserAISettings(userId,{provider,model,apiKeyEnc,baseUrl=''}){ const row={user_id:userId,provider:String(provider||'gemini'),model:String(model||''),api_key_enc:String(apiKeyEnc||''),base_url:String(baseUrl||''),updated_at:now()}; sqlite.prepare(`INSERT INTO user_ai_settings (user_id,provider,model,api_key_enc,base_url,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,api_key_enc=excluded.api_key_enc,base_url=excluded.base_url,updated_at=excluded.updated_at`).run(row.user_id,row.provider,row.model,row.api_key_enc,row.base_url,row.updated_at); return row; }
export async function deleteUserAISettings(userId){ sqlite.prepare('DELETE FROM user_ai_settings WHERE user_id=?').run(userId); }
