import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { addMessage, conversation, conversations, messages, setAI, upsertConversation } from './store.js';
import { incoming, sendText, validSignature } from './instagram.js';
import { replyFor } from './ai.js';
import { quiet } from './time.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir=path.join(root,'public');
const timers=new Map();

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>2_000_000)req.destroy();});req.on('end',()=>resolve(raw));req.on('error',reject);});}
function mime(file){return {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}[path.extname(file)]||'application/octet-stream';}
function serve(file,res){fs.readFile(file,(e,b)=>e?res.writeHead(404).end('Not found'):(res.writeHead(200,{'Content-Type':mime(file)}),res.end(b)));}
function health(){return {ok:true,botEnabled:config.bot.enabled,quietHours:`${config.bot.quietStart}–${config.bot.quietEnd}`,timezone:config.timezone,instagramConfigured:Boolean(config.instagram.accessToken&&config.instagram.accountId),aiConfigured:Boolean(config.openai.apiKey),tone:config.bot.tone,flirtLevel:config.bot.flirtLevel,emojiLevel:config.bot.emojiLevel,matureMode:config.bot.matureMode};}

async function handleIncoming(evt){
  upsertConversation(evt.senderId);
  addMessage({participantId:evt.senderId,direction:'in',text:evt.text,externalId:evt.messageId});
  const c=conversation(evt.senderId);
  if(!config.bot.enabled || !c?.ai_enabled || quiet(new Date(),config.timezone,config.bot.quietStart,config.bot.quietEnd)) return;
  const old=timers.get(evt.senderId); if(old) clearTimeout(old);
  const span=Math.max(0,config.bot.maxDelayMs-config.bot.minDelayMs);
  const delay=config.bot.minDelayMs+Math.floor(Math.random()*(span+1));
  const timer=setTimeout(async()=>{
    timers.delete(evt.senderId);
    try{
      const latest=conversation(evt.senderId);
      if(!latest?.ai_enabled || quiet(new Date(),config.timezone,config.bot.quietStart,config.bot.quietEnd)) return;
      const text=await replyFor(messages(evt.senderId,30));
      const sent=await sendText(evt.senderId,text);
      addMessage({participantId:evt.senderId,direction:'out',text,externalId:sent?.message_id||null});
    }catch(e){ console.error('Auto-reply error:',e.message); }
  },delay);
  timers.set(evt.senderId,timer);
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET' && u.pathname==='/webhook/instagram'){
      const mode=u.searchParams.get('hub.mode'), token=u.searchParams.get('hub.verify_token'), challenge=u.searchParams.get('hub.challenge');
      return mode==='subscribe' && token===config.instagram.verifyToken ? (res.writeHead(200,{'Content-Type':'text/plain'}),res.end(challenge||'')) : res.writeHead(403).end('Forbidden');
    }
    if(req.method==='POST' && u.pathname==='/webhook/instagram'){
      const raw=await body(req);
      if(!validSignature(raw,req.headers['x-hub-signature-256'])) return res.writeHead(403).end('Forbidden');
      let payload={}; try{payload=JSON.parse(raw);}catch{return res.writeHead(400).end('Bad JSON');}
      res.writeHead(200);res.end('EVENT_RECEIVED');
      for(const evt of incoming(payload)) handleIncoming(evt);
      return;
    }
    if(req.method==='GET' && u.pathname==='/api/health') return json(res,200,health());
    if(req.method==='GET' && u.pathname==='/api/conversations') return json(res,200,conversations());
    if(req.method==='GET' && u.pathname.startsWith('/api/conversations/')){
      const id=decodeURIComponent(u.pathname.split('/').at(-1)); return json(res,200,{conversation:conversation(id),messages:messages(id)});
    }
    if(req.method==='POST' && u.pathname.startsWith('/api/conversations/') && u.pathname.endsWith('/ai')){
      const bits=u.pathname.split('/'); const id=decodeURIComponent(bits.at(-2)); const raw=await body(req); const data=JSON.parse(raw||'{}'); setAI(id,Boolean(data.enabled)); return json(res,200,{ok:true,enabled:Boolean(data.enabled)});
    }
    if(req.method==='POST' && u.pathname==='/api/send'){
      const data=JSON.parse(await body(req)||'{}'); const id=String(data.participantId||'').trim(); const text=String(data.text||'').trim();
      if(!id||!text) return json(res,400,{error:'participantId and text are required'});
      const sent=await sendText(id,text); upsertConversation(id); addMessage({participantId:id,direction:'out',text,externalId:sent?.message_id||null}); return json(res,200,{ok:true,result:sent});
    }
    let p=u.pathname==='/'?'/index.html':u.pathname; const file=path.normalize(path.join(publicDir,p));
    if(!file.startsWith(publicDir)) return res.writeHead(403).end('Forbidden');
    return serve(file,res);
  }catch(e){console.error(e); if(!res.headersSent) json(res,500,{error:e.message});}
});

server.listen(config.port,()=>console.log(`Instagram AI dashboard: http://localhost:${config.port}`));
