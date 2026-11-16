'use strict';
/* =====================================================================
   Nexo - cliente
   Chat em grupo + salas de voz/video + transmissao de tela (WebRTC mesh)
   ===================================================================== */

const $ = (s, el = document) => el.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------------------------------------------------------------------
// Icones (SVG inline)
// ---------------------------------------------------------------------
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  hash: P('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  speaker: P('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  menu: P('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  send: P('<path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>'),
  mic: P('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>'),
  micOff: P('<path d="m2 2 20 20"/><path d="M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M17 16.9A7 7 0 0 1 5 10M19 10a7 7 0 0 1-.1 1.3M12 19v3"/>'),
  cam: P('<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  camOff: P('<path d="m2 2 20 20"/><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v3.3l1 1L23 7v10"/>'),
  screen: P('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  screenOff: P('<path d="m2 2 20 20"/><path d="M20 17H4a2 2 0 0 1-2-2V5c0-.7.4-1.4 1-1.7M8 3h12a2 2 0 0 1 2 2v10M8 21h8M12 17v4"/>'),
  phoneOff: P('<path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.4 2.1L8.9 9.9"/><path d="m22 2-20 20"/>'),
  logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  invite: P('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  leave: P('<path d="M16 17l5-5-5-5M21 12H9M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"/>'),
  trash: P('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  expand: P('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  flip: P('<path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M9 13a3 3 0 0 1 5.2-2M15 14a3 3 0 0 1-5.2 1.9"/><path d="M14 9v2h2M10 17v-2H8"/>'),
  grid: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
  back: P('<path d="m15 18-6-6 6-6"/>'),
};

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------
const S = {
  token: store.get('nexo_token'),
  user: null,
  groups: [],
  gid: store.get('nexo_gid'),
  cid: null,              // canal de texto aberto
  view: 'chat',           // chat | voice | empty
  msgs: {},               // channelId -> [msg]
  unread: new Set(),      // channelIds com mensagens novas
  ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  socket: null,
  pendingInvite: null,
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const initial = n => esc((n || '?').trim().charAt(0) || '?');
const avatar = (u, cls = '') => `<div class="av ${cls}" style="background:${esc(u.color || '#555')}">${initial(u.username)}</div>`;
const isMobile = () => matchMedia('(max-width: 820px)').matches;
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoje às ' + fmtTime(ts);
  if (d.toDateString() === y.toDateString()) return 'Ontem às ' + fmtTime(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + fmtTime(ts);
}

function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const emit = (ev, data) => new Promise(res => {
  if (!S.socket?.connected) { res({ error: 'Sem conexão com o servidor.' }); return; }
  S.socket.timeout(10000).emit(ev, data, (err, r) => res(err ? { error: 'O servidor não respondeu.' } : (r || {})));
});

const group = id => S.groups.find(g => g.id === id);
const curGroup = () => group(S.gid);
function findChannel(cid) {
  for (const g of S.groups) { const c = g.channels.find(x => x.id === cid); if (c) return { g, c }; }
  return null;
}

// ---------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------
let authMode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  if (S.pendingInvite) $('#auth-sub').textContent = 'Entre ou crie uma conta para aceitar o convite';
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  authMode = t.dataset.mode;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
  $('#auth-pass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}));
$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').textContent = '';
  try {
    const r = await fetch('/api/' + authMode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#auth-user').value, password: $('#auth-pass').value }),
    });
    const j = await r.json().catch(() => ({ error: 'Erro no servidor.' }));
    if (!r.ok) { $('#auth-error').textContent = j.error || 'Erro.'; return; }
    S.token = j.token;
    store.set('nexo_token', j.token);
    $('#auth-pass').value = '';
    start();
  } catch {
    $('#auth-error').textContent = 'Não foi possível conectar ao servidor.';
  } finally { btn.disabled = false; }
});

function logout() {
  if (call.channelId) leaveCall();
  if (S.token) fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.token }) }).catch(() => {});
  S.socket?.disconnect();
  S.socket = null;
  S.token = null; S.user = null; S.groups = []; S.msgs = {}; S.cid = null;
  store.del('nexo_token');
  showAuth();
}

// ---------------------------------------------------------------------
// Inicio / conexao
// ---------------------------------------------------------------------
async function start() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  try { const r = await fetch('/api/config'); S.ice = (await r.json()).iceServers; } catch {}
  connect();
}

function connect() {
  S.socket?.disconnect();
  const sock = io({ auth: { token: S.token }, transports: ['websocket', 'polling'] });
  S.socket = sock;

  sock.on('connect_error', e => { if (e.message === 'auth') logout(); });

  sock.on('init', d => {
    S.user = d.user;
    S.groups = d.groups;
    if (!group(S.gid)) S.gid = S.groups[0]?.id || null;
    // recarrega historico apos reconectar
    S.msgs = {};
    renderAll();
    if (S.view !== 'voice' || !call.channelId) openDefaultChannel();
    else if (S.cid) loadHistory(S.cid);
    if (S.pendingInvite) { const inv = S.pendingInvite; S.pendingInvite = null; joinGroup(inv); }
  });

  sock.on('group:update', g => {
    const i = S.groups.findIndex(x => x.id === g.id);
    if (i >= 0) S.groups[i] = g; else S.groups.push(g);
    if (S.cid && !findChannel(S.cid)) { S.cid = null; if (S.gid === g.id) openDefaultChannel(); }
    renderAll();
  });

  sock.on('group:removed', ({ groupId }) => {
    const g = group(groupId);
    S.groups = S.groups.filter(x => x.id !== groupId);
    if (call.groupId === groupId) leaveCall();
    if (S.gid === groupId) { S.gid = S.groups[0]?.id || null; S.cid = null; openDefaultChannel(); }
    renderAll();
    if (g) toast(`Você saiu de "${g.name}"`);
  });

  sock.on('voice:presence', ({ groupId, voice }) => {
    const g = group(groupId);
    if (!g) return;
    g.voice = voice;
    renderChannels();
  });

  sock.on('message', ({ groupId, channelId, msg }) => {
    if (S.msgs[channelId]) S.msgs[channelId].push(msg);
    const visible = channelId === S.cid && S.view === 'chat' && document.visibilityState === 'visible';
    if (channelId === S.cid) renderMessages(true);
    if (!visible && msg.userId !== S.user?.id) {
      S.unread.add(channelId);
      renderRail(); renderChannels();
      notify(msg, groupId, channelId);
    }
  });

  sock.on('disconnect', reason => {
    if (call.channelId) { leaveCall(); toast('Conexão perdida — você saiu da chamada.'); }
    if (reason !== 'io client disconnect') toast('Reconectando…');
  });

  sock.on('voice:peer-joined', p => { if (call.channelId) { addPeer(p); playJoinSound(true); } });
  sock.on('voice:peer-left', ({ sid }) => { if (call.peers.has(sid)) { removePeer(sid); playJoinSound(false); } });
  sock.on('voice:state', p => onPeerState(p));
  sock.on('signal', ({ from, data }) => onSignal(from, data));
}

