import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDb, createUser, getUserByEmail, createSession, getUserByTokenHash, deleteSession, listConversations, createConversation, getConversation, updateConversation, deleteConversation, listMessages, addMessage, createAttachment, getAttachment, getUserAISettings, upsertUserAISettings, deleteUserAISettings } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_DAYS = 30;
const COOKIE_NAME = 'chatpilot_session';
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const APP_SECRET = process.env.APP_SECRET || 'chatpilot-local-dev-change-me';

function cryptoKey(){ return crypto.createHash('sha256').update(APP_SECRET).digest(); }
function encryptSecret(value){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',cryptoKey(),iv);
  const enc=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}
function decryptSecret(value){
  const [ivB,tagB,encB]=String(value||'').split('.');
  if(!ivB||!tagB||!encB) throw new Error('Stored API credential is invalid.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',cryptoKey(),Buffer.from(ivB,'base64'));
  decipher.setAuthTag(Buffer.from(tagB,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB,'base64')),decipher.final()]).toString('utf8');
}

function send(res,status,body,headers={}){const data=Buffer.from(typeof body==='string'?body:JSON.stringify(body));res.writeHead(status,{'Content-Type':typeof body==='string'?'text/plain; charset=utf-8':'application/json; charset=utf-8','Content-Length':data.length,...headers});res.end(data);}
function json(res,status,data,headers={}){send(res,status,data,headers)}
function parseCookies(req){const out={};for(const part of(req.headers.cookie||'').split(';')){const[k,...v]=part.trim().split('=');if(k)out[k]=decodeURIComponent(v.join('='));}return out;}
function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex');}
function makeToken(){return crypto.randomBytes(32).toString('base64url');}
function cookie(token,maxAge){const secure=process.env.NODE_ENV==='production'?'; Secure':'';return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;}
async function body(req){const chunks=[];for await(const c of req)chunks.push(c);if(!chunks.length)return{};const raw=Buffer.concat(chunks).toString();if(raw.length>MAX_UPLOAD_BYTES*1.5)throw Object.assign(new Error('Request too large'),{status:413});try{return JSON.parse(raw)}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
function normalizeEmail(e){return String(e||'').trim().toLowerCase();}
function isEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}
function passwordHash(password,saltHex=crypto.randomBytes(16).toString('hex')){const hash=crypto.scryptSync(password,saltHex,64).toString('hex');return `scrypt:${saltHex}:${hash}`;}
function verifyPassword(password,stored){const[algo,salt,hex]=String(stored).split(':');if(algo!=='scrypt'||!salt||!hex)return false;const got=crypto.scryptSync(password,salt,64).toString('hex');return crypto.timingSafeEqual(Buffer.from(got,'hex'),Buffer.from(hex,'hex'));}
function cleanUser(u){return{id:u.id,email:u.email,created_at:u.created_at};}
async function auth(req){const raw=parseCookies(req)[COOKIE_NAME];if(!raw)return null;return getUserByTokenHash(hashToken(raw));}
async function requireAuth(req,res){const u=await auth(req);if(!u){json(res,401,{error:'AUTH_REQUIRED'});return null;}return u;}
function safeFileName(name){return String(name||'file').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120)||'file';}

