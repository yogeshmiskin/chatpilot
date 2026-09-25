import crypto from 'node:crypto';
import { config } from './config.js';

export function validSignature(raw, sig){
  if(!config.instagram.appSecret) return true;
  if(!sig?.startsWith('sha256=')) return false;
  const expected='sha256='+crypto.createHmac('sha256',config.instagram.appSecret).update(raw).digest('hex');
  const a=Buffer.from(expected), b=Buffer.from(sig);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

export async function sendText(recipientId,text){
  if(!config.instagram.accessToken || !config.instagram.accountId) throw new Error('Instagram API is not configured. Fill IG_ACCESS_TOKEN and IG_ACCOUNT_ID in .env.');
  const url=`https://graph.instagram.com/${config.instagram.apiVersion}/${encodeURIComponent(config.instagram.accountId)}/messages`;
  const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.instagram.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:recipientId},message:{text}})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Instagram API ${r.status}: ${body?.error?.message || JSON.stringify(body)}`);
  return body;
}

export function incoming(payload){
  const out=[];
  for(const entry of payload?.entry||[]){
    for(const evt of entry?.messaging||[]){
      if(evt?.sender?.id && evt?.message?.text){
        out.push({senderId:String(evt.sender.id), text:String(evt.message.text), messageId:evt.message.mid?String(evt.message.mid):null});
      }
    }
  }
  return out;
}