function notify(msg, groupId, channelId) {
  try {
    if (document.visibilityState === 'visible') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const f = findChannel(channelId);
    const n = new Notification(`${msg.username} em #${f?.c.name || ''}`, { body: msg.text.slice(0, 140), icon: '/icons/icon-192.png', tag: channelId });
    n.onclick = () => { window.focus(); S.gid = groupId; openTextChannel(channelId); n.close(); };
  } catch {}
}
function askNotifyPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}

// ---------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------
function openDefaultChannel() {
  const g = curGroup();
  if (!g) { S.cid = null; setView('empty'); return; }
  const last = store.get('nexo_cid_' + g.id);
  const c = g.channels.find(x => x.id === last && x.type === 'text') || g.channels.find(x => x.type === 'text');
  if (c) openTextChannel(c.id);
  else { S.cid = null; setView(call.channelId ? 'voice' : 'empty'); }
}

function selectGroup(gid) {
  S.gid = gid;
  store.set('nexo_gid', gid);
  S.cid = null;
  openDefaultChannel();
  renderAll();
}

function openTextChannel(cid) {
  const f = findChannel(cid);
  if (!f) return;
  S.gid = f.g.id;
  S.cid = cid;
  store.set('nexo_gid', f.g.id);
  store.set('nexo_cid_' + f.g.id, cid);
  S.unread.delete(cid);
  setView('chat');
  loadHistory(cid);
  closeDrawer();
  renderAll();
  if (!isMobile()) $('#msg-input').focus();
}

async function loadHistory(cid) {
  if (S.msgs[cid]) { renderMessages(); return; }
  renderMessages();
  const r = await emit('channel:history', { channelId: cid });
  if (r.messages) { S.msgs[cid] = r.messages; if (S.cid === cid) renderMessages(); }
}

function setView(v) {
  S.view = v;
  $('#empty-view').classList.toggle('hidden', v !== 'empty');
  $('#chat-view').classList.toggle('hidden', v !== 'chat');
  $('#voice-view').classList.toggle('hidden', v !== 'voice');
  renderHeader();
  renderChannels();
}

function openDrawer() { $('#app').classList.add('drawer'); }
function closeDrawer() { $('#app').classList.remove('drawer'); }
$('#menu-btn').innerHTML = I.menu;
$('#menu-btn').onclick = openDrawer;
$('#backdrop').onclick = closeDrawer;

// ---------------------------------------------------------------------
// Renderizacao
// ---------------------------------------------------------------------
function renderAll() { renderRail(); renderChannels(); renderHeader(); renderUserbar(); renderCallbar(); }

function renderRail() {
  const rail = $('#rail');
  rail.innerHTML = '';
  for (const g of S.groups) {
    const b = document.createElement('button');
    const unread = g.channels.some(c => S.unread.has(c.id));
    b.className = 'g-btn' + (g.id === S.gid ? ' active' : '') + (unread ? ' unread' : '');
    b.title = g.name;
    b.textContent = g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
    b.onclick = () => selectGroup(g.id);
    rail.appendChild(b);
  }
  if (S.groups.length) { const sep = document.createElement('div'); sep.className = 'rail-sep'; rail.appendChild(sep); }
  const add = document.createElement('button');
  add.className = 'g-btn add';
  add.title = 'Criar ou entrar em um grupo';
  add.innerHTML = I.plus;
  add.onclick = () => groupModal();
  rail.appendChild(add);
}