function clampText(value, max=5000){return String(value||'').slice(0,max).trim()}
function buildConversationText(messages){
  return messages.slice(-80).map(m=>`${m.direction==='incoming'?'THEM':'ME'}: ${clampText(m.text,650)}`).join('\n');
}
function buildStylePrompt(settings={}){
  const tone=settings.tone||'Casual';
  const emoji=settings.emojiLevel||'Low';
  const flirting=settings.flirting?'ON':'OFF';
  const romantic=settings.romantic?'ON':'OFF';
  const mature=settings.mature?'ON':'OFF';
  const myMode=settings.myMode||'Neutral';
  const talkingTo=settings.talkingTo||'Neutral';
  const custom=clampText(settings.instructions,1800);
  const responseStyle=settings.responseStyle||'Ongoing conversation';
  return `You are the writing assistant inside ChatPilot.\n\nCore behavior:\n- Understand the user's intent before writing.\n- Be direct and useful first; when the user asks for a solution, give a practical solution instead of generic filler.\n- For chat messages, write something that sounds natural, human-written, context-aware, and ready to send.\n- Keep wording fresh and avoid repetitive templates or robotic phrases.\n- Match the conversation's language: Hindi, Hinglish, or English as appropriate.\n- Preserve the user's intended meaning; do not invent facts or commitments.\n- Do not manipulate, guilt-trip, pressure, threaten, or harass the other person.\n- Never pretend you personally did something that you did not do.\n- If the user asks a direct question, answer it clearly.\n\nChat style settings:\n- My mode: ${myMode}\n- Talking to: ${talkingTo}\n- Tone: ${tone}\n- Emoji level: ${emoji}\n- Flirting: ${flirting}\n- Romantic: ${romantic}\n- Mature: ${mature}\n- Custom instructions: ${custom||'None'}\n- Response style: ${responseStyle}\n\nConversation behavior:\n- Treat this as an ongoing conversation, not a one-off reply. Maintain continuity with earlier messages and reuse relevant details naturally.\n- If the other person asks something, answer it clearly. If they seem to want a solution, give the practical next step.\n- Ask a relevant question only when it naturally moves the conversation forward; do not force a question into every reply.\n- When the user wants to keep talking for a long time, vary the wording and keep the flow natural instead of repeating the same pattern.\n- If a next action would help (for example, making a plan, choosing an option, or taking a step), suggest it naturally.\n\nOutput rules:\n- Return one polished response by default.\n- No quotation marks around the response.\n- No labels like 'Reply:' or 'Suggested message:'.\n- Keep it concise unless the context needs more detail.\n- When generating a message, make it genuinely usable as-is.`;
}
async function generateAI(messages, settings={}, requestPrompt='', mode='reply', aiConfig={}){
  const provider=String(aiConfig.provider||'').trim().toLowerCase();
  const key=aiConfig.apiKey;
  const model=String(aiConfig.model||'').trim() || (provider==='gemini'?'gemini-3.5-flash':'');
  if(!key||!model) return {text:'AI is not configured yet. Open AI API settings and add your API key and model.',source:'config'};
  const style=buildStylePrompt(settings);
  const context=buildConversationText(messages);
  let task='Generate a natural reply to the latest incoming message.';
  if(mode==='message') task='Generate a ready-to-send message based on the user intention below. Make it natural, specific, and unique rather than a generic rewrite.';
  if(mode==='chat') task='Continue the conversation naturally from the latest context. Answer the latest point, keep continuity, and move the conversation forward when appropriate.';
  const prompt=`${style}\n\nTASK: ${task}\n\nUser intention / prompt:\n${clampText(requestPrompt,2200)||'None provided'}\n\nConversation:\n${context||'(No messages yet)'}\n\nWrite the final response now.`;
  if(provider==='gemini'){
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.9,maxOutputTokens:350}})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data?.error?.message||`Gemini HTTP ${r.status}`);
    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
    if(!text)throw new Error('Gemini returned no text');
    return{text,source:`gemini:${model}`};
  }
  const isOpenAI=provider==='openai'||provider==='openai-compatible';
  if(isOpenAI){
    const rawBase=String(aiConfig.baseUrl||'https://api.openai.com/v1').trim().replace(/\\+$/,'');
    const base=rawBase.replace(/\\/g,'/');
    const endpoint=/\/chat\/completions$/.test(base)?base:`${base}/chat/completions`;
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'system',content:style},{role:'user',content:`TASK: ${task}\n\nUser intention / prompt:\n${clampText(requestPrompt,2200)||'None provided'}\n\nConversation:\n${context||'(No messages yet)'}`}],temperature:0.9,max_tokens:350})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data?.error?.message||`AI HTTP ${r.status}`);
    const text=data?.choices?.[0]?.message?.content?.trim()||'';
    if(!text)throw new Error('AI returned no text');
    return{text,source:`${provider}:${model}`};
  }
  throw new Error('Unsupported AI provider. Choose Gemini, OpenAI, or OpenAI-compatible.');
}
async function api(req,res,url){
  if(req.method==='POST'&&url.pathname==='/api/auth/register'){const b=await body(req),email=normalizeEmail(b.email),password=String(b.password||'');if(!isEmail(email))return json(res,400,{error:'Enter a valid email.'});if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters.'});try{const user=await createUser(email,passwordHash(password));const token=makeToken(),expires=new Date(Date.now()+SESSION_DAYS*864e5).toISOString();await createSession(user.id,hashToken(token),expires);return json(res,201,{user:cleanUser(user)},{'Set-Cookie':cookie(token,SESSION_DAYS*86400)});}catch(e){if(e.message==='EMAIL_EXISTS')return json(res,409,{error:'An account with that email already exists.'});throw e;}}
  if(req.method==='POST'&&url.pathname==='/api/auth/login'){const b=await body(req),email=normalizeEmail(b.email),password=String(b.password||''),user=await getUserByEmail(email);if(!user||!verifyPassword(password,user.password_hash))return json(res,401,{error:'Invalid email or password.'});const token=makeToken(),expires=new Date(Date.now()+SESSION_DAYS*864e5).toISOString();await createSession(user.id,hashToken(token),expires);return json(res,200,{user:cleanUser(user)},{'Set-Cookie':cookie(token,SESSION_DAYS*86400)});}
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){const raw=parseCookies(req)[COOKIE_NAME];if(raw)await deleteSession(hashToken(raw));return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
  if(req.method==='GET'&&url.pathname==='/api/auth/me'){const user=await auth(req);return json(res,200,{authenticated:Boolean(user),user:user?cleanUser(user):null});}

  const user=await requireAuth(req,res);if(!user)return;
  if(req.method==='GET'&&url.pathname==='/api/conversations')return json(res,200,{conversations:await listConversations(user.id)});
  if(req.method==='POST'&&url.pathname==='/api/conversations'){const b=await body(req);if(!String(b.name||'').trim())return json(res,400,{error:'Chat name is required.'});return json(res,201,{conversation:await createConversation(user.id,{name:String(b.name),settings:b.settings||{}})});}
  const cm=url.pathname.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|delete|settings))?$/);
  if(cm){const conversationId=cm[1],action=cm[2]||'',c=await getConversation(user.id,conversationId);if(!c)return json(res,404,{error:'Conversation not found.'});if(req.method==='GET'&&action==='messages')return json(res,200,{messages:await listMessages(user.id,conversationId)});
    if(req.method==='POST'&&action==='messages'){const b=await body(req),text=String(b.text||'').trim(),direction=b.direction==='outgoing'?'outgoing':'incoming';if(!text&&!b.attachmentId)return json(res,400,{error:'Message is empty.'});let attachment=null;if(b.attachmentId){attachment=await getAttachment(user.id,String(b.attachmentId));if(!attachment)return json(res,404,{error:'Attachment not found.'});}return json(res,201,{message:await addMessage(user.id,conversationId,direction,text,String(b.status||'saved'),attachment)});}
    if(req.method==='PATCH'&&action==='settings'){const b=await body(req);const next=await updateConversation(user.id,conversationId,{name:b.name,settings:b.settings});return json(res,200,{conversation:next});}
    if(req.method==='DELETE'&&action==='delete'){await deleteConversation(user.id,conversationId);return json(res,200,{ok:true});}
  }
  if(req.method==='POST'&&url.pathname==='/api/files/upload'){
    const b=await body(req),name=safeFileName(b.name),mime=String(b.mime||'application/octet-stream'),base64=String(b.data||'').replace(/^data:[^;]+;base64,/,'');
    const buf=Buffer.from(base64,'base64');if(!buf.length)return json(res,400,{error:'Empty file.'});if(buf.length>MAX_UPLOAD_BYTES)return json(res,413,{error:'File too large. Maximum is 8 MB.'});
    const id=crypto.randomUUID(),dir=path.join(UPLOAD_DIR,user.id);await fs.mkdir(dir,{recursive:true});const diskName=`${id}-${name}`;const storagePath=path.join(dir,diskName);await fs.writeFile(storagePath,buf);const attachment=await createAttachment(user.id,{originalName:name,mime,size:buf.length,storagePath});return json(res,201,{attachment:{id:attachment.id,name:attachment.original_name,mime:attachment.mime,size:attachment.size,url:`/api/files/${attachment.id}`}});
  }
  const fm=url.pathname.match(/^\/api\/files\/([^/]+)$/);if(fm&&req.method==='GET'){const att=await getAttachment(user.id,fm[1]);if(!att)return send(res,404,'Not found');const data=await fs.readFile(att.storage_path);res.writeHead(200,{'Content-Type':att.mime,'Content-Length':data.length,'Content-Disposition':`inline; filename="${att.original_name.replace(/"/g,'')}"`,'Cache-Control':'private, max-age=3600'});return res.end(data);}
  if(req.method==='GET'&&url.pathname==='/api/settings/ai'){
    const row=await getUserAISettings(user.id);
    if(row) return json(res,200,{configured:true,provider:row.provider,model:row.model,baseUrl:row.base_url||''});
    return json(res,200,{configured:false,provider:'gemini',model:process.env.GEMINI_MODEL||'',baseUrl:''});
  }
  if(req.method==='PUT'&&url.pathname==='/api/settings/ai'){
    const b=await body(req),provider=String(b.provider||'gemini').trim().toLowerCase(),model=(String(b.model||'').trim()||(String(b.provider||'gemini').toLowerCase()==='gemini'?'gemini-3.5-flash':'')),apiKey=String(b.apiKey||'').trim(),baseUrl=String(b.baseUrl||'').trim();
    if(!['gemini','openai','openai-compatible'].includes(provider)) return json(res,400,{error:'Choose Gemini, OpenAI, or OpenAI-compatible.'});
    if(!apiKey||!model)return json(res,400,{error:'API key and model are required.'});
    if(provider==='openai-compatible'&&!/^https?:\/\//i.test(baseUrl))return json(res,400,{error:'OpenAI-compatible API needs a valid Base URL.'});
    await upsertUserAISettings(user.id,{provider,model,apiKeyEnc:encryptSecret(apiKey),baseUrl});
    return json(res,200,{ok:true,configured:true,provider,model,baseUrl});
  }
  if(req.method==='DELETE'&&url.pathname==='/api/settings/ai'){ await deleteUserAISettings(user.id); return json(res,200,{ok:true}); }
  if(req.method==='POST'&&url.pathname==='/api/ai/reply'){const b=await body(req),conversationId=String(b.conversationId||''),c=await getConversation(user.id,conversationId);if(!c)return json(res,404,{error:'Conversation not found.'});const messages=await listMessages(user.id,conversationId);try{const saved=await getUserAISettings(user.id);const aiConfig=saved?{provider:saved.provider,model:saved.model,apiKey:decryptSecret(saved.api_key_enc),baseUrl:saved.base_url||''}:{provider:'gemini',model:process.env.GEMINI_MODEL||'',apiKey:process.env.GEMINI_API_KEY||'',baseUrl:''};return json(res,200,await generateAI(messages,c.settings,b.prompt,b.mode||'reply',aiConfig));}catch(e){return json(res,503,{error:e.message,source:'ai'});}}
  return json(res,404,{error:'Not found'});
}

async function staticFile(res,urlPath){const safe=path.normalize(urlPath==='/'?'/index.html':urlPath).replace(/^\/+/,''),file=path.join(PUBLIC_DIR,safe);if(!file.startsWith(PUBLIC_DIR))return false;try{const data=await fs.readFile(file),ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);return true;}catch{return false;}}

await initDb();
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(await staticFile(res,url.pathname))return;send(res,404,'Not found');}catch(e){console.error(e);json(res,e.status||500,{error:e.message||'Server error'});}});
server.listen(PORT,HOST,()=>console.log(`ChatPilot Multi-User running on http://${HOST==='0.0.0.0'?'localhost':HOST}:${PORT}`));
