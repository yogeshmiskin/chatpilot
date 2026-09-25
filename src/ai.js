import { config } from './config.js';

export async function replyFor(messages){
  if(!config.openai.apiKey) return 'Haan 😄 batao, kya scene hai?';
  const system = `You are a conversational assistant replying on behalf of the Instagram account owner.\n`+
    `Use natural Hindi/Hinglish with occasional English. Tone: ${config.bot.tone}.\n`+
    `Flirt level: ${config.bot.flirtLevel}. Use light, context-appropriate flirting only; never pressure or manipulate.\n`+
    `Emoji level: ${config.bot.emojiLevel}.\n`+
    `Mature romantic mode: ${config.bot.matureMode?'enabled only for clearly adult and mutually comfortable conversations':'disabled'}.\n`+
    `Keep replies concise. Do not repeatedly chase short/closed replies. Do not request or extract private information. If directly asked whether AI is involved, be truthful. Return only the message text.`;
  const input=messages.map(m=>({role:m.direction==='out'?'assistant':'user',content:m.text}));
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${config.openai.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.openai.model,input:[{role:'system',content:system},...input]})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`OpenAI API ${r.status}: ${body?.error?.message || JSON.stringify(body)}`);
  return String(body.output_text || '').trim() || 'Haan, batao 😊';
}