function renderChannels() {
  const g = curGroup();
  const head = $('#side-head'), list = $('#channels');
  if (!g) {
    head.innerHTML = `<span class="name">Nexo</span>`;
    list.innerHTML = `<p class="muted" style="padding:10px">Você ainda não está em nenhum grupo.</p>`;
    return;
  }
  const owner = g.ownerId === S.user?.id;
  head.innerHTML = `<span class="name" title="${esc(g.name)}">${esc(g.name)}</span>
    <span><button class="icon-btn" data-act="invite" title="Convidar pessoas">${I.invite}</button>
    <button class="icon-btn" data-act="leave" title="${owner ? 'Apagar grupo' : 'Sair do grupo'}">${owner ? I.trash : I.leave}</button></span>`;
  head.querySelector('[data-act=invite]').onclick = () => inviteModal(g);
  head.querySelector('[data-act=leave]').onclick = () => leaveGroupModal(g);

  const text = g.channels.filter(c => c.type === 'text');
  const voiceCh = g.channels.filter(c => c.type === 'voice');
  let html = `<div class="sec">Canais de texto ${owner ? `<button class="icon-btn" data-add="text" title="Criar canal">${I.plus}</button>` : ''}</div>`;
  for (const c of text) {
    const active = c.id === S.cid && S.view === 'chat';
    html += `<button class="ch ${active ? 'active' : ''} ${S.unread.has(c.id) ? 'unread' : ''}" data-cid="${c.id}">${I.hash}<span class="label">${esc(c.name)}</span>
      ${owner ? `<span class="icon-btn del" data-del="${c.id}" title="Apagar canal">${I.trash}</span>` : ''}</button>`;
  }
  html += `<div class="sec">Salas de voz ${owner ? `<button class="icon-btn" data-add="voice" title="Criar sala">${I.plus}</button>` : ''}</div>`;
  for (const c of voiceCh) {
    const people = g.voice?.[c.id] || [];
    const active = call.channelId === c.id && S.view === 'voice';
    html += `<button class="ch ${active ? 'active' : ''}" data-vid="${c.id}">${I.speaker}<span class="label">${esc(c.name)}</span>
      ${owner ? `<span class="icon-btn del" data-del="${c.id}" title="Apagar sala">${I.trash}</span>` : ''}</button>`;
    if (people.length) {
      html += `<div class="vusers">` + people.map(p => `<div class="vuser">${avatar(p, 'sm')}<span class="nm">${esc(p.username)}</span>
        ${p.screen ? '<span class="live">AO VIVO</span>' : ''}${p.cam ? I.cam : ''}${p.mic ? '' : I.micOff}</div>`).join('') + `</div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => openTextChannel(b.dataset.cid));
  list.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => joinCall(b.dataset.vid));
  list.querySelectorAll('[data-add]').forEach(b => b.onclick = e => { e.stopPropagation(); channelModal(g, b.dataset.add); });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteChannelModal(b.dataset.del); });
}

function renderHeader() {
  const t = $('#main-title'), a = $('#head-actions');
  a.innerHTML = '';
  if (S.view === 'chat' && S.cid) {
    const f = findChannel(S.cid);
    t.innerHTML = `${I.hash}<span>${esc(f?.c.name || '')}</span>`;
    $('#msg-input').placeholder = `Conversar em #${f?.c.name || ''}`;
    if (call.channelId) {
      const b = document.createElement('button');
      b.className = 'btn primary'; b.style.padding = '6px 12px';
      b.textContent = 'Voltar à chamada';
      b.onclick = () => setView('voice');
      a.appendChild(b);
    }
  } else if (S.view === 'voice' && call.channelId) {
    const f = findChannel(call.channelId);
    t.innerHTML = `${I.speaker}<span>${esc(f?.c.name || 'Chamada')}</span>`;
    if (S.cid) {
      const b = document.createElement('button');
      b.className = 'icon-btn'; b.title = 'Ir para o chat'; b.innerHTML = I.hash;
      b.onclick = () => openTextChannel(S.cid);
      a.appendChild(b);
    }
  } else {
    t.innerHTML = `<span>${esc(curGroup()?.name || 'Nexo')}</span>`;
  }
}

function renderUserbar() {
  if (!S.user) return;
  $('#userbar').innerHTML = `${avatar(S.user, 'sm')}<span class="nm">${esc(S.user.username)}</span>
    <button class="icon-btn" id="ub-logout" title="Sair da conta">${I.logout}</button>`;
  $('#ub-logout').onclick = () => confirmModal('Sair da conta?', 'Você poderá entrar de novo quando quiser.', 'Sair', logout);
}

function renderCallbar() {
  const bar = $('#callbar');
  if (!call.channelId) { bar.classList.add('hidden'); return; }
  const f = findChannel(call.channelId);
  bar.classList.remove('hidden');
  bar.innerHTML = `<div class="st"><span class="dot"></span>Conectado na voz</div>
    <div class="where">${esc(f?.c.name || '')} / ${esc(f?.g.name || '')}</div>
    <div class="acts">
      <button class="icon-btn ${call.micOn && call.micTrack ? '' : 'off'}" data-c="mic" title="Microfone">${call.micOn && call.micTrack ? I.mic : I.micOff}</button>
      <button class="icon-btn" data-c="view" title="Abrir chamada">${I.grid}</button>
      <button class="icon-btn off" data-c="leave" title="Sair da chamada">${I.phoneOff}</button>
    </div>`;
  bar.querySelector('[data-c=mic]').onclick = toggleMic;
  bar.querySelector('[data-c=view]').onclick = () => { setView('voice'); closeDrawer(); };
  bar.querySelector('[data-c=leave]').onclick = () => leaveCall();
}

function renderMessages(appended = false) {
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const f = findChannel(S.cid);
  const msgs = S.msgs[S.cid];
  let html = `<div class="welcome"><div class="big-ic">${I.hash}</div><h2>Bem-vindo a #${esc(f?.c.name || '')}!</h2>
    <p class="muted">Este é o começo do canal #${esc(f?.c.name || '')}.</p></div>`;
  if (!msgs) html += `<p class="muted" style="padding:0 16px">Carregando…</p>`;
  else {
    let prev = null;
    for (const m of msgs) {
      const grouped = prev && prev.userId === m.userId && m.ts - prev.ts < 5 * 60e3;
      if (!grouped) {
        html += `<div class="msg first">${avatar(m)}<div class="msg-body"><div class="msg-head">
          <span class="msg-author" style="color:${esc(m.color)}">${esc(m.username)}</span><span class="msg-time">${fmtDate(m.ts)}</span></div>
          <div class="msg-text">${linkify(m.text)}</div></div></div>`;
      } else {
        html += `<div class="msg"><div class="gutter">${fmtTime(m.ts)}</div><div class="msg-body"><div class="msg-text">${linkify(m.text)}</div></div></div>`;
      }
      prev = m;
    }
  }
  box.innerHTML = html;
  if (!appended || nearBottom || msgs?.at(-1)?.userId === S.user?.id) box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------
// Envio de mensagens
// ---------------------------------------------------------------------
$('#send-btn').innerHTML = I.send;
const input = $('#msg-input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); sendMessage(); }
});
$('#composer').addEventListener('submit', e => { e.preventDefault(); sendMessage(); });
async function sendMessage() {
  const text = input.value.trim();
  if (!text || !S.cid) return;
  input.value = ''; autosize();
  const r = await emit('message:send', { channelId: S.cid, text });
  if (r.error) { toast(r.error); if (!input.value) { input.value = text; autosize(); } }
  askNotifyPermission();
}

// ---------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------
function modal(html, onReady) {
  const m = $('#modal'), card = $('#modal-card');
  card.innerHTML = html;
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
  card.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  onReady?.(card);
  const first = card.querySelector('input:not([type=radio]):not([readonly])');
  if (first && !isMobile()) first.focus();
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-card').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function confirmModal(title, text, okLabel, onOk) {
  modal(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${esc(text)}</p>
    <div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn danger" id="m-ok">${esc(okLabel)}</button></div>`,
    card => card.querySelector('#m-ok').onclick = () => { closeModal(); onOk(); });
}

function groupModal() {
  closeDrawer();
  modal(`<h3>Criar um grupo</h3>
    <form id="m-create" style="display:flex;flex-direction:column;gap:12px">
      <label>Nome do grupo<input id="m-gname" maxlength="40" placeholder="Ex.: Amigos do jogo" required></label>
      <button class="btn primary">Criar grupo</button>
    </form>
    <div style="border-top:1px solid var(--line);margin:4px 0"></div>
    <h3>Tem um convite?</h3>
    <form id="m-join" style="display:flex;flex-direction:column;gap:12px">
      <label>Código ou link de convite<input id="m-inv" placeholder="Ex.: a1b2c3d4" required></label>
      <button class="btn">Entrar no grupo</button>
    </form>`, card => {
    card.querySelector('#m-create').onsubmit = async e => {
      e.preventDefault();
      const r = await emit('group:create', { name: card.querySelector('#m-gname').value });
      if (r.error) return toast(r.error);
      closeModal();
      addOrUpdateGroup(r.group);
      selectGroup(r.group.id);
      toast('Grupo criado! Use o botão de convite para chamar seus amigos.');
    };
    card.querySelector('#m-join').onsubmit = async e => {
      e.preventDefault();
      if (await joinGroup(card.querySelector('#m-inv').value)) closeModal();
    };
  });
}
document.querySelectorAll('[data-action=create-group],[data-action=join-group]').forEach(b => b.onclick = groupModal);

function addOrUpdateGroup(g) {
  const i = S.groups.findIndex(x => x.id === g.id);
  if (i >= 0) S.groups[i] = g; else S.groups.push(g);
}

async function joinGroup(invite) {
  const r = await emit('group:join', { invite });
  if (r.error) { toast(r.error); return false; }
  addOrUpdateGroup(r.group);
  selectGroup(r.group.id);
  toast(`Você entrou em "${r.group.name}"!`);
  return true;
}

function inviteModal(g) {
  const link = `${location.origin}/?convite=${g.invite}`;
  modal(`<h3>Convidar para ${esc(g.name)}</h3>
    <p class="muted" style="margin:0">Envie este link para seus amigos. Eles criam uma conta e já entram no grupo.</p>
    <div class="copybox"><input id="m-link" readonly value="${esc(link)}"><button class="btn primary" id="m-copy">Copiar</button></div>
    <p class="muted" style="margin:0">Código: <b style="color:var(--txt)">${esc(g.invite)}</b></p>
    <div class="acts">${navigator.share ? '<button class="btn" id="m-share">Compartilhar</button>' : ''}<button class="btn" data-close>Fechar</button></div>`, card => {
    card.querySelector('#m-copy').onclick = async () => {
      const inp = card.querySelector('#m-link');
      try { await navigator.clipboard.writeText(link); } catch { inp.select(); document.execCommand?.('copy'); }
      toast('Link copiado!');
    };
    const sh = card.querySelector('#m-share');
    if (sh) sh.onclick = () => navigator.share({ title: 'Nexo', text: `Entre no grupo ${g.name} no Nexo`, url: link }).catch(() => {});
  });
}

function channelModal(g, type) {
  modal(`<h3>Criar ${type === 'voice' ? 'sala de voz' : 'canal de texto'}</h3>
    <form id="m-ch" style="display:flex;flex-direction:column;gap:12px">
      <div class="choice">
        <label><input type="radio" name="t" value="text" ${type === 'text' ? 'checked' : ''}> ${I.hash} Texto</label>
        <label><input type="radio" name="t" value="voice" ${type === 'voice' ? 'checked' : ''}> ${I.speaker} Voz/vídeo</label>
      </div>
      <label>Nome<input id="m-cname" maxlength="32" placeholder="${type === 'voice' ? 'Ex.: Jogando' : 'Ex.: memes'}" required></label>
      <div class="acts"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Criar</button></div>
    </form>`, card => {
    card.querySelector('#m-ch').onsubmit = async e => {
      e.preventDefault();
      const t = card.querySelector('input[name=t]:checked').value;
      const r = await emit('channel:create', { groupId: g.id, name: card.querySelector('#m-cname').value, type: t });
      if (r.error) return toast(r.error);
      closeModal();
      if (t === 'text') setTimeout(() => openTextChannel(r.channel.id), 50);
    };
  });
}

function deleteChannelModal(cid) {
  const f = findChannel(cid);
  if (!f) return;
  confirmModal(`Apagar "${f.c.name}"?`, 'Todas as mensagens deste canal serão apagadas. Isso não pode ser desfeito.', 'Apagar', async () => {
    if (call.channelId === cid) leaveCall();
    const r = await emit('channel:delete', { channelId: cid });
    if (r.error) toast(r.error);
  });
}

function leaveGroupModal(g) {
  const owner = g.ownerId === S.user?.id;
  confirmModal(owner ? `Apagar "${g.name}"?` : `Sair de "${g.name}"?`,
    owner ? 'Você é o dono. O grupo, os canais e as mensagens serão apagados para todos.' : 'Você poderá voltar com um novo convite.',
    owner ? 'Apagar grupo' : 'Sair', async () => {
      const r = await emit('group:leave', { groupId: g.id });
      if (r.error) toast(r.error);
    });
}

/* =====================================================================
   CHAMADAS (WebRTC)
   Cada pessoa conecta diretamente com cada outra (mesh).
   Cada conexao tem 4 "faixas" fixas, para nunca precisar renegociar:
     0 = microfone   1 = camera   2 = tela (video)   3 = audio da tela
   Ligar/desligar camera ou tela so troca a faixa (replaceTrack).
   ===================================================================== */
const QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, br: 2_500_000, label: '720p 30fps' },
  '1080p30': { w: 1920, h: 1080, fps: 30, br: 6_000_000, label: '1080p 30fps' },
  '1080p60': { w: 1920, h: 1080, fps: 60, br: 9_000_000, label: '1080p 60fps' },
};
const call = {
  channelId: null, groupId: null, mySid: null,
  peers: new Map(),
  micTrack: null, camTrack: null, screenTrack: null, screenAudioTrack: null,
  micOn: store.get('nexo_mic') !== '0',
  facing: 'user',
  quality: store.get('nexo_quality') || '1080p30',
  audioCtx: null, meters: new Map(), meterTimer: null,
  pinned: null, wakeLock: null, joining: false,
};
const hasMedia = () => !!navigator.mediaDevices?.getUserMedia;
const canShareScreen = () => !!navigator.mediaDevices?.getDisplayMedia;
const localTracks = () => [call.micTrack, call.camTrack, call.screenTrack, call.screenAudioTrack];

