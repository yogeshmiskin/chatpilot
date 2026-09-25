const $=s=>document.querySelector(s);
let registerMode=false,me=null,chats=[],active=null,messages=[],pendingFile=null,messageDirection='outgoing',lastGeneration={mode:'reply',prompt:''};
function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\':'&#92;','"':'&quot;'}[c]))}
function formatBytes(n){if(!n)return'';const u=['B','KB','MB','GB'];let i=0,x=n;while(x>=1024&&i<u.length-1){x/=1024;i++;}return `${x.toFixed(i?1:0)} ${u[i]}`}
async function api(path,opts={}){const r=await fetch(path,{headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
function setAuthMsg(t){$('#authMsg').textContent=t||''}
function setAuthMode(reg){registerMode=reg;$('#loginTab').classList.toggle('active',!reg);$('#registerTab').classList.toggle('active',reg);$('#authBtn').textContent=reg?'Create account':'Login';setAuthMsg('')}
$('#loginTab').onclick=()=>setAuthMode(false);$('#registerTab').onclick=()=>setAuthMode(true);
$('#authForm').onsubmit=async e=>{e.preventDefault();setAuthMsg('');try{const d=await api(registerMode?'/api/auth/register':'/api/auth/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});me=d.user;await showApp();await loadChats()}catch(err){setAuthMsg(err.message)}};
$('#logoutBtn').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});location.reload()};
async function loadChats(){const d=await api('/api/conversations');chats=d.conversations;renderChats();if(!active&&chats[0])selectChat(chats[0].id)}
function renderChats(){const q=$('#search').value.toLowerCase();$('#chatList').innerHTML=chats.filter(c=>c.name.toLowerCase().includes(q)).map(c=>`<button class="chat-item ${active===c.id?'active':''}" data-id="${c.id}"><div class="name">${esc(c.name)}</div><div class="id">${esc(c.id.slice(0,8))}</div></button>`).join('');document.querySelectorAll('.chat-item').forEach(x=>x.onclick=()=>selectChat(x.dataset.id))}
async function selectChat(id){active=id;const c=chats.find(x=>x.id===id);if(!c)return;$('#chatTitle').textContent=c.name;$('#chatSub').textContent='Private conversation';$('#deleteChat').classList.remove('hidden');loadOptions(c);renderChats();const d=await api(`/api/conversations/${id}/messages`);messages=d.messages;renderMessages();closeSidebarOnMobile()}
function renderMessages(){const el=$('#messages');if(!messages.length){el.innerHTML='<div class="empty">No messages yet. Add context, then generate a reply or message.</div>';return}el.innerHTML=messages.map(m=>{const att=m.attachment_id?`<a class="attachment" href="/api/files/${m.attachment_id}" target="_blank" rel="noopener">${m.attachment_mime?.startsWith('image/')?`<img src="/api/files/${m.attachment_id}" alt="${esc(m.attachment_name)}">`:''}<span>↘ ${esc(m.attachment_name||'Attachment')} <small>${formatBytes(m.attachment_size)}</small> <em>Download</em></span></a>`:'';return `<div class="message-block ${m.direction}"><div class="bubble ${m.direction}">${m.text?`<div>${esc(m.text)}</div>`:''}${att}</div><div class="meta">${m.direction==='outgoing'?'You':'Them'} • ${new Date(m.created_at).toLocaleString()}</div></div>`}).join('');el.scrollTop=el.scrollHeight}
async function uploadPending(){if(!pendingFile)return null;if(pendingFile.size>8*1024*1024)throw new Error('File too large. Maximum is 8 MB.');const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('Could not read file'));r.readAsDataURL(pendingFile)});const d=await api('/api/files/upload',{method:'POST',body:JSON.stringify({name:pendingFile.name,mime:pendingFile.type||'application/octet-stream',data})});return d.attachment}
async function addMessage(direction=messageDirection){if(!active)return alert('Create/select a chat first');const text=$('#messageInput').value.trim();if(!text&&!pendingFile)return;setComposerBusy(true);try{const attachment=await uploadPending();await api(`/api/conversations/${active}/messages`,{method:'POST',body:JSON.stringify({text,direction,attachmentId:attachment?.id||''})});const d=await api(`/api/conversations/${active}/messages`);messages=d.messages;renderMessages();clearComposer();await loadChats()}catch(e){alert(e.message)}finally{setComposerBusy(false)}}
function clearComposer(){$('#messageInput').value='';pendingFile=null;$('#fileInput').value='';$('#filePreview').classList.add('hidden');$('#filePreview').textContent=''}
function setComposerBusy(v){$('#sendBtn').disabled=v;$('#attachBtn').disabled=v;$('#sendBtn').textContent=v?'Sending…':(messageDirection==='outgoing'?'Send':'Add Incoming')}
function setDirection(dir){messageDirection=dir;$('#themBtn').classList.toggle('active',dir==='incoming');$('#meBtn').classList.toggle('active',dir==='outgoing');$('#messageInput').placeholder=dir==='incoming'?'Paste their message here…':'Your message…';$('#directionHint').textContent=dir==='incoming'?"THEM selected — paste the other person's message here, then tap Add Them Message.":"ME selected — type your own message here, then tap Send.";setComposerBusy(false)}
$('#themBtn').onclick=()=>setDirection('incoming');$('#meBtn').onclick=()=>setDirection('outgoing');setDirection('outgoing');
$('#sendBtn').onclick=()=>addMessage();$('#messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addMessage()}});
$('#attachBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=()=>{pendingFile=$('#fileInput').files?.[0]||null;const p=$('#filePreview');if(!pendingFile){p.classList.add('hidden');return}p.classList.remove('hidden');p.textContent=`${pendingFile.name} • ${formatBytes(pendingFile.size)}`};
async function generate(mode='reply',prompt=''){
  if(!active)return alert('Create/select a chat first');
  $('#generate').disabled=true;$('#generateMessage').disabled=true;$('#regenerate').disabled=true;$('#source').textContent='Generating…';
  try{const d=await api('/api/ai/reply',{method:'POST',body:JSON.stringify({conversationId:active,mode,prompt})});$('#suggestion').value=d.text||'';lastGeneration={mode,prompt};$('#source').textContent=`Source: ${d.source||'unknown'}`}catch(e){$('#source').textContent=e.message}finally{$('#generate').disabled=false;$('#generateMessage').disabled=false;$('#regenerate').disabled=false}}
$('#sendIntent').onclick=async()=>{
  if(!active)return alert('Create/select a chat first');
  const text=$('#intentInput').value.trim();
  if(!text)return alert('Type your message first.');
  $('#sendIntent').disabled=true;
  try{
    await api(`/api/conversations/${active}/messages`,{method:'POST',body:JSON.stringify({text,direction:'outgoing',attachmentId:''})});
    const d=await api(`/api/conversations/${active}/messages`);
    messages=d.messages;renderMessages();
    $('#intentInput').value='';
    await loadChats();
  }catch(e){alert(e.message)}
  finally{$('#sendIntent').disabled=false}
};
$('#generateIntent').onclick=()=>{const p=$('#intentInput').value.trim();if(!p)return alert('Type what you want to say in the prompt box first.');generate('message',p)};
$('#generate').onclick=()=>generate('reply',$('#intentInput').value.trim());
$('#generateMessage').onclick=()=>{const p=$('#intentInput').value.trim();if(!p)return alert('Type what you want to say in the prompt box first.');generate('message',p)};
$('#regenerate').onclick=()=>generate(lastGeneration.mode,lastGeneration.prompt||$('#intentInput').value.trim());
$('#copy').onclick=async()=>{const t=$('#suggestion').value.trim();if(!t)return;await navigator.clipboard.writeText(t);$('#source').textContent='Copied'};
$('#sendSuggestion').onclick=async()=>{const t=$('#suggestion').value.trim();if(!active||!t)return;if(!confirm('Send this generated message as your message?'))return;try{await api(`/api/conversations/${active}/messages`,{method:'POST',body:JSON.stringify({text:t,direction:'outgoing',attachmentId:''})});const d=await api(`/api/conversations/${active}/messages`);messages=d.messages;renderMessages();await loadChats();$('#source').textContent='Suggestion sent';}catch(e){$('#source').textContent=e.message}};
$('#clear').onclick=()=>{$('#suggestion').value='';$('#source').textContent=''};$('#clearPrompt').onclick=()=>$('#intentInput').value='';
$('#newChat').onclick=createChat;
async function createChat(){const name=prompt('Chat name');if(!name)return;const d=await api('/api/conversations',{method:'POST',body:JSON.stringify({name})});chats.unshift(d.conversation);renderChats();selectChat(d.conversation.id)}
$('#deleteChat').onclick=async()=>{if(!active||!confirm('Delete this chat and its messages?'))return;await api(`/api/conversations/${active}/delete`,{method:'DELETE'});active=null;$('#deleteChat').classList.add('hidden');$('#chatTitle').textContent='Select a chat';$('#messages').innerHTML='<div class="empty">Chat deleted.</div>';await loadChats()};$('#search').oninput=renderChats;
function loadOptions(c){const s=c.settings||{};$('#optName').value=c.name||'';$('#optMyMode').value=s.myMode||'Neutral';$('#optTalkingTo').value=s.talkingTo||'Neutral';$('#optTone').value=s.tone||'Casual';$('#optEmoji').value=s.emojiLevel||'Low';$('#optResponseStyle').value=s.responseStyle||'Ongoing conversation';$('#optFlirt').checked=Boolean(s.flirting);$('#optRomantic').checked=Boolean(s.romantic);$('#optMature').checked=Boolean(s.mature);$('#optInstructions').value=s.instructions||''}
async function renameActiveChat(){
  if(!active)return;
  const c=chats.find(x=>x.id===active);
  if(!c)return;
  const next=prompt('New chat name',c.name);
  if(next===null)return;
  const name=next.trim();
  if(!name)return alert('Chat name cannot be empty.');
  try{
    const d=await api(`/api/conversations/${active}/settings`,{method:'PATCH',body:JSON.stringify({name})});
    const i=chats.findIndex(x=>x.id===active);
    if(i>=0)chats[i]=d.conversation;
    $('#chatTitle').textContent=d.conversation.name;
    $('#optName').value=d.conversation.name;
    renderChats();
  }catch(e){alert(e.message)}
}
$('#renameChat').onclick=renameActiveChat;
$('#renameChatMobile').onclick=()=>renameActiveChat();
$('#settingsBtn').onclick=()=>openSettings();$('#closeSettings').onclick=()=>closeSettings();$('#mobileOptions').onclick=()=>openSettings();
$('#saveOptions').onclick=async()=>{if(!active)return;const settings={myMode:$('#optMyMode').value,talkingTo:$('#optTalkingTo').value,tone:$('#optTone').value,emojiLevel:$('#optEmoji').value,responseStyle:$('#optResponseStyle').value,flirting:$('#optFlirt').checked,romantic:$('#optRomantic').checked,mature:$('#optMature').checked,instructions:$('#optInstructions').value};const d=await api(`/api/conversations/${active}/settings`,{method:'PATCH',body:JSON.stringify({name:$('#optName').value,settings})});const i=chats.findIndex(c=>c.id===active);if(i>=0)chats[i]=d.conversation;renderChats();$('#chatTitle').textContent=d.conversation.name;closeSettings()};
function openSettings(){if(!active)return;$('#settingsPanel').classList.add('open')}
function closeSettings(){$('#settingsPanel').classList.remove('open')}
function closeSidebarOnMobile(){if(window.innerWidth<=760)document.body.classList.remove('show-sidebar')}
$('#mobileBack').onclick=()=>{document.body.classList.toggle('show-sidebar')};
for(const b of document.querySelectorAll('#mobileNav button'))b.onclick=()=>{const tab=b.dataset.tab;if(tab==='new')createChat();if(tab==='generate'){openSettings();setTimeout(()=>$('#intentInput').scrollIntoView({behavior:'smooth',block:'center'}),80)}if(tab==='options')openSettings();if(tab==='search')$('#mobileSearchSheet').classList.remove('hidden');if(tab==='chats')document.body.classList.add('show-sidebar')};
$('#mobileSearch').oninput=()=>{$('#search').value=$('#mobileSearch').value;renderChats()};document.querySelector('.close-sheet').onclick=()=>$('#mobileSearchSheet').classList.add('hidden');$('#mobileSearchSheet').onclick=e=>{if(e.target.id==='mobileSearchSheet')$('#mobileSearchSheet').classList.add('hidden')};
async function loadAISettings(){try{const d=await api('/api/settings/ai');$('#aiProvider').value=d.provider||'gemini';$('#aiModel').value=d.model||(d.provider==='gemini'?'gemini-3.5-flash':'');$('#aiBaseUrl').value=d.baseUrl||'';$('#aiKey').value='';$('#apiStatus').textContent=d.configured?`Saved: ${d.provider} • ${d.model}`:'No user API saved. Add your API key to start.';toggleBaseUrl();updateApiHelp();}catch(e){$('#apiStatus').textContent=e.message}}
function updateApiHelp(){const p=$('#aiProvider').value;if(p==='gemini'){$('#apiHelpText').textContent='Google Gemini API key:';$('#apiHelpLink').href='https://aistudio.google.com/apikey';$('#apiHelpLink').textContent='Get your API key';$('#aiModel').placeholder='Example: gemini-3.5-flash';}else if(p==='openai'){$('#apiHelpText').textContent='OpenAI API key:';$('#apiHelpLink').href='https://platform.openai.com/api-keys';$('#apiHelpLink').textContent='Get your API key';$('#aiModel').placeholder='Example: gpt-5';}else{$('#apiHelpText').textContent='Use an OpenAI-compatible API:';$('#apiHelpLink').href='https://platform.openai.com/docs/guides/text';$('#apiHelpLink').textContent='API docs';$('#aiModel').placeholder='Example: your-model-name';}}
function toggleBaseUrl(){ $('#baseUrlWrap').classList.toggle('hidden',$('#aiProvider').value!=='openai-compatible'); }
$('#aiProvider').onchange=()=>{toggleBaseUrl();updateApiHelp()};
$('#apiSettingsBtn').onclick=()=>{loadAISettings();$('#apiPanel').classList.add('open');$('#apiPanel').setAttribute('aria-hidden','false')};
$('#closeApi').onclick=()=>{$('#apiPanel').classList.remove('open');$('#apiPanel').setAttribute('aria-hidden','true')};
$('#apiPanel').onclick=e=>{if(e.target.id==='apiPanel')$('#closeApi').click()};
$('#saveApi').onclick=async()=>{const key=$('#aiKey').value.trim();if(!key)return alert('Enter your API key.');const body={provider:$('#aiProvider').value,apiKey:key,model:$('#aiModel').value.trim(),baseUrl:$('#aiBaseUrl').value.trim()};try{const d=await api('/api/settings/ai',{method:'PUT',body:JSON.stringify(body)});$('#aiKey').value='';$('#apiStatus').textContent=`Saved: ${d.provider} • ${d.model}`;alert('AI API saved for this account.')}catch(e){$('#apiStatus').textContent=e.message}};
$('#removeApi').onclick=async()=>{if(!confirm('Remove your saved AI API from this account?'))return;try{await api('/api/settings/ai',{method:'DELETE'});$('#aiKey').value='';$('#apiStatus').textContent='No user API saved.'}catch(e){$('#apiStatus').textContent=e.message}};
async function showApp(){$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#mobileNav').classList.remove('hidden');$('#userEmail').textContent=me.email;$('#avatar').textContent=me.email[0].toUpperCase();try{const d=await api('/api/settings/ai');if(!d.configured){$('#apiPanel').classList.add('open');$('#apiPanel').setAttribute('aria-hidden','false');}loadAISettings();}catch{}}
(async()=>{try{const d=await api('/api/auth/me');if(d.authenticated){me=d.user;await showApp();await loadChats()}}catch{}})();