async function joinCall(cid) {
  closeDrawer();
  if (call.channelId === cid) { setView('voice'); return; }
  if (call.joining) return;
  if (!hasMedia() || !window.RTCPeerConnection) {
    toast(location.protocol !== 'https:' && location.hostname !== 'localhost'
      ? 'Chamadas precisam de HTTPS. Abra o site com https://'
      : 'Seu navegador não suporta chamadas.', 5000);
    return;
  }
  if (call.channelId) leaveCall();
  call.joining = true;
  ensureAudioCtx();
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    call.micTrack = s.getAudioTracks()[0];
    call.micTrack.enabled = call.micOn;
  } catch (e) {
    toast('Não consegui acessar o microfone. Você entrou sem áudio.', 4500);
  }
  const r = await emit('voice:join', { channelId: cid });
  call.joining = false;
  if (r.error) { toast(r.error); stopLocalTracks(); return; }
  call.channelId = cid;
  call.groupId = findChannel(cid)?.g.id;
  call.mySid = r.sid;
  call.pinned = null;
  $('#tiles').innerHTML = '';
  renderLocalTiles();
  sendState();
  if (call.micTrack) attachMeter('me', call.micTrack);
  startMeterLoop();
  requestWakeLock();
  setView('voice');
  renderControls();
  renderCallbar();
  playJoinSound(true);
  // Quem chega inicia a conexao com quem ja esta na sala
  for (const p of r.peers) startAsCaller(addPeer(p));
}

function leaveCall() {
  if (!call.channelId) return;
  S.socket?.emit('voice:leave');
  for (const sid of [...call.peers.keys()]) removePeer(sid);
  stopLocalTracks();
  call.meters.clear();
  clearInterval(call.meterTimer); call.meterTimer = null;
  call.channelId = null; call.groupId = null; call.pinned = null;
  $('#tiles').innerHTML = '';
  try { call.wakeLock?.release(); } catch {}
  call.wakeLock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderCallbar();
  if (S.view === 'voice') { if (S.cid) openTextChannel(S.cid); else openDefaultChannel(); }
  renderChannels();
  playJoinSound(false);
}

function stopLocalTracks() {
  for (const t of localTracks()) t?.stop();
  call.micTrack = call.camTrack = call.screenTrack = call.screenAudioTrack = null;
}

function sendState() {
  S.socket?.emit('voice:state', { mic: !!call.micTrack && call.micOn, cam: !!call.camTrack, screen: !!call.screenTrack });
}

// ---------- Peers ----------
function addPeer(p) {
  let peer = call.peers.get(p.sid);
  if (peer) return peer;
  peer = {
    sid: p.sid, username: p.username, color: p.color,
    state: { mic: !!p.mic, cam: !!p.cam, screen: !!p.screen },
    chain: Promise.resolve(), caller: false,
    camStream: new MediaStream(), screenStream: new MediaStream(),
    micAudio: makeAudioEl(), screenAudio: makeAudioEl(),
  };
  peer.pc = createPC(peer);
  call.peers.set(p.sid, peer);
  renderPeerTiles(peer);
  return peer;
}

function makeAudioEl() {
  const a = document.createElement('audio');
  a.autoplay = true;
  a.playsInline = true;
  $('#audio-sink').appendChild(a);
  return a;
}

function removePeer(sid) {
  const peer = call.peers.get(sid);
  if (!peer) return;
  try { peer.pc.close(); } catch {}
  peer.micAudio.srcObject = null; peer.micAudio.remove();
  peer.screenAudio.srcObject = null; peer.screenAudio.remove();
  call.peers.delete(sid);
  call.meters.delete(sid);
  document.getElementById('t-cam-' + sid)?.remove();
  document.getElementById('t-scr-' + sid)?.remove();
  if (call.pinned && call.pinned.endsWith(sid)) call.pinned = null;
  layoutTiles();
}

function createPC(peer) {
  const pc = new RTCPeerConnection({ iceServers: S.ice, bundlePolicy: 'max-bundle' });
  pc.onicecandidate = e => { if (e.candidate) S.socket.emit('signal', { to: peer.sid, data: { candidate: e.candidate.toJSON() } }); };
  pc.ontrack = e => {
    const idx = pc.getTransceivers().indexOf(e.transceiver);
    const t = e.track;
    if (idx === 0) {
      peer.micAudio.srcObject = new MediaStream([t]);
      playSafe(peer.micAudio);
      attachMeter(peer.sid, t);
    } else if (idx === 1) {
      swapTrack(peer.camStream, t);
    } else if (idx === 2) {
      swapTrack(peer.screenStream, t);
    } else if (idx === 3) {
      peer.screenAudio.srcObject = new MediaStream([t]);
      playSafe(peer.screenAudio);
    }
    renderPeerTiles(peer);
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') tunePeerSenders(peer);
    if (st === 'failed' && peer.caller) { try { pc.restartIce(); } catch {} }
    const tile = document.getElementById('t-cam-' + peer.sid);
    if (tile) {
      let c = tile.querySelector('.conn');
      const msg = st === 'connected' ? '' : st === 'failed' ? 'Falha na conexão' : st === 'disconnected' ? 'Reconectando…' : 'Conectando…';
      if (!msg) c?.remove();
      else { if (!c) { c = document.createElement('div'); c.className = 'conn'; tile.appendChild(c); } c.textContent = msg; }
    }
  };
  return pc;
}

function swapTrack(stream, track) {
  stream.getTracks().forEach(x => stream.removeTrack(x));
  stream.addTrack(track);
}

function startAsCaller(peer) {
  peer.caller = true;
  const pc = peer.pc;
  pc.onnegotiationneeded = () => {
    peer.chain = peer.chain.then(async () => {
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(await pc.createOffer());
      S.socket.emit('signal', { to: peer.sid, data: { sdp: pc.localDescription } });
    }).catch(e => console.error('offer', e));
  };
  const local = localTracks();
  ['audio', 'video', 'video', 'audio'].forEach((kind, i) => pc.addTransceiver(local[i] || kind, { direction: 'sendrecv' }));
}

function onSignal(from, data) {
  if (!call.channelId || !data) return;
  let peer = call.peers.get(from);
  if (!peer) {
    const p = (group(call.groupId)?.voice?.[call.channelId] || []).find(x => x.sid === from) || { sid: from, username: '…', color: '#555' };
    peer = addPeer(p);
  }
  const pc = peer.pc;
  peer.chain = peer.chain.then(async () => {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        await pc.setRemoteDescription(data.sdp);
        const local = localTracks();
        const txs = pc.getTransceivers();
        for (let i = 0; i < txs.length && i < 4; i++) {
          txs[i].direction = 'sendrecv';
          if (local[i] && txs[i].sender.track !== local[i]) await txs[i].sender.replaceTrack(local[i]);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        S.socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
      } else if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(data.sdp);
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { console.warn('ice', e); }
    }
  }).catch(e => console.error('signal', e));
}

function onPeerState(p) {
  const peer = call.peers.get(p.sid);
  if (!peer) return;
  const wasScreen = peer.state.screen;
  peer.state = { mic: !!p.mic, cam: !!p.cam, screen: !!p.screen };
  renderPeerTiles(peer);
  // Fixa automaticamente quem comecou a transmitir a tela
  if (!wasScreen && peer.state.screen && !call.pinned) { call.pinned = 't-scr-' + peer.sid; layoutTiles(); }
}

// Troca a faixa em todas as conexoes (sem renegociar)
function setTrackForAll(idx, track) {
  for (const peer of call.peers.values()) {
    const tx = peer.pc.getTransceivers()[idx];
    if (tx) tx.sender.replaceTrack(track).catch(e => console.warn('replaceTrack', e));
  }
}

// Ajusta bitrate/fps para a tela ficar nitida em Full HD
async function tuneSender(sender, maxBitrate, maxFramerate, pref) {
  if (!sender) return;
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = maxBitrate;
    if (maxFramerate) p.encodings[0].maxFramerate = maxFramerate;
    p.encodings[0].scaleResolutionDownBy = 1;
    await sender.setParameters(p);
  } catch (e) { console.warn('setParameters', e); }
  if (pref) {
    try { const p = sender.getParameters(); p.degradationPreference = pref; await sender.setParameters(p); } catch {}
  }
}
function tunePeerSenders(peer) {
  const txs = peer.pc.getTransceivers();
  const q = QUALITY[call.quality];
  tuneSender(txs[1]?.sender, 1_500_000, 30, 'balanced');
  tuneSender(txs[2]?.sender, q.br, q.fps, q.fps >= 60 ? 'maintain-framerate' : 'maintain-resolution');
}

// ---------- Controles ----------
async function toggleMic() {
  if (!call.channelId) return;
  if (!call.micTrack) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      call.micTrack = s.getAudioTracks()[0];
      call.micOn = true;
      setTrackForAll(0, call.micTrack);
      attachMeter('me', call.micTrack);
    } catch { toast('Permita o acesso ao microfone nas configurações do navegador.'); return; }
  } else {
    call.micOn = !call.micOn;
    call.micTrack.enabled = call.micOn;
  }
  store.set('nexo_mic', call.micOn ? '1' : '0');
  sendState(); renderControls(); renderCallbar(); renderLocalTiles();
}

async function getCamera() {
  const s = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: call.facing },
  });
  return s.getVideoTracks()[0];
}

async function toggleCam() {
  if (call.camTrack) {
    call.camTrack.stop();
    call.camTrack = null;
    setTrackForAll(1, null);
  } else {
    try {
      call.camTrack = await getCamera();
      setTrackForAll(1, call.camTrack);
      call.peers.forEach(tunePeerSenders);
    } catch { toast('Não consegui acessar a câmera.'); return; }
  }
  sendState(); renderControls(); renderLocalTiles();
}

async function flipCamera() {
  if (!call.camTrack) return;
  call.facing = call.facing === 'user' ? 'environment' : 'user';
  const old = call.camTrack;
  try {
    old.stop(); // alguns celulares nao abrem 2 cameras ao mesmo tempo
    call.camTrack = await getCamera();
    setTrackForAll(1, call.camTrack);
    renderLocalTiles();
  } catch {
    toast('Não foi possível trocar a câmera.');
    call.facing = call.facing === 'user' ? 'environment' : 'user';
    try { call.camTrack = await getCamera(); setTrackForAll(1, call.camTrack); } catch { call.camTrack = null; setTrackForAll(1, null); }
    sendState(); renderControls(); renderLocalTiles();
  }
}

async function toggleScreen() {
  if (call.screenTrack) return stopScreen();
  if (!canShareScreen()) {
    toast('Navegadores de celular não permitem transmitir a tela. Transmita pelo PC — no celular você assiste em Full HD normalmente.', 6000);
    return;
  }
  const q = QUALITY[call.quality];
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.w, max: q.w }, height: { ideal: q.h, max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include',
    });
  } catch (e) {
    if (e.name === 'NotAllowedError' && !/Android/i.test(navigator.userAgent)) return; // usuario cancelou
    toast(/Android|iPhone|iPad/i.test(navigator.userAgent)
      ? 'Este navegador de celular não permite transmitir a tela. Transmita pelo PC — no celular você assiste normalmente.'
      : 'Não foi possível transmitir a tela.', 6000);
    return;
  }
  const vt = s.getVideoTracks()[0];
  try { vt.contentHint = q.fps >= 60 ? 'motion' : 'detail'; } catch {}
  vt.onended = () => stopScreen();
  call.screenTrack = vt;
  call.screenAudioTrack = s.getAudioTracks()[0] || null;
  setTrackForAll(2, vt);
  setTrackForAll(3, call.screenAudioTrack);
  call.peers.forEach(tunePeerSenders);
  sendState(); renderControls(); renderLocalTiles();
  toast(`Transmitindo em ${q.label}${call.screenAudioTrack ? ' com áudio' : ''}`);
}

function stopScreen() {
  if (!call.screenTrack) return;
  call.screenTrack.onended = null;
  call.screenTrack.stop();
  call.screenAudioTrack?.stop();
  call.screenTrack = call.screenAudioTrack = null;
  setTrackForAll(2, null);
  setTrackForAll(3, null);
  if (call.pinned === 't-scr-me') call.pinned = null;
  sendState(); renderControls(); renderLocalTiles();
}

async function changeQuality(v) {
  call.quality = v;
  store.set('nexo_quality', v);
  const q = QUALITY[v];
  if (call.screenTrack) {
    try {
      await call.screenTrack.applyConstraints({ width: { ideal: q.w, max: q.w }, height: { ideal: q.h, max: q.h }, frameRate: { ideal: q.fps, max: q.fps } });
      call.screenTrack.contentHint = q.fps >= 60 ? 'motion' : 'detail';
    } catch (e) { console.warn(e); }
    call.peers.forEach(tunePeerSenders);
    toast('Qualidade: ' + q.label);
  }
}

function renderControls() {
  const c = $('#controls');
  const micOn = !!call.micTrack && call.micOn;
  const scrOk = canShareScreen();
  c.innerHTML = `
    <button class="cbtn ${micOn ? '' : 'off'}" data-k="mic" title="${micOn ? 'Silenciar' : 'Ativar microfone'}">${micOn ? I.mic : I.micOff}</button>
    <button class="cbtn ${call.camTrack ? 'on' : ''}" data-k="cam" title="${call.camTrack ? 'Desligar câmera' : 'Ligar câmera'}">${call.camTrack ? I.cam : I.camOff}</button>
    ${call.camTrack && isMobile() ? `<button class="cbtn" data-k="flip" title="Trocar câmera">${I.flip}</button>` : ''}
    <button class="cbtn ${call.screenTrack ? 'on' : ''}" data-k="screen" title="${scrOk ? (call.screenTrack ? 'Parar transmissão' : 'Transmitir tela') : 'Transmissão de tela disponível só no PC'}" ${scrOk ? '' : 'style="opacity:.45"'}>${call.screenTrack ? I.screenOff : I.screen}</button>
    ${scrOk ? `<select class="quality" title="Qualidade da transmissão">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}" ${k === call.quality ? 'selected' : ''}>${q.label}</option>`).join('')}</select>` : ''}
    <button class="cbtn leave" data-k="leave" title="Sair da chamada">${I.phoneOff}</button>`;
  c.querySelector('[data-k=mic]').onclick = toggleMic;
  c.querySelector('[data-k=cam]').onclick = toggleCam;
  c.querySelector('[data-k=screen]').onclick = toggleScreen;
  c.querySelector('[data-k=leave]').onclick = () => leaveCall();
  c.querySelector('[data-k=flip]')?.addEventListener('click', flipCamera);
  c.querySelector('.quality')?.addEventListener('change', e => changeQuality(e.target.value));
}

// ---------- Blocos de video ----------
function ensureTile(id, who, isScreen) {
  let t = document.getElementById(id);
  if (t) return t;
  t = document.createElement('div');
  t.id = id;
  t.className = 'tile' + (isScreen ? ' screen' : '');
  t.innerHTML = `<video autoplay playsinline muted></video><div class="ph">${avatar(who)}</div>
    <div class="tag"><span></span></div><button class="icon-btn fs" title="Tela cheia">${I.expand}</button>`;
  t.onclick = e => {
    if (e.target.closest('.fs')) return;
    call.pinned = call.pinned === id ? null : id;
    layoutTiles();
  };
  t.querySelector('.fs').onclick = e => { e.stopPropagation(); goFullscreen(t); };
  $('#tiles').appendChild(t);
  return t;
}

function setTile(t, { stream, showVideo, label, micOff, mirror }) {
  const v = t.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  v.style.visibility = showVideo ? 'visible' : 'hidden';
  v.classList.toggle('mirror', !!mirror);
  t.querySelector('.ph').style.display = showVideo ? 'none' : 'flex';
  t.querySelector('.tag').innerHTML = `${micOff ? I.micOff : ''}<span>${esc(label)}</span>`;
  if (showVideo) v.play().catch(() => {});
  // Mostra a resolucao real recebida (ex.: 1920x1080)
  if (t.classList.contains('screen')) {
    clearInterval(t._resTimer);
    t._resTimer = setInterval(() => {
      if (!document.body.contains(t)) return clearInterval(t._resTimer);
      let r = t.querySelector('.res');
      if (!v.videoWidth) { r?.remove(); return; }
      if (!r) { r = document.createElement('div'); r.className = 'res'; t.appendChild(r); }
      r.textContent = `${v.videoWidth}×${v.videoHeight}`;
    }, 1000);
  }
}

let _localCam = null;
function localCamStream() {
  if (!call.camTrack) { _localCam = null; return null; }
  if (!_localCam || _localCam.getVideoTracks()[0] !== call.camTrack) _localCam = new MediaStream([call.camTrack]);
  return _localCam;
}
function renderLocalTiles() {
  if (!call.channelId) return;
  const me = { username: S.user.username, color: S.user.color };
  const cam = ensureTile('t-cam-me', me, false);
  setTile(cam, {
    stream: localCamStream(),
    showVideo: !!call.camTrack, label: S.user.username + ' (você)',
    micOff: !(call.micTrack && call.micOn), mirror: call.facing === 'user',
  });
  if (call.screenTrack) {
    const scr = ensureTile('t-scr-me', me, true);
    if (scr.querySelector('video').srcObject?.getVideoTracks()[0] !== call.screenTrack)
      setTile(scr, { stream: new MediaStream([call.screenTrack]), showVideo: true, label: 'Sua tela (ao vivo)' });
  } else {
    document.getElementById('t-scr-me')?.remove();
  }
  layoutTiles();
}

function renderPeerTiles(peer) {
  if (!call.channelId) return;
  const cam = ensureTile('t-cam-' + peer.sid, peer, false);
  setTile(cam, { stream: peer.camStream, showVideo: peer.state.cam && peer.camStream.getVideoTracks().length > 0, label: peer.username, micOff: !peer.state.mic });
  if (peer.state.screen) {
    const scr = ensureTile('t-scr-' + peer.sid, peer, true);
    setTile(scr, { stream: peer.screenStream, showVideo: peer.screenStream.getVideoTracks().length > 0, label: `Tela de ${peer.username}` });
  } else {
    document.getElementById('t-scr-' + peer.sid)?.remove();
    if (call.pinned === 't-scr-' + peer.sid) call.pinned = null;
  }
  layoutTiles();
}

function layoutTiles() {
  const box = $('#tiles');
  if (call.pinned && !document.getElementById(call.pinned)) call.pinned = null;
  box.classList.toggle('has-pin', !!call.pinned);
  [...box.children].forEach(t => t.classList.toggle('pinned', t.id === call.pinned));
  if (call.pinned) { const p = document.getElementById(call.pinned); if (box.firstChild !== p) box.prepend(p); }
}

function goFullscreen(tile) {
  const v = tile.querySelector('video');
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  if (tile.requestFullscreen) tile.requestFullscreen().then(() => {
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch {}
  }).catch(() => v.webkitEnterFullscreen?.());
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iPhone
}

// ---------- Audio: indicador de fala, desbloqueio, sons ----------
function ensureAudioCtx() {
  try {
    if (!call.audioCtx) call.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (call.audioCtx.state === 'suspended') call.audioCtx.resume();
  } catch {}
}
function attachMeter(key, track) {
  if (!call.audioCtx) return;
  try {
    const src = call.audioCtx.createMediaStreamSource(new MediaStream([track]));
    const an = call.audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    call.meters.set(key, { an, buf: new Uint8Array(an.fftSize) });
  } catch (e) { console.warn('meter', e); }
}
function startMeterLoop() {
  clearInterval(call.meterTimer);
  call.meterTimer = setInterval(() => {
    for (const [key, m] of call.meters) {
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) { const x = (m.buf[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / m.buf.length);
      let speaking = rms > 0.03;
      if (key === 'me') speaking = speaking && call.micOn;
      else { const p = call.peers.get(key); speaking = speaking && p?.state.mic; }
      document.getElementById('t-cam-' + key)?.classList.toggle('speaking', !!speaking);
    }
  }, 120);
}
const blocked = new Set();
function playSafe(el) {
  el.play().catch(() => { blocked.add(el); $('#unlock-audio').classList.remove('hidden'); });
}
$('#unlock-audio').onclick = () => {
  ensureAudioCtx();
  blocked.forEach(el => el.play().catch(() => {}));
  blocked.clear();
  $('#unlock-audio').classList.add('hidden');
};
function playJoinSound(join) {
  try {
    ensureAudioCtx();
    const ctx = call.audioCtx; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    const t0 = ctx.currentTime;
    o.frequency.setValueAtTime(join ? 520 : 660, t0);
    o.frequency.linearRampToValueAtTime(join ? 780 : 440, t0 + 0.15);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + 0.3);
  } catch {}
}

// Mantem a tela do celular ligada durante a chamada
async function requestWakeLock() {
  try { call.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (call.channelId && !call.wakeLock) requestWakeLock();
    if (S.cid && S.view === 'chat' && S.unread.delete(S.cid)) { renderRail(); renderChannels(); }
  } else {
    call.wakeLock = null;
  }
});
window.addEventListener('beforeunload', () => { if (call.channelId) S.socket?.emit('voice:leave'); });

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
(function boot() {
  const params = new URLSearchParams(location.search);
  const inv = params.get('convite');
  if (inv) {
    S.pendingInvite = inv;
    history.replaceState(null, '', location.pathname);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (S.token) start(); else showAuth();
})();
