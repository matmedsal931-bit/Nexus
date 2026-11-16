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
  reply: P('<path d="m9 14-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>'),
  smile: P('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  edit: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  copy: P('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  users: P('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  download: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  chev: P('<path d="m6 9 6 6 6-6"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  vol: P('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
  volOff: P('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  userPlus: P('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  userCheck: P('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>'),
  move: P('<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'),
  home: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9 21v-6h6v6"/>'),
  file: P('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  paperclip: P('<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>'),
  head: P('<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="13" width="5" height="8" rx="2"/><rect x="17" y="13" width="5" height="8" rx="2"/>'),
  headOff: P('<path d="m2 2 20 20"/><path d="M3 14v-2a9 9 0 0 1 14.6-7"/><path d="M21 14v-2a8.9 8.9 0 0 0-.8-3.7"/><rect x="2" y="13" width="5" height="8" rx="2"/><path d="M17 13h3a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1"/>'),
  phone: P('<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.5 2.1L7.9 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  bell: P('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  bellOff: P('<path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17.9 17.9 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M2 2l20 20"/>'),
  crown: P('<path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 11H5z"/>'),
  eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  vol2: P('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
  volX: P('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  folder: P('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM12 11v6M9 14h6"/>'),
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
  users: {},              // cache de perfis (inclui quem não está nos seus grupos)
  dms: [],                // conversas privadas
  dmPeer: null,           // com quem estou conversando agora
  atts: [],               // arquivos escolhidos, esperando envio
  friends: { friends: [], in: [], out: [] },
  unread: new Set(),      // channelIds com mensagens novas
  ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  socket: null,
  pendingInvite: null,
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const initial = n => esc((n || '?').trim().charAt(0) || '?');
// ---- Cargos e permissoes (mesma regra do servidor, usada so para a interface) ----
const PERM_KEYS = ['admin', 'manageGroup', 'manageChannels', 'manageRoles', 'manageEmoji', 'kick', 'ban',
  'manageMessages', 'viewAudit', 'muteMembers', 'deafenMembers', 'moveMembers', 'disconnectMembers',
  'sendMessages', 'addReactions', 'connect', 'video'];
function permsOf(g, uid) {
  const out = {};
  if (!g) return out;
  if (g.ownerId === uid) { for (const k of PERM_KEYS) out[k] = true; return out; }
  Object.assign(out, g.everyone || {});
  const mine = g.memberRoles?.[uid] || [];
  for (const r of g.roles || []) if (mine.includes(r.id)) for (const k of PERM_KEYS) if (r.perms[k]) out[k] = true;
  if (out.admin) for (const k of PERM_KEYS) out[k] = true;
  return out;
}
const can = (g, p, uid = S.user?.id) => !!permsOf(g, uid)[p];
function rankOf(g, uid) {
  if (g.ownerId === uid) return -1;
  const mine = g.memberRoles?.[uid] || [];
  const i = (g.roles || []).findIndex(r => mine.includes(r.id));
  return i < 0 ? (g.roles || []).length : i;
}
const rolesOf = (g, uid) => (g.roles || []).filter(r => (g.memberRoles?.[uid] || []).includes(r.id));
// Cor do nome: a do cargo mais alto com cor; se nao tiver, a do perfil
function nameColor(uid, fallback, g = curGroup()) {
  const r = g && rolesOf(g, uid).find(x => x.color);
  return r ? r.color : (userById(uid)?.color || fallback || '#e8e9ee');
}
// Emojis personalizados do grupo: ":nome:" vira imagem
const cemojiImg = (g, e) => `<img class="cemoji" src="/api/emoji/${esc(g.id)}/${esc(e.id)}" alt=":${esc(e.name)}:" title=":${esc(e.name)}:" draggable="false">`;
function emojiHtml(e, g = curGroup()) {
  const m = /^:([a-z0-9_]{2,24}):$/.exec(e);
  const ce = m && g?.emojis?.find(x => x.name === m[1]);
  return ce ? cemojiImg(g, ce) : esc(e);
}
function richText(t) {
  const g = curGroup();
  const html = typeof mentionHtml === 'function' ? mentionHtml(linkify(t)) : linkify(t);
  if (!g?.emojis?.length) return html;
  return html.replace(/:([a-z0-9_]{2,24}):/g, (all, n) => { const ce = g.emojis.find(x => x.name === n); return ce ? cemojiImg(g, ce) : all; });
}

// Perfil atual de um usuario (cor e foto sempre atualizadas)
function userById(id) {
  if (!id) return null;
  if (S.user?.id === id) return S.user;
  if (S.users[id]) return S.users[id];
  for (const g of S.groups) { const m = g.members.find(x => x.id === id); if (m) return m; }
  return null;
}
// Nome que aparece: o nome exibido (editável), ou o de login
const nameOf = (uid, fb) => userById(uid)?.name || fb || '?';
function cacheUser(u) { if (u?.id && u.id !== S.user?.id) S.users[u.id] = { ...S.users[u.id], ...u }; }
const presOf = u => (u?.id === S.user?.id ? (S.user.presence === 'invisible' ? 'offline' : S.user.presence || 'online') : (u?.presence || (u?.online ? 'online' : 'offline')));
const presDot = u => `<i class="pres ${presOf(u)}"></i>`;
function avatar(u, cls = '') {
  const id = u.userId ?? u.id;
  const p = userById(id) || u;
  let inner = initial(p.name || p.username || u.username), data = '';
  if (p.av) {
    const base = `/api/avatar/${esc(id)}?v=${p.av}`;
    const anim = p.gif ? base + '&a=1' : '';
    // GIF só se mexe quando a pessoa está falando (ou no cartão de perfil)
    inner = `<img src="${cls.includes('anim') && anim ? anim : base}" alt="" draggable="false">`;
    if (anim) data = ` data-still="${base}" data-anim="${anim}"`;
  }
  return `<div class="av ${cls}"${data} style="background:${esc(p.color || u.color || '#555')}">${inner}${cls.includes('nodot') ? '' : presDot(p)}</div>`;
}
// Liga/desliga a animação das fotos dentro de um pedaço da tela
function animIn(root, on) {
  if (!root) return;
  root.querySelectorAll('.av[data-anim]').forEach(el => {
    const img = el.querySelector('img');
    if (!img) return;
    const want = on ? el.dataset.anim : el.dataset.still;
    if (img.getAttribute('src') !== want) img.setAttribute('src', want);
  });
}
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
  $('#auth-title').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
  $('#auth-sub').textContent = authMode === 'login' ? 'Use o seu nome de usuário e senha.' : 'Escolha um nome de usuário (é o seu login) e uma senha de pelo menos 6 caracteres.';
  $('#auth-foot').textContent = authMode === 'login' ? 'Ainda não tem conta? Toque em "Criar conta" acima.' : 'Já tem conta? Toque em "Entrar" acima.';
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
  closeSettings();
  stopIncoming();
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
  setMembers(!isMobile() && store.get('nexo_members') !== '0', true);
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
    S.dms = d.dms || [];
    S.friends = d.friends || { friends: [], in: [], out: [] };
    S.friends.friends.concat(S.friends.in, S.friends.out).forEach(cacheUser);
    S.users = {};
    S.dms.forEach(x => cacheUser(x.user));
    d.groups.forEach(g => g.members.forEach(cacheUser));
    if (S.gid === '@me' && !S.dms.length) S.gid = S.groups[0]?.id || '@me';
    if (S.gid !== '@me' && !group(S.gid)) S.gid = S.groups[0]?.id || (S.dms.length ? '@me' : null);
    // recarrega historico apos reconectar
    S.msgs = {};
    S.more = {};
    renderAll();
    if (S.view !== 'voice' || !call.channelId) openDefaultChannel();
    else if (S.cid) loadHistory(S.cid);
    if (S.pendingInvite) { const inv = S.pendingInvite; S.pendingInvite = null; joinGroup(inv); }
    if (call.rejoin) rejoinCall();
  });

  sock.on('group:update', g => {
    g.members.forEach(cacheUser);
    const i = S.groups.findIndex(x => x.id === g.id);
    if (i >= 0) S.groups[i] = g; else S.groups.push(g);
    if (S.cid && !findChannel(S.cid)) { S.cid = null; if (S.gid === g.id) openDefaultChannel(); }
    renderAll();
    if (S.cid && S.view === 'chat') renderMessages('keep');
    window.onGroupUpdate?.(g);
    if (call.channelId) renderTiles();
  });

  sock.on('group:removed', ({ groupId, reason }) => {
    const g = group(groupId);
    S.groups = S.groups.filter(x => x.id !== groupId);
    if (call.groupId === groupId) leaveCall();
    if (S.gid === groupId) { S.gid = S.groups[0]?.id || null; S.cid = null; openDefaultChannel(); }
    renderAll();
    window.onGroupUpdate?.({ id: groupId });
    if (g) toast(reason || `Você saiu de "${g.name}"`, reason ? 6000 : 3200);
  });

  sock.on('voice:presence', ({ groupId, voice }) => {
    const g = group(groupId);
    if (!g) return;
    g.voice = voice;
    renderChannels();
    renderMembers();
  });

  sock.on('message', ({ groupId, channelId, msg, dm }) => {
    if (S.msgs[channelId]) S.msgs[channelId].push(msg);
    stopTypingOf(channelId, msg.userId);
    const visible = channelId === S.cid && S.view === 'chat' && document.visibilityState === 'visible';
    if (channelId === S.cid) renderMessages(true);
    if (!visible && msg.userId !== S.user?.id) {
      S.unread.add(channelId);
      renderRail(); renderChannels();
      if (shouldNotify(msg, groupId, dm)) {
        playNotifySound();
        notify(msg, dm ? '@me' : groupId, channelId, dm ? msg.userId : null);
      }
    }
  });
  sock.on('typing', onTyping);
  sock.on('session:ended', () => { toast('Sua conta foi desconectada deste aparelho.', 6000); logout(); });

  sock.on('profile:me', u => { S.user = u; renderAll(); if (S.cid) renderMessages('keep'); if (call.channelId) renderTiles(); });
  sock.on('friends', f => {
    S.friends = f;
    [...f.friends, ...f.in, ...f.out].forEach(cacheUser);
    renderRail();
    if (S.gid === '@me') { renderChannels(); if (S.view === 'friends') renderFriends(); }
  });
  sock.on('dm:ring', ({ channelId, from }) => {
    if (call.channelId === channelId) return;      // já estou na ligação
    if (call.channelId) {                           // ocupado em outra chamada
      emit('dm:decline', { channelId });
      toast(`${from.name} tentou te ligar.`, 6000);
      return;
    }
    showIncoming(channelId, from);
  });
  sock.on('dm:ring-stop', ({ channelId }) => {
    if (ring.channelId === channelId) { stopIncoming(); closeModal(); }
  });
  sock.on('dm:declined', ({ channelId, by }) => {
    toast(`${by.name} recusou a ligação.`, 5000);
    if (call.channelId === channelId) leaveCall();
    else if (isDmChannel(channelId)) openDM(dmOther(channelId));
  });
  sock.on('dm:voice', ({ channelId, people }) => {
    const other = dmOther(channelId);
    const d = S.dms.find(x => x.user.id === other);
    if (d) { d.inCall = people.length > 0; if (S.gid === '@me') renderChannels(); }
    // o outro desligou: encerra do meu lado também
    if (call.channelId === channelId && people.length === 1 && call.peers.size === 0 && call.hadPeer) {
      toast('A ligação terminou.');
      leaveCall();
    }
    if (call.channelId === channelId && people.length > 1) call.hadPeer = true;
  });

  sock.on('voice:force', ({ action, channelId, by }) => {
    if (action === 'mute') {
      call.fmute = true;
      call.micOn = false;
      if (call.micTrack) call.micTrack.enabled = false;
      sendState(); renderControls(); renderCallbar(); renderTiles();
      toast(`${by} silenciou o seu microfone.`, 5000);
    } else if (action === 'unmute') {
      call.fmute = false;
      renderControls(); renderCallbar();
      toast(`${by} tirou o silêncio do seu microfone.`);
    } else if (action === 'deafen') {
      call.fdeaf = true;
      call.micOn = false;
      if (call.micTrack) call.micTrack.enabled = false;
      applyAllVolumes();
      sendState(); renderControls(); renderCallbar(); renderTiles();
      toast(`${by} desativou o seu áudio nesta sala.`, 5000);
    } else if (action === 'undeafen') {
      call.fdeaf = false;
      applyAllVolumes();
      renderControls(); renderCallbar(); renderTiles();
      toast(`${by} reativou o seu áudio.`);
    } else if (action === 'disconnect') {
      leaveCall();
      toast(`${by} desconectou você da chamada.`, 5000);
    } else if (action === 'move') {
      toast(`${by} moveu você de sala.`);
      joinCall(channelId);
    }
  });
  sock.on('dm:update', ({ entry }) => {
    if (!entry) return;
    cacheUser(entry.user);
    if (call.channelId) renderTiles();
    const i = S.dms.findIndex(x => x.user.id === entry.user.id);
    if (i >= 0) S.dms[i] = entry; else S.dms.push(entry);
    renderRail();
    if (S.gid === '@me') renderChannels();
  });
  sock.on('presence', ({ userId, online, presence }) => {
    for (const g of S.groups) for (const m of g.members) if (m.id === userId) { m.online = online; m.presence = presence; }
    for (const d of S.dms) if (d.user.id === userId) { d.user.online = online; d.user.presence = presence; }
    if (S.users[userId]) { S.users[userId].online = online; S.users[userId].presence = presence; }
    renderMembers();
    if (S.gid === '@me') renderChannels();
    if (S.dmPeer === userId) renderHeader();
  });
  sock.on('message:edit', ({ channelId, id, text, mentions }) => {
    const m = (S.msgs[channelId] || []).find(x => x.id === id);
    if (m) { m.text = text; m.edited = true; m.mentions = mentions || []; if (channelId === S.cid) renderMessages('keep'); }
  });
  sock.on('message:delete', ({ channelId, id }) => {
    const arr = S.msgs[channelId];
    if (!arr) return;
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) { arr.splice(i, 1); if (channelId === S.cid) renderMessages('keep'); }
  });
  sock.on('message:react', ({ channelId, id, reactions }) => {
    const m = (S.msgs[channelId] || []).find(x => x.id === id);
    if (m) { m.reactions = reactions; if (channelId === S.cid) renderMessages('keep'); }
  });

  sock.on('disconnect', reason => {
    if (reason === 'io client disconnect') return;
    if (call.channelId) {
      // a chamada continua: só reconectamos quando a internet voltar
      call.rejoin = call.channelId;
      for (const sid of [...call.peers.keys()]) removePeer(sid);
      call.mySid = null;
      renderTiles();
      toast('Conexão caiu. Reconectando à chamada…', 4000);
    } else toast('Reconectando…');
  });

  sock.on('voice:peer-joined', p => { if (call.channelId) { addPeer(p); playJoinSound(true); } });
  sock.on('voice:peer-left', ({ sid }) => { if (call.peers.has(sid)) { removePeer(sid); playJoinSound(false); } });
  sock.on('voice:state', p => onPeerState(p));
  sock.on('signal', ({ from, data }) => onSignal(from, data));
  sock.on('voice:watch', onWatchRequest);
  // outro aparelho meu mandou ligar/desligar o microfone ou o áudio deste
  sock.on('voice:self', async ({ action, from }) => {
    if (!call.channelId) return;
    if (action === 'mic-off') await setMicOn(false);
    else if (action === 'mic-on') { if (call.fmute || call.fdeaf) return; if (call.deaf) setDeafOn(false); await setMicOn(true); }
    else if (action === 'deaf-on') setDeafOn(true);
    else if (action === 'deaf-off') setDeafOn(false);
    const what = { 'mic-off': 'desligou o microfone', 'mic-on': 'ligou o microfone', 'deaf-on': 'desativou o áudio', 'deaf-off': 'reativou o áudio' }[action];
    if (what) toast(`Seu ${from} ${what} deste aparelho.`);
  });
  sock.on('voice:quality', ({ from, maxH }) => {
    const peer = call.peers.get(from);
    if (!peer) return;
    peer.wantH = maxH || 0;
    if (call.screenTrack) tunePeerSenders(peer);
  });
}

function notify(msg, groupId, channelId, dmPeer) {
  try {
    if (document.visibilityState === 'visible') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const f = findChannel(channelId);
    const who = nameOf(msg.userId, msg.username);
    const title = dmPeer ? who : `${who} em #${f?.c.name || ''}`;
    const body = msg.text || (msg.att ? '📎 ' + msg.att.name : '');
    const n = new Notification(title, { body: body.slice(0, 140), icon: '/icons/icon-192.png', tag: channelId });
    n.onclick = () => { window.focus(); if (dmPeer) openDM(dmPeer); else { S.gid = groupId; openTextChannel(channelId); } n.close(); };
  } catch {}
}
function askNotifyPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}

// ---------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------
function openDefaultChannel() {
  if (S.gid === '@me') {
    const d = S.dms.find(x => x.user.id === S.dmPeer) || S.dms[0];
    if (d) openDM(d.user.id); else openFriends();
    return;
  }
  const g = curGroup();
  if (!g) { S.cid = null; setView('empty'); return; }
  const last = store.get('nexo_cid_' + g.id);
  const c = g.channels.find(x => x.id === last && x.type === 'text') || g.channels.find(x => x.type === 'text');
  if (c) openTextChannel(c.id);
  else { S.cid = null; setView(call.channelId ? 'voice' : 'empty'); }
}

function selectGroup(gid) {
  S.gid = gid;
  if (gid !== '@me') S.dmPeer = null;
  store.set('nexo_gid', gid);
  S.cid = null;
  openDefaultChannel();
  renderAll();
}

// Abre uma conversa privada
async function openDM(userId) {
  const r = await emit('dm:open', { userId });
  if (r.error) return toast(r.error);
  cacheUser(r.user);
  if (!S.dms.some(x => x.user.id === userId)) S.dms.push({ user: r.user, last: null });
  S.msgs[r.channelId] = r.messages;
  S.more[r.channelId] = !!r.hasMore;
  S.gid = '@me'; S.dmPeer = userId; S.cid = r.channelId;
  S.unread.delete(r.channelId);
  store.set('nexo_gid', '@me');
  clearCompose();
  setView('chat');
  renderMessages();
  closeDrawer();
  renderAll();
  if (!isMobile()) $('#msg-input').focus();
}

function openTextChannel(cid) {
  const f = findChannel(cid);
  if (!f) return;
  S.dmPeer = null;
  S.gid = f.g.id;
  S.cid = cid;
  clearCompose();
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
  if (r.messages) { S.msgs[cid] = r.messages; S.more[cid] = !!r.hasMore; if (S.cid === cid) renderMessages(); }
}

function openFriends(tab) {
  if (tab) friendTab = tab;
  S.gid = '@me'; S.dmPeer = null; S.cid = null;
  store.set('nexo_gid', '@me');
  setView('friends');
  closeDrawer();
  renderAll();
  renderFriends();
}
let friendTab = 'todos';
function renderFriends() {
  const el = $('#friends-view');
  const f = S.friends;
  const tabs = [['todos', 'Todos', f.friends.length], ['pendente', 'Pendentes', 0], ['add', 'Adicionar amigo', 0]];
  if (friendTab === 'add') {
    el.innerHTML = tabHtml() + `<h2 style="margin:0">Adicionar amigo</h2>
      <p class="muted" style="margin:0">Adicione pelo <b>nome de usuário</b> (o @, não o nome exibido) ou pelo <b>ID</b>. Não existe busca de pessoas: só encontra quem você já conhece.</p>
      <form class="fadd" id="fa-form"><input id="fa-q" placeholder="Nome de usuário ou ID" autocomplete="off"><button class="btn primary">Enviar pedido</button></form>
      <p class="muted" style="margin:0;font-size:13px">O seu nome de usuário é <b style="color:var(--txt)">@${esc(S.user.username)}</b> e o seu ID é <b style="color:var(--txt)">${esc(S.user.id)}</b> — passe um dos dois para quem quiser te adicionar.
      <button class="btn sm" id="fa-copy" style="margin-left:6px">Copiar ID</button></p>`;
    el.querySelector('#fa-copy').onclick = () => navigator.clipboard?.writeText(S.user.id).then(() => toast('ID copiado!')).catch(() => toast(S.user.id));
    el.querySelector('#fa-form').onsubmit = async e => {
      e.preventDefault();
      const i = el.querySelector('#fa-q');
      const r = await emit('friend:add', { query: i.value });
      if (r.error) return toast(r.error);
      i.value = '';
      toast(r.msg || 'Pedido enviado!');
    };
  } else if (friendTab === 'pendente') {
    const row = (u, kind) => `<div class="frow">${avatar(u, 'sm')}<span class="col"><b>${esc(u.name)}</b><span>${kind === 'in' ? 'Quer ser seu amigo' : 'Pedido enviado'} · @${esc(u.username)}</span></span>
      <span class="acts">${kind === 'in' ? `<button class="btn primary sm" data-ok="${esc(u.id)}">Aceitar</button>` : ''}<button class="btn sm" data-no="${esc(u.id)}">${kind === 'in' ? 'Recusar' : 'Cancelar'}</button></span></div>`;
    el.innerHTML = tabHtml() + (f.in.length || f.out.length
      ? f.in.map(u => row(u, 'in')).join('') + f.out.map(u => row(u, 'out')).join('')
      : `<div class="set-empty"><b>Nenhum pedido</b><span>Quando alguém te adicionar, aparece aqui.</span></div>`);
  } else {
    const row = u => `<div class="frow">${avatar(u, 'sm')}<span class="col"><b style="color:${esc(u.color)}">${esc(u.name)}</b><span>${u.status || PRESENCE_LABEL[presOf(u)] || 'Offline'} · @${esc(u.username)}</span></span>
      <span class="acts"><button class="btn sm" data-dm="${esc(u.id)}">Mensagem</button><button class="btn sm" data-prof="${esc(u.id)}">Perfil</button><button class="btn danger sm" data-no="${esc(u.id)}">Remover</button></span></div>`;
    const on = f.friends.filter(u => presOf(u) !== 'offline'), off = f.friends.filter(u => presOf(u) === 'offline');
    el.innerHTML = tabHtml() + (f.friends.length
      ? (on.length ? `<div class="sec">Online <span class="cnt">${on.length}</span></div>` + on.map(row).join('') : '')
        + (off.length ? `<div class="sec">Offline <span class="cnt">${off.length}</span></div>` + off.map(row).join('') : '')
      : `<div class="set-empty"><b>Nenhum amigo ainda</b><span>Use a aba "Adicionar amigo" para chamar alguém.</span></div>`);
  }
  el.querySelectorAll('.ftab').forEach(b => b.onclick = () => { friendTab = b.dataset.t; renderFriends(); });
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => emit('friend:accept', { userId: b.dataset.ok }));
  el.querySelectorAll('[data-no]').forEach(b => b.onclick = () => emit('friend:remove', { userId: b.dataset.no }));
  el.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => openDM(b.dataset.dm));
  el.querySelectorAll('[data-prof]').forEach(b => b.onclick = () => openProfile(b.dataset.prof));
  function tabHtml() {
    return `<div class="ftabs">${tabs.map(([k, t, c]) => `<button class="ftab ${k === friendTab ? 'active' : ''}" data-t="${k}">${esc(t)}${c ? `<span class="cnt">${c}</span>` : ''}${k === 'pendente' && f.in.length ? `<span class="badge">${f.in.length}</span>` : ''}</button>`).join('')}</div>`;
  }
}

function setView(v) {
  S.view = v;
  $('#friends-view').classList.toggle('hidden', v !== 'friends');
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
$('#backdrop').onclick = () => { closeDrawer(); if (isMobile()) setMembers(false); };

// ---------------------------------------------------------------------
// Renderizacao
// ---------------------------------------------------------------------
function renderAll() { renderRail(); renderChannels(); renderHeader(); renderUserbar(); renderCallbar(); renderMembers(); }

function renderRail() {
  if (typeof updateTitle === 'function') updateTitle();
  const rail = $('#rail');
  rail.innerHTML = '';
  const dmUnread = S.dms.some(d => S.unread.has(dmChannelId(d.user.id)));
  const home = document.createElement('button');
  home.className = 'rail-home' + (S.gid === '@me' ? '' : ' off') + (dmUnread ? ' unread' : '');
  home.title = 'Mensagens diretas';
  home.innerHTML = I.home + (S.friends.in.length ? `<span class="badge">${S.friends.in.length}</span>` : '');
  home.onclick = () => selectGroup('@me');
  rail.appendChild(home);
  if (S.groups.length) { const sp = document.createElement('div'); sp.className = 'rail-sep'; rail.appendChild(sp); }
  for (const g of S.groups) {
    const b = document.createElement('button');
    const unread = g.channels.some(c => S.unread.has(c.id));
    b.className = 'g-btn' + (g.id === S.gid ? ' active' : '') + (unread ? ' unread' : '');
    b.title = g.name;
    if (g.iv) b.innerHTML = `<img src="/api/gicon/${esc(g.id)}?v=${g.iv}" alt="">`;
    else b.textContent = g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
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

// Junta as sessões da mesma pessoa (vários aparelhos) numa linha só
function dedupeVoice(people) {
  const out = new Map();
  for (const p of people) {
    const cur = out.get(p.userId);
    if (!cur) { out.set(p.userId, { ...p }); continue; }
    cur.mic = cur.mic || p.mic; cur.cam = cur.cam || p.cam; cur.screen = cur.screen || p.screen;
    cur.fmute = cur.fmute && p.fmute;
    if (p.cam || p.mic) cur.sid = p.sid;
  }
  return [...out.values()];
}

const dmChannelId = other => 'd' + [S.user.id, other].sort().join('_');
// Numa conversa privada não há cargos: câmera e tela são sempre liberadas
const isDmChannel = cid => typeof cid === 'string' && cid[0] === 'd' && cid.includes('_');
const dmOther = cid => isDmChannel(cid) ? cid.slice(1).split('_').find(x => x !== S.user?.id) : null;
const callIsDm = () => isDmChannel(call.channelId);

function renderChannels() {
  const head = $('#side-head'), list = $('#channels');
  if (S.gid === '@me') return renderDMs(head, list);
  const g = curGroup();
  if (!g) {
    head.style.background = '';
    head.innerHTML = `<span class="name">Nexo</span>`;
    list.innerHTML = `<p class="muted" style="padding:10px">Você ainda não está em nenhum grupo.</p>`;
    return;
  }
  const canCh = can(g, 'manageChannels');
  if (g.bv) {
    head.style.background = `center/cover no-repeat url("/api/gbanner/${esc(g.id)}?v=${g.bv}")`;
    head.classList.add('has-banner');
  } else {
    head.style.background = g.banner ? `linear-gradient(${g.banner}, ${g.banner}55)` : '';
    head.classList.remove('has-banner');
  }
  head.innerHTML = `<button class="g-menu" id="g-menu" title="Menu do grupo"><span class="name">${esc(g.name)}</span>${I.chev}</button>
    <button class="icon-btn" data-act="invite" title="Convidar pessoas">${I.invite}</button>`;
  head.querySelector('#g-menu').onclick = e => openGroupMenu(g, e.currentTarget);
  head.querySelector('[data-act=invite]').onclick = () => inviteModal(g);

  const del = c => canCh ? `<span class="icon-btn del" data-del="${c.id}" title="Excluir">${I.trash}</span>` : '';
  const row = c => {
    if (c.type === 'text') {
      const active = c.id === S.cid && S.view === 'chat';
      return `<button class="ch ${active ? 'active' : ''} ${S.unread.has(c.id) ? 'unread' : ''}" data-cid="${c.id}" data-ch="${c.id}">${I.hash}<span class="label">${esc(c.name)}</span>${del(c)}</button>`;
    }
    const people = g.voice?.[c.id] || [];
    const active = call.channelId === c.id && S.view === 'voice';
    return `<button class="ch ${active ? 'active' : ''}" data-vid="${c.id}" data-ch="${c.id}">${I.speaker}<span class="label">${esc(c.name)}</span>${del(c)}</button>`
      + (people.length ? `<div class="vusers">` + dedupeVoice(people).map(p => `<div class="vuser" data-sid="${esc(p.sid)}" data-uid="${esc(p.userId)}" title="Opções">${avatar(p, 'sm')}<span class="nm">${esc(nameOf(p.userId, p.username))}</span>
        ${p.screen ? '<span class="live">AO VIVO</span>' : ''}${p.cam ? I.cam : ''}${p.fdeaf || p.deaf ? `<span class="${p.fdeaf ? 'fm' : ''}">${I.headOff}</span>` : ''}${p.fmute ? `<span class="fm">${I.micOff}</span>` : (p.mic ? '' : I.micOff)}</div>`).join('') + `</div>` : '');
  };
  const add = (type, cat = '') => canCh ? `<button class="icon-btn" data-add="${type}" data-cat="${cat}" title="Criar canal">${I.plus}</button>` : '';
  const cats = g.categories || [];
  const ids = new Set(cats.map(c => c.id));
  const loose = g.channels.filter(c => !c.cat || !ids.has(c.cat));
  const lt = loose.filter(c => c.type === 'text'), lv = loose.filter(c => c.type === 'voice');
  let html = '';
  if (lt.length || !cats.length) html += `<div class="sec" data-cat="">Canais de texto ${add('text')}</div>` + lt.map(row).join('');
  if (lv.length || !cats.length) html += `<div class="sec" data-cat="">Salas de voz ${add('voice')}</div>` + lv.map(row).join('');
  for (const cat of cats) {
    const cs = g.channels.filter(c => c.cat === cat.id);
    html += `<div class="sec cat" data-cat="${cat.id}">${esc(cat.name)} <span>${add('text', cat.id)}${canCh ? `<button class="icon-btn" data-delcat="${cat.id}" title="Excluir categoria">${I.trash}</button>` : ''}</span></div>`
      + cs.filter(c => c.type === 'text').map(row).join('') + cs.filter(c => c.type === 'voice').map(row).join('');
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => openTextChannel(b.dataset.cid));
  list.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => joinCall(b.dataset.vid));
  list.querySelectorAll('.vuser[data-sid]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const peer = call.peers.get(el.dataset.sid) || (el.dataset.uid === S.user.id ? null : null);
    const r = el.getBoundingClientRect();
    if (peer) openPeerMenu(peer, false, r.left, r.bottom + 4);
    else openProfile(el.dataset.uid);
  });
  list.querySelectorAll('[data-add]').forEach(b => b.onclick = e => { e.stopPropagation(); channelModal(g, b.dataset.add, b.dataset.cat); });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteChannelModal(b.dataset.del); });
  list.querySelectorAll('.ch[data-ch]').forEach(el => {
    const open = e => { e.preventDefault(); openChannelMenu(el.dataset.ch, e.clientX ?? 0, e.clientY ?? 0); };
    el.oncontextmenu = open;
    let t = null;
    el.addEventListener('touchstart', e => { const x = e.touches[0]; t = setTimeout(() => { navigator.vibrate?.(15); openChannelMenu(el.dataset.ch, x.clientX, x.clientY); }, 480); }, { passive: true });
    ['touchmove', 'touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
  });
  list.querySelectorAll('[data-delcat]').forEach(b => b.onclick = () => {
    const cat = cats.find(c => c.id === b.dataset.delcat);
    confirmModal(`Excluir a categoria "${cat.name}"?`, 'Os canais dela continuam existindo, só ficam sem categoria.', 'Excluir', async () => {
      const r = await emit('category:delete', { groupId: g.id, id: cat.id });
      if (r.error) toast(r.error);
    });
  });
}

function renderDMs(head, list) {
  head.style.background = '';
  head.innerHTML = `<span class="name">Mensagens diretas</span><button class="icon-btn" id="dm-new" title="Nova conversa">${I.plus}</button>`;
  head.querySelector('#dm-new').onclick = findUserModal;
  const nIn = S.friends.in.length;
  const top = `<button class="side-btn ${S.view === 'friends' ? 'active' : ''}" id="dm-friends">${I.users}Amigos${nIn ? `<span class="badge">${nIn}</span>` : ''}</button>`;
  const dms = [...S.dms].sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
  if (!dms.length) {
    list.innerHTML = top + `<p class="muted" style="padding:10px">Nenhuma conversa ainda. Adicione um amigo ou clique no perfil de alguém e em "Enviar mensagem".</p>`;
    list.querySelector('#dm-friends').onclick = openFriends;
    return;
  }
  list.innerHTML = top + `<div class="sec">Conversas</div>` + dms.map(d => {
    const cid = dmChannelId(d.user.id);
    const prev = d.inCall ? '📞 Em chamada' : d.last ? (d.last.mine ? 'Você: ' : '') + (d.last.text || '📎 arquivo') : '';
    return `<button class="dm-row ${S.dmPeer === d.user.id ? 'active' : ''} ${S.unread.has(cid) ? 'unread' : ''}" data-dm="${esc(d.user.id)}">
      ${avatar(d.user, 'sm')}<span class="col"><span class="n">${esc(d.user.name)}</span>${prev ? `<span class="p ${d.inCall ? 'incall' : ''}">${esc(prev)}</span>` : ''}</span>
      <span class="icon-btn x" data-close-dm="${esc(d.user.id)}" title="Fechar conversa">${I.x}</span></button>`;
  }).join('');
  list.querySelector('#dm-friends').onclick = openFriends;
  list.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => openDM(b.dataset.dm));
  list.querySelectorAll('[data-close-dm]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const id = b.dataset.closeDm;
    await emit('dm:close', { userId: id });
    S.dms = S.dms.filter(x => x.user.id !== id);
    if (S.dmPeer === id) { S.dmPeer = null; S.cid = null; openDefaultChannel(); }
    renderAll();
  });
}

function openChannelMenu(cid, x, y) {
  const f = findChannel(cid);
  if (!f) return;
  const g = f.g, canCh = can(g, 'manageChannels');
  const cats = g.categories || [];
  ctx.innerHTML = `<div class="vol-h ic">${f.c.type === 'voice' ? I.speaker : I.hash} ${esc(f.c.name)}</div>
    ${f.c.type === 'text' ? `<button class="item" data-a="open">${I.hash}Abrir canal</button>` : `<button class="item" data-a="join">${I.speaker}Entrar na sala</button>`}
    ${canCh && cats.length ? `<div class="vol-h">Mover para categoria</div>
      ${[{ id: '', name: 'Sem categoria' }, ...cats].map(c => `<button class="item" data-cat="${esc(c.id)}">${I.folder}${esc(c.name)}${(f.c.cat || '') === c.id ? '<span class="sub">✓</span>' : ''}</button>`).join('')}` : ''}
    ${canCh ? `<div class="sep"></div><button class="item danger" data-a="del">${I.trash}Excluir canal</button>` : ''}`;
  ctx.onclick = async e => {
    const mv = e.target.closest('[data-cat]'), it = e.target.closest('[data-a]');
    closeCtx();
    if (mv) { const r = await emit('channel:move', { groupId: g.id, channelId: cid, cat: mv.dataset.cat || null }); if (r.error) toast(r.error); return; }
    if (!it) return;
    if (it.dataset.a === 'open') openTextChannel(cid);
    if (it.dataset.a === 'join') joinCall(cid);
    if (it.dataset.a === 'del') deleteChannelModal(cid);
  };
  placeCtx(x, y);
}

// ---------- Arrastar com o mouse: canais entre categorias, pessoas entre salas ----------
(function wireDrag() {
  const list = $('#channels');
  let st = null, ghost = null, target = null;
  const clear = () => {
    ghost?.remove(); ghost = null;
    st?.el.classList.remove('dragging');
    target?.classList.remove('drop-ok');
    target = null; st = null;
  };
  list.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest('.icon-btn')) return;
    const g = curGroup(); if (!g) return;
    const ch = e.target.closest('.ch[data-ch]'), vu = e.target.closest('.vuser[data-sid]');
    if (ch && !can(g, 'manageChannels')) return;
    if (vu && !can(g, 'moveMembers')) return;
    if (!ch && !vu) return;
    st = { el: ch || vu, kind: ch ? 'ch' : 'user', x: e.clientX, y: e.clientY, on: false };
  });
  window.addEventListener('pointermove', e => {
    if (!st) return;
    if (!st.on) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 7) return;
      st.on = true;
      st.el.classList.add('dragging');
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = st.el.querySelector('.label, .nm')?.textContent || '';
      document.body.appendChild(ghost);
    }
    e.preventDefault();
    ghost.style.left = (e.clientX + 12) + 'px';
    ghost.style.top = (e.clientY + 12) + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const t = st.kind === 'ch'
      ? under?.closest('.ch[data-ch], .sec[data-cat]')
      : under?.closest('.ch[data-vid]');
    if (t !== target) { target?.classList.remove('drop-ok'); target = t && t !== st.el ? t : null; target?.classList.add('drop-ok'); }
  });
  window.addEventListener('pointerup', async () => {
    if (!st) return;
    const { kind, el } = st, t = target, on = st.on;
    clear();
    if (!on || !t) return;
    const g = curGroup(); if (!g) return;
    if (kind === 'ch') {
      const id = el.dataset.ch;
      let cat = null, before = null;
      if (t.classList.contains('sec')) cat = t.dataset.cat || null;
      else { before = t.dataset.ch; cat = findChannel(before)?.c.cat || null; }
      const r = await emit('channel:move', { groupId: g.id, channelId: id, cat, before });
      if (r.error) toast(r.error);
    } else {
      const r = await emit('voice:force', { sid: el.dataset.sid, action: 'move', to: t.dataset.vid });
      if (r.error) toast(r.error);
    }
  });
  window.addEventListener('pointercancel', clear);
})();

// Com quem eu posso conversar: amigos, quem divide um grupo comigo
// e quem já tem conversa aberta. Não existe busca de desconhecidos.
function peopleICanTalkTo() {
  const out = new Map();
  const add = (u, from) => {
    if (!u || u.id === S.user?.id) return;
    const cur = out.get(u.id);
    if (cur) { if (!cur.from.includes(from)) cur.from.push(from); return; }
    out.set(u.id, { user: u, from: [from] });
  };
  (S.friends?.friends || []).forEach(u => add(u, 'Amigo'));
  for (const g of S.groups) for (const m of g.members) add(m, g.name);
  for (const d of S.dms) add(d.user, 'Conversa');
  return [...out.values()].sort((x, y) => x.user.name.localeCompare(y.user.name, 'pt-BR'));
}
const canTalkTo = uid => uid !== S.user?.id && peopleICanTalkTo().some(p => p.user.id === uid);

function findUserModal() {
  const all = peopleICanTalkTo();
  const row = p => `<button class="find-row" data-u="${esc(p.user.id)}">${avatar(p.user, 'sm')}
    <span class="col"><b>${esc(p.user.name)}</b><span>@${esc(p.user.username)} · ${esc(p.from.slice(0, 2).join(', '))}</span></span></button>`;
  modal(`<h3>Nova conversa</h3>
    <p class="muted" style="margin:0">Seus amigos e quem está nos seus grupos. Para falar com outra pessoa, mande um pedido de amizade pelo nome de usuário ou ID dela.</p>
    ${all.length > 6 ? '<label>Filtrar<input id="fu-q" placeholder="Nome da pessoa" autocomplete="off"></label>' : ''}
    <div class="find-list" id="fu-list">${all.length ? all.map(row).join('')
      : '<p class="muted" style="margin:0">Você ainda não tem amigos nem grupos em comum com ninguém.</p>'}</div>
    <div class="acts"><button class="btn" id="fu-add">Adicionar amigo</button><button class="btn" data-close>Fechar</button></div>`, card => {
    const wire = () => card.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { closeModal(); openDM(b.dataset.u); });
    wire();
    card.querySelector('#fu-add').onclick = () => { closeModal(); openFriends('add'); };
    card.querySelector('#fu-q')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const hits = q ? all.filter(p => (p.user.name + ' ' + p.user.username).toLowerCase().includes(q)) : all;
      card.querySelector('#fu-list').innerHTML = hits.length ? hits.map(row).join('')
        : '<p class="muted" style="margin:0">Ninguém com esse nome na sua lista.</p>';
      wire();
    });
  });
}

function renderHeader() {
  renderHeaderMain();
  if (S.view === 'chat' && S.cid) {
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.title = 'Pesquisar mensagens (Ctrl+F)'; b.innerHTML = I.search;
    b.onclick = openSearch;
    $('#head-actions').prepend(b);
  }
  if (typeof renderTyping === 'function') renderTyping();
}
function renderHeaderMain() {
  const t = $('#main-title'), a = $('#head-actions');
  a.innerHTML = '';
  if (S.gid === '@me' && S.view === 'friends') { t.innerHTML = `<span class="dm-head">${I.users}<span>Amigos</span></span>`; return; }
  if (S.gid === '@me') {
    const u = S.dmPeer && userById(S.dmPeer);
    const ringing = u && call.channelId === dmChannelId(u.id) && S.view === 'voice';
    t.innerHTML = u ? `<span class="dm-head">${ringing ? I.phone : avatar(u, 'sm')}<span>${esc(u.name)}</span></span>` : '<span>Mensagens diretas</span>';
    $('#msg-input').disabled = !S.cid;
    $('#msg-input').placeholder = u ? `Conversar com ${u.name}` : 'Mensagem';
    if (u) {
      const inCall = call.channelId === dmChannelId(u.id);
      const mk = (title, html, fn, cls = '') => {
        const b = document.createElement('button');
        b.className = 'icon-btn ' + cls; b.title = title; b.innerHTML = html;
        b.onclick = fn;
        a.appendChild(b);
      };
      if (inCall && S.view === 'voice') mk('Voltar à conversa', I.hash, () => openDM(u.id));
      else if (inCall) mk('Voltar à chamada', I.grid, () => setView('voice'), 'live-btn');
      else {
        mk('Ligação de voz', I.phone, () => startDmCall(u.id, false));
        mk('Ligação de vídeo', I.cam, () => startDmCall(u.id, true));
      }
      mk('Ver perfil', I.users, () => openProfile(u.id));
    }
    return;
  }
  if (S.view === 'chat' && S.cid) {
    const f = findChannel(S.cid);
    t.innerHTML = `${I.hash}<span>${esc(f?.c.name || '')}</span>`;
    const canSend = can(f?.g, 'sendMessages');
    $('#msg-input').disabled = !canSend;
    $('#msg-input').placeholder = canSend ? `Conversar em #${f?.c.name || ''}` : 'Você não tem permissão para enviar mensagens neste grupo.';
    if (call.channelId) {
      const b = document.createElement('button');
      b.className = 'btn primary'; b.style.padding = '6px 12px';
      b.textContent = 'Voltar à chamada';
      b.onclick = () => setView('voice');
      a.appendChild(b);
    }
  } else if (S.view === 'voice' && callIsDm()) {
    const u = userById(dmOther(call.channelId));
    t.innerHTML = `<span class="dm-head">${I.phone}<span>${esc(u?.name || 'Ligação')}</span></span>`;
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.title = 'Voltar à conversa'; b.innerHTML = I.back;
    b.onclick = () => openDM(dmOther(call.channelId));
    a.appendChild(b);
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
  if (curGroup()) {
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.title = 'Membros'; b.innerHTML = I.users;
    b.onclick = () => setMembers(!$('#app').classList.contains('show-members'));
    a.appendChild(b);
  }
}

// ---------- Lista de membros (online / em voz / offline) ----------
function setMembers(show, silent) {
  $('#app').classList.toggle('show-members', !!show);
  if (!silent && !isMobile()) store.set('nexo_members', show ? '1' : '0');
}
function renderMembers() {
  const el = $('#members'), g = curGroup();
  if (!g || !S.user || S.gid === '@me') { el.innerHTML = ''; return; }
  const inVoice = new Map();
  for (const c of g.channels) if (c.type === 'voice')
    for (const p of g.voice?.[c.id] || []) inVoice.set(p.userId, { name: c.name, screen: p.screen });
  const byName = (a, b) => a.username.localeCompare(b.username, 'pt-BR');
  const on = g.members.filter(m => m.online || m.id === S.user.id).sort(byName);
  const off = g.members.filter(m => !(m.online || m.id === S.user.id)).sort(byName);
  const row = (m, isOn) => {
    const v = inVoice.get(m.id);
    const st = v ? `<div class="st voice">${v.screen ? I.screen + 'Transmitindo em' : I.speaker + 'Em voz:'} ${esc(v.name)}</div>` : (m.status ? `<div class="st">${esc(m.status)}</div>` : '');
    return `<div class="mem ${isOn ? 'on' : 'off'}" data-uid="${esc(m.id)}"><div class="avw">${avatar(m, 'sm')}</div>
      <div class="info"><div class="n" style="color:${isOn ? esc(nameColor(m.id, m.color, g)) : 'inherit'}">${esc(m.name)}${m.id === g.ownerId ? `<i class="crown" title="Dono do grupo">${I.crown}</i>` : ''}</div>${st}</div></div>`;
  };
  el.innerHTML = `<div class="sec">Online <span class="cnt">${on.length}</span></div>${on.map(m => row(m, true)).join('')}`
    + (off.length ? `<div class="sec">Offline <span class="cnt">${off.length}</span></div>${off.map(m => row(m, false)).join('')}` : '');
}

function renderUserbar() {
  if (!S.user) return;
  $('#userbar').innerHTML = `<button class="me-btn" id="ub-me" title="Meu perfil e status">${avatar(S.user, 'sm')}<span class="col"><span class="nm">${esc(S.user.name)}</span><span class="sub">${esc(S.user.status || '@' + S.user.username)}</span></span></button>
    ${S.installEvt ? `<button class="icon-btn install-btn" id="ub-install" title="Instalar o app neste aparelho">${I.download}</button>` : ''}<button class="icon-btn" id="ub-gear" title="Configurações">${I.gear}</button>`;
  $('#ub-install')?.addEventListener('click', installApp);
  $('#ub-me').onclick = e => openMeMenu(e.currentTarget);
  $('#ub-gear').onclick = () => openAccount();
}

function renderCallbar() {
  const bar = $('#callbar');
  if (!call.channelId) { bar.classList.add('hidden'); return; }
  const f = findChannel(call.channelId);
  const dmU = callIsDm() ? userById(dmOther(call.channelId)) : null;
  bar.classList.remove('hidden');
  bar.innerHTML = `<div class="st"><span class="dot"></span>${dmU ? 'Em ligação' : 'Conectado na voz'}</div>
    <div class="where">${dmU ? esc(dmU.name) : esc(f?.c.name || '') + ' / ' + esc(f?.g.name || '')}</div>
    <div class="acts">
      <button class="icon-btn ${call.micOn && call.micTrack ? '' : 'off'}" data-c="mic" title="Microfone">${call.micOn && call.micTrack ? I.mic : I.micOff}</button>
      <button class="icon-btn ${isDeaf() ? 'off' : ''}" data-c="deaf" title="Áudio">${isDeaf() ? I.headOff : I.head}</button>
      <button class="icon-btn" data-c="view" title="Abrir chamada">${I.grid}</button>
      <button class="icon-btn off" data-c="leave" title="Sair da chamada">${I.phoneOff}</button>
    </div>`;
  bar.querySelector('[data-c=mic]').onclick = toggleMic;
  bar.querySelector('[data-c=deaf]').onclick = toggleDeaf;
  bar.querySelector('[data-c=view]').onclick = () => { setView('voice'); closeDrawer(); };
  bar.querySelector('[data-c=leave]').onclick = () => leaveCall();
}

const QUICK = ['✅', '❤️', '😂', '👍'];
const EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '🙏', '💀', '👀', '✅', '❌', '💯',
  '😎', '🤔', '😭', '🥰', '😴', '🤡', '🤝', '💪', '🎮', '🏆', '⭐', '🍕', '☕', '🍺', '💤', '🚀'];

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function attHtml(a) {
  if (!a) return '';
  const url = `/api/file/${esc(a.id)}`;
  if (a.mime?.startsWith('image/')) {
    const r = a.w && a.h ? ` style="aspect-ratio:${a.w}/${a.h}"` : '';
    return `<img class="att-img" src="${url}" alt="${esc(a.name)}" data-img="${url}" data-name="${esc(a.name)}" loading="lazy"${r}>`;
  }
  if (a.mime?.startsWith('video/')) return `<video class="att-img" src="${url}" controls preload="metadata"></video>`;
  if (a.mime?.startsWith('audio/')) return `<audio src="${url}" controls style="margin-top:6px;max-width:100%"></audio>`;
  return `<a class="att-file" href="${url}" download="${esc(a.name)}" target="_blank" rel="noopener">${I.file}<span class="col"><b>${esc(a.name)}</b><span>${fmtSize(a.size || 0)}</span></span></a>`;
}

function msgHtml(m, grouped) {
  if (m.sys) return `<div class="sysmsg"><b>→</b><span>${esc(m.text)}</span><time>${fmtDate(m.ts)}</time></div>`;
  const reply = m.reply ? `<div class="reply-ref" data-goto="${esc(m.reply.id)}">${I.reply}<b style="color:${esc(nameColor(m.reply.id && userById(m.reply.id) ? m.reply.id : '', m.reply.color))}">${esc(m.reply.username)}</b><span>${esc(m.reply.text)}</span></div>` : '';
  const rs = m.reactions ? Object.entries(m.reactions).filter(([, ids]) => ids.length) : [];
  const reacts = rs.length ? `<div class="reacts">${rs.map(([e, ids]) =>
    `<button class="react ${ids.includes(S.user?.id) ? 'mine' : ''}" data-react="${esc(e)}">${emojiHtml(e)} <b>${ids.length}</b></button>`).join('')}</div>` : '';
  const body = (m.text ? `<div class="msg-text">${richText(m.text)}${m.edited ? ' <span class="edited">(editado)</span>' : ''}</div>` : '') + attHtml(m.att);
  const text = body + reacts;
  const tools = `<div class="msg-tools"><button data-t="react" title="Reagir">${I.smile}</button><button data-t="reply" title="Responder">${I.reply}</button><button data-t="more" title="Mais">${I.more}</button></div>`;
  const mc = typeof mentionsMe === 'function' && mentionsMe(m) ? ' mentioned' : '';
  if (!grouped) return `<div class="msg first${mc}" data-id="${esc(m.id)}">${avatar(m)}<div class="msg-body">${reply}<div class="msg-head">
    <span class="msg-author" style="color:${esc(nameColor(m.userId, m.color))}">${esc(nameOf(m.userId, m.username))}</span><span class="msg-time">${fmtDate(m.ts)}</span></div>${text}</div>${tools}</div>`;
  return `<div class="msg${mc}" data-id="${esc(m.id)}"><div class="gutter">${fmtTime(m.ts)}</div><div class="msg-body">${text}</div>${tools}</div>`;
}

// mode: undefined = abre no fim | true = chegou mensagem nova | 'keep' = mantem a rolagem
function renderMessages(mode) {
  const box = $('#messages');
  const prevTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const f = findChannel(S.cid);
  const msgs = S.msgs[S.cid];
  const peer = S.gid === '@me' && S.dmPeer ? userById(S.dmPeer) : null;
  let html = S.more[S.cid]
    ? `<div class="older"><button class="btn sm" id="load-older">Ver mensagens antigas</button></div>`
    : peer
    ? `<div class="welcome">${avatar(peer, 'xl nodot')}<h2>${esc(peer.name)}</h2>
       <p class="muted">@${esc(peer.username)} — este é o começo da sua conversa privada.</p></div>`
    : `<div class="welcome"><div class="big-ic">${I.hash}</div><h2>Bem-vindo a #${esc(f?.c.name || '')}!</h2>
       <p class="muted">Este é o começo do canal #${esc(f?.c.name || '')}.</p></div>`;
  if (!msgs) html += `<p class="muted" style="padding:0 16px">Carregando…</p>`;
  else {
    let prev = null;
    for (const m of msgs) {
      const grouped = prev && !m.reply && !m.att && !m.sys && !prev.sys && prev.userId === m.userId && m.ts - prev.ts < 5 * 60e3;
      html += msgHtml(m, grouped);
      prev = m;
    }
  }
  box.innerHTML = html;
  if (mode === 'keep') box.scrollTop = nearBottom ? box.scrollHeight : prevTop;
  else if (!mode || nearBottom || msgs?.at(-1)?.userId === S.user?.id) box.scrollTop = box.scrollHeight;
}

// ---------- Menu da mensagem: reagir, responder, editar, copiar, excluir ----------
const curMsg = id => (S.msgs[S.cid] || []).find(m => m.id === id);
const ctx = $('#ctx');
function closeCtx() { ctx.classList.add('hidden'); ctx.innerHTML = ''; ctx.oninput = null; }
function placeCtx(x, y) {
  ctx.classList.remove('hidden');
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
const react = (m, emoji) => emit('message:react', { channelId: S.cid, id: m.id, emoji }).then(r => r.error && toast(r.error));

function openMsgMenu(m, x, y) {
  const mine = m.userId === S.user?.id;
  const canDel = mine || can(curGroup(), 'manageMessages');
  ctx.innerHTML = `<div class="quick">${QUICK.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>
    <button class="item" data-a="react">${I.smile}Adicionar reação</button>
    <div class="sep"></div>
    ${mine ? `<button class="item" data-a="edit">${I.edit}Editar mensagem</button>` : ''}
    <button class="item" data-a="reply">${I.reply}Responder</button>
    <button class="item" data-a="copy">${I.copy}Copiar texto</button>
    ${canDel ? `<div class="sep"></div><button class="item danger" data-a="del">${I.trash}Excluir mensagem</button>` : ''}`;
  ctx.onclick = e => {
    const q = e.target.closest('[data-e]'), it = e.target.closest('[data-a]');
    if (q) { closeCtx(); react(m, q.dataset.e); return; }
    if (!it) return;
    const act = it.dataset.a;
    if (act === 'react') return openEmojiPicker(x, y, e => react(m, e));
    closeCtx();
    if (act === 'edit') startEdit(m);
    if (act === 'reply') startReply(m);
    if (act === 'copy') navigator.clipboard?.writeText(m.text).then(() => toast('Texto copiado!')).catch(() => toast('Não foi possível copiar.'));
    if (act === 'del') confirmModal('Excluir mensagem?', m.text.slice(0, 140), 'Excluir', async () => {
      const r = await emit('message:delete', { channelId: S.cid, id: m.id });
      if (r.error) toast(r.error);
    });
  };
  placeCtx(x, y);
}
function openEmojiPicker(x, y, onPick) {
  const g = curGroup(), custom = g?.emojis || [];
  ctx.innerHTML = (custom.length ? `<div class="pf-h" style="padding:4px 6px">Emojis do grupo</div>
    <div class="grid">${custom.map(c => `<button data-e=":${esc(c.name)}:">${cemojiImg(g, c)}</button>`).join('')}</div><div class="sep"></div>` : '')
    + `<div class="grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
  ctx.onclick = e => { const q = e.target.closest('[data-e]'); if (q) { closeCtx(); onPick(q.dataset.e); } };
  placeCtx(x, y);
}
document.addEventListener('pointerdown', e => { if (!ctx.classList.contains('hidden') && !e.target.closest('#ctx')) closeCtx(); });

(function wireMessages() {
  const box = $('#messages');
  const msgOf = el => { const d = el.closest?.('.msg[data-id]'); return d && curMsg(d.dataset.id); };
  box.addEventListener('click', e => {
    const m = msgOf(e.target); if (!m) return;
    if (e.target.closest('.msg > .av, .msg-author')) return openProfile(m.userId, m);
    const im = e.target.closest('[data-img]');
    if (im) return openLightbox(im.dataset.img, im.dataset.name);
    const rb = e.target.closest('[data-react]'), tb = e.target.closest('[data-t]'), go = e.target.closest('[data-goto]');
    if (rb) return react(m, rb.dataset.react);
    if (go) {
      const t = box.querySelector(`.msg[data-id="${CSS.escape(go.dataset.goto)}"]`);
      if (!t) return toast('A mensagem original não está mais disponível.');
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
      return;
    }
    if (tb) {
      const r = tb.getBoundingClientRect();
      if (tb.dataset.t === 'react') openEmojiPicker(r.right - 300, r.bottom + 4, e => react(m, e));
      if (tb.dataset.t === 'reply') startReply(m);
      if (tb.dataset.t === 'more') openMsgMenu(m, r.right - 220, r.bottom + 4);
    }
  });
  box.addEventListener('contextmenu', e => {
    if (e.target.closest('a')) return;
    const m = msgOf(e.target); if (!m) return;
    e.preventDefault();
    openMsgMenu(m, e.clientX, e.clientY);
  });
  // celular: segurar o dedo na mensagem
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  box.addEventListener('touchstart', e => {
    cancel();
    if (e.target.closest('a,button')) return;
    const m = msgOf(e.target); if (!m) return;
    const t = e.touches[0];
    timer = setTimeout(() => { navigator.vibrate?.(15); openMsgMenu(m, t.clientX, t.clientY); }, 480);
  }, { passive: true });
  box.addEventListener('touchmove', cancel, { passive: true });
  box.addEventListener('touchend', cancel);
  box.addEventListener('touchcancel', cancel);
})();

function openLightbox(url, name) {
  const lb = $('#lightbox');
  lb.innerHTML = `<img src="${esc(url)}" alt=""><a href="${esc(url)}" download="${esc(name || 'imagem')}" target="_blank" rel="noopener">Baixar</a>`;
  lb.classList.remove('hidden');
  lb.onclick = e => { if (!e.target.closest('a')) lb.classList.add('hidden'); };
}

function renderComposeBar() {
  const bar = $('#compose-bar');
  if (!S.editing && !S.replyTo) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = (S.editing ? `${I.edit}<span>Editando mensagem</span>` : `${I.reply}<span>Respondendo a <b>${esc(S.replyTo.username)}</b></span>`)
    + `<button type="button" class="icon-btn" title="Cancelar">${I.x}</button>`;
  bar.querySelector('button').onclick = clearCompose;
}
function clearCompose() {
  clearAtts();
  const inp = $('#msg-input');
  if (S.editing) { inp.value = ''; inp.style.height = 'auto'; }
  S.editing = null; S.replyTo = null;
  renderComposeBar();
}
function startReply(m) { S.editing = null; S.replyTo = m; renderComposeBar(); $('#msg-input').focus(); }
function startEdit(m) {
  S.replyTo = null; S.editing = m.id; renderComposeBar();
  const inp = $('#msg-input');
  inp.value = m.text; inp.focus();
  inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
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
$('#emo-btn').innerHTML = I.smile;
$('#emo-btn').onclick = e => {
  if (input.disabled) return;
  const r = e.currentTarget.getBoundingClientRect();
  openEmojiPicker(r.right - 330, r.top - 420, em => {
    input.value += (input.value && !/\s$/.test(input.value) ? ' ' : '') + em + (em.startsWith(':') ? ' ' : '');
    autosize(); input.focus();
  });
};
// Imagens grandes são reduzidas antes de enviar, para não pesar
function shrinkImage(file) {
  return new Promise(res => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return res(null);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1920 / Math.max(img.width, img.height));
      if (k === 1 && file.size < 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); return res(null); }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => res(b && b.size < file.size ? b : null), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
function imageSize(blob) {
  return new Promise(res => {
    if (!blob.type.startsWith('image/')) return res({});
    const img = new Image(), url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); res({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); res({}); };
    img.src = url;
  });
}
async function addAttachments(files) {
  for (const f of [...files].slice(0, 5)) {
    if (S.atts.length >= 5) return toast('No máximo 5 arquivos por mensagem.');
    if (f.size > 8 * 1024 * 1024) { toast(`"${f.name}" passa de 8 MB.`); continue; }
    const it = { name: f.name || 'arquivo', mime: f.type || 'application/octet-stream', size: f.size, file: f, up: true };
    if (f.type.startsWith('image/')) it.preview = URL.createObjectURL(f);
    S.atts.push(it);
    renderAtts();
    try {
      const small = await shrinkImage(f);
      const blob = small || f;
      const { w, h } = await imageSize(blob);
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'x-token': S.token, 'x-name': encodeURIComponent(it.name), 'x-mime': small ? 'image/jpeg' : it.mime },
        body: blob,
      });
      const j = await r.json().catch(() => ({ error: 'Falha no envio.' }));
      if (!r.ok || !j.att) throw new Error(j.error || 'Falha no envio.');
      Object.assign(it, { att: { ...j.att, w, h }, up: false, size: j.att.size });
    } catch (e) {
      toast(e.message || 'Não consegui enviar o arquivo.');
      S.atts = S.atts.filter(x => x !== it);
    }
    renderAtts();
  }
}
function renderAtts() {
  const bar = $('#att-bar');
  bar.classList.toggle('hidden', !S.atts.length);
  bar.innerHTML = S.atts.map((a, i) => `<div class="att-chip ${a.up ? 'up' : ''}">
    ${a.preview ? `<img src="${a.preview}" alt="">` : `<span class="i">${I.file}</span>`}
    <span class="col"><b>${esc(a.name)}</b><span>${a.up ? 'enviando…' : fmtSize(a.size)}</span></span>
    <button type="button" data-i="${i}" title="Remover">✕</button></div>`).join('');
  bar.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
    const a = S.atts[+b.dataset.i];
    if (a?.preview) URL.revokeObjectURL(a.preview);
    S.atts.splice(+b.dataset.i, 1);
    renderAtts();
  });
}
function clearAtts() { S.atts.forEach(a => a.preview && URL.revokeObjectURL(a.preview)); S.atts = []; renderAtts(); }

$('#att-btn').innerHTML = I.paperclip;
$('#att-btn').onclick = () => { if (!input.disabled) $('#att-file').click(); };
$('#att-file').onchange = e => { addAttachments(e.target.files); e.target.value = ''; };
input.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addAttachments(files); }
});
(function wireDrop() {
  const main = document.querySelector('.main');
  let depth = 0;
  main.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); depth++; $('#app').classList.add('drop'); } });
  main.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#app').classList.remove('drop'); } });
  main.addEventListener('drop', e => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault(); depth = 0;
    $('#app').classList.remove('drop');
    if (!input.disabled && S.cid) addAttachments(e.dataTransfer.files);
  });
})();

async function sendMessage() {
  lastTypingSent = 0;
  const text = input.value.trim();
  if (!S.cid) return;
  if (S.atts.some(a => a.up)) return toast('Espere o arquivo terminar de enviar.');
  if (!text && !S.atts.length) return;
  const editing = S.editing, replyTo = S.replyTo, atts = S.atts.filter(a => a.att);
  S.editing = null; S.replyTo = null;
  input.value = ''; autosize(); renderComposeBar();
  S.atts = []; renderAtts();
  let r;
  if (editing) r = await emit('message:edit', { channelId: S.cid, id: editing, text });
  else if (atts.length) {
    // uma mensagem por arquivo; o texto vai junto com o primeiro
    for (let i = 0; i < atts.length; i++) {
      r = await emit('message:send', { channelId: S.cid, text: i ? '' : text, replyTo: i ? null : replyTo?.id, att: atts[i].att });
      if (r.error) break;
    }
    atts.forEach(a => a.preview && URL.revokeObjectURL(a.preview));
  } else r = await emit('message:send', { channelId: S.cid, text, replyTo: replyTo?.id });
  if (r.error) {
    toast(r.error);
    if (!input.value && !atts.length) { input.value = text; autosize(); S.editing = editing; S.replyTo = replyTo; renderComposeBar(); }
  }
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
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').classList.contains('hidden')) return $('#lightbox').classList.add('hidden');
  if (!ctx.classList.contains('hidden')) return closeCtx();
  if (!$('#modal').classList.contains('hidden')) return closeModal();
  if (!$('#settings').classList.contains('hidden')) return closeSettings();
  if (S.editing || S.replyTo) clearCompose();
});

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

function channelModal(g, type, cat = '') {
  modal(`<h3>Criar ${type === 'voice' ? 'sala de voz' : 'canal de texto'}</h3>
    <form id="m-ch" style="display:flex;flex-direction:column;gap:12px">
      <div class="choice">
        <label><input type="radio" name="t" value="text" ${type === 'text' ? 'checked' : ''}> ${I.hash} Texto</label>
        <label><input type="radio" name="t" value="voice" ${type === 'voice' ? 'checked' : ''}> ${I.speaker} Voz/vídeo</label>
      </div>
      <label>Nome<input id="m-cname" maxlength="32" placeholder="${type === 'voice' ? 'Ex.: Jogando' : 'Ex.: memes'}" required></label>
      ${g.categories?.length ? `<label>Categoria<select id="m-cat"><option value="">Sem categoria</option>${g.categories.map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <div class="acts"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Criar</button></div>
    </form>`, card => {
    card.querySelector('#m-ch').onsubmit = async e => {
      e.preventDefault();
      const t = card.querySelector('input[name=t]:checked').value;
      const r = await emit('channel:create', { groupId: g.id, name: card.querySelector('#m-cname').value, type: t, cat: card.querySelector('#m-cat')?.value || '' });
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
const RES = {
  '480p':  { w: 854,  h: 480,  br: 1_200_000 },
  '720p':  { w: 1280, h: 720,  br: 2_500_000 },
  '1080p': { w: 1920, h: 1080, br: 6_000_000 },
  '1440p': { w: 2560, h: 1440, br: 10_000_000 },
};
const FPS = { 15: 0.6, 30: 1, 60: 1.5 }; // fps -> multiplicador de bitrate
function curQ() {
  const res = RES[call.res] ? call.res : '1080p';
  const fps = FPS[call.fps] ? call.fps : 30;
  const r = RES[res];
  return { w: r.w, h: r.h, fps, br: Math.round(r.br * FPS[fps]), label: `${res} ${fps}fps` };
}
const call = {
  channelId: null, groupId: null, mySid: null,
  peers: new Map(),
  micTrack: null, camTrack: null, screenTrack: null, screenAudioTrack: null,
  micOn: store.get('nexo_mic') !== '0',
  facing: 'user',
  res: store.get('nexo_res') || '1080p',
  fps: Number(store.get('nexo_fps')) || 30,
  audioCtx: null, meters: new Map(), meterTimer: null,
  fmute: false, fdeaf: false, deaf: false, rejoin: null, keep: null, hadPeer: false,
  recvH: Number(store.get('nexo_recvh')) || 0,   // resolução que EU recebo (0 = automática)
  recvOverride: new Map(),                      // por pessoa, quando eu mudo só para uma

  vol: (() => { try { return JSON.parse(store.get('nexo_vol') || '{}'); } catch { return {}; } })(),
  pinned: null, wakeLock: null, joining: false,
};
const hasMedia = () => !!navigator.mediaDevices?.getUserMedia;
const NATIVE = window.NexoNative || null;   // existe quando roda dentro do app Android (APK)
const APK_LATEST = 4;                         // aumente quando publicar um APK novo
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const canShareScreen = () => !!NATIVE || !!navigator.mediaDevices?.getDisplayMedia;
const localTracks = () => [call.micTrack, call.camTrack, call.screenTrack, call.screenAudioTrack];
// O que mandar para uma pessoa: a tela só vai para quem pediu para assistir
const localTracksFor = peer => [call.micTrack, call.camTrack,
  peer.watching ? call.screenTrack : null, peer.watching ? call.screenAudioTrack : null];

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
    const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    call.micTrack = s.getAudioTracks()[0];
    call.micTrack.enabled = call.micOn;
  } catch (e) {
    toast('Não consegui acessar o microfone. Você entrou sem áudio.', 4500);
  }
  const r = await emit('voice:join', { channelId: cid, dev: deviceName() });
  call.joining = false;
  if (r.error) { toast(r.error); stopLocalTracks(); return; }
  call.channelId = cid;
  call.groupId = findChannel(cid)?.g.id;
  call.mySid = r.sid;
  call.fmute = false;
  call.pinned = null;
  $('#tiles').innerHTML = '';
  renderLocalTiles();
  sendState();
  if (call.micTrack) attachMeter('me', call.micTrack);
  startMeterLoop();
  requestWakeLock();
  startKeepAlive();
  try { NATIVE?.setInCall(true); } catch {}
  // Cada aparelho tem o próprio microfone e áudio: entrar com outro aparelho não mexe neste
  if (r.dupe) toast('Você também está nesta sala em outro aparelho. Cada aparelho tem o próprio microfone e áudio — controle cada um no quadro dele.', 7000);
  setView('voice');
  renderControls();
  renderCallbar();
  playJoinSound(true);
  // Quem chega inicia a conexao com quem ja esta na sala
  for (const p of r.peers) startAsCaller(addPeer(p));
}

// Volta para a chamada depois de uma queda de internet (comum no celular)
async function rejoinCall() {
  const cid = call.rejoin;
  call.rejoin = null;
  if (!cid || !call.channelId) return;
  const r = await emit('voice:join', { channelId: cid, dev: deviceName() });
  if (r.error) { toast('Não consegui voltar para a chamada: ' + r.error); leaveCall(); return; }
  call.mySid = r.sid;
  sendState();
  renderTiles(); renderCallbar(); renderChannels();
  for (const p of r.peers) startAsCaller(addPeer(p));
  toast('De volta à chamada.');
}

// Som inaudível que evita o celular "congelar" o app em segundo plano
function startKeepAlive() {
  stopKeepAlive();
  try {
    ensureAudioCtx();
    const ctx = call.audioCtx; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 30;
    g.gain.value = 0.0005;
    o.connect(g).connect(ctx.destination);
    o.start();
    call.keep = { o, g };
  } catch {}
}
function stopKeepAlive() {
  try { call.keep?.o.stop(); call.keep?.g.disconnect(); } catch {}
  call.keep = null;
}

function leaveCall() {
  if (!call.channelId) return;
  const was = call.channelId;
  call.rejoin = null;
  call.fmute = false;
  call.fdeaf = false;
  call.deaf = false;
  stopKeepAlive();
  S.socket?.emit('voice:leave');
  endNativeCapture();
  try { NATIVE?.setInCall(false); } catch {}
  for (const sid of [...call.peers.keys()]) removePeer(sid);
  stopLocalTracks();
  call.meters.clear();
  clearInterval(call.meterTimer); call.meterTimer = null;
  call.channelId = null; call.groupId = null; call.pinned = null; call.hadPeer = false;
  call.recvOverride.clear();
  $('#tiles').innerHTML = '';
  try { call.wakeLock?.release(); } catch {}
  call.wakeLock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderCallbar();
  if (S.view === 'voice') {
    // ligação privada: volta para a conversa daquela pessoa
    if (isDmChannel(was)) openDM(dmOther(was));
    else if (S.cid && !isDmChannel(S.cid)) openTextChannel(S.cid);
    else openDefaultChannel();
  }
  renderChannels();
  playJoinSound(false);
}

function stopLocalTracks() {
  for (const t of localTracks()) t?.stop();
  call.micTrack = call.camTrack = call.screenTrack = call.screenAudioTrack = null;
}

function deviceName() {
  const ua = navigator.userAgent;
  if (window.NexoNative || /Android/i.test(ua)) return /Tablet|SM-T|Tab/i.test(ua) ? 'Tablet' : 'Celular';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  return 'Computador';
}
// Liga/desliga o microfone ou o áudio DESTE aparelho (sem alternar às cegas)
async function setMicOn(on) { if (!!(call.micTrack && call.micOn) !== on) await toggleMic(); }
function setDeafOn(on) { if (!!call.deaf !== on) toggleDeaf(); }
// Meus outros aparelhos na mesma chamada
const myOtherDevices = () => [...call.peers.values()].filter(p => p.userId === S.user?.id);
async function controlMyDevice(peer, action) {
  const r = await emit('voice:self', { sid: peer.sid, action });
  if (r?.error) toast(r.error);
}

function sendState() {
  S.socket?.emit('voice:state', { mic: !!call.micTrack && call.micOn && !isDeaf(), cam: !!call.camTrack, screen: !!call.screenTrack, deaf: isDeaf() });
}

// ---------- Peers ----------
function addPeer(p) {
  let peer = call.peers.get(p.sid);
  if (peer) return peer;
  peer = {
    sid: p.sid, userId: p.userId, username: p.username, color: p.color, dev: p.dev || '',
    state: { mic: !!p.mic, cam: !!p.cam, screen: !!p.screen, deaf: !!p.deaf, fmute: !!p.fmute, fdeaf: !!p.fdeaf },
    chain: Promise.resolve(), caller: false,
    camStream: new MediaStream(), screenStream: new MediaStream(),
    watching: false,   // essa pessoa está assistindo a MINHA tela
    watched: false,    // EU estou assistindo a tela dessa pessoa
    wantH: 0,   // resolução que ESTE espectador me pediu (quando eu transmito)
    micAudio: makeAudioEl(), screenAudio: makeAudioEl(), micGain: null, screenGain: null,
  };
  peer.pc = createPC(peer);
  call.peers.set(p.sid, peer);
  renderPeerTiles(peer);
  return peer;
}

// ---------- Volume de cada pessoa (vale só para quem ajusta) ----------
const volOf = uid => ({ mic: 100, screen: 100, ...(call.vol[uid] || {}) });
function setVolume(uid, kind, v) {
  const cur = volOf(uid);
  cur[kind] = Math.max(0, Math.min(200, Math.round(v)));
  call.vol[uid] = cur;
  try { store.set('nexo_vol', JSON.stringify(call.vol)); } catch {}
  for (const p of call.peers.values()) if (p.userId === uid) applyVolume(p);
}
const isDeaf = () => call.deaf || call.fdeaf;
function applyVolume(peer) {
  // não tocamos o nosso próprio áudio (outro aparelho na mesma conta) para não dar eco
  const mine = peer.userId === S.user?.id;
  const v = volOf(peer.userId);
  applyOne(peer, 'mic', mine || isDeaf() ? 0 : v.mic);
  applyOne(peer, 'screen', isDeaf() ? 0 : v.screen);
}
function applyAllVolumes() { for (const p of call.peers.values()) applyVolume(p); }
function toggleDeaf() {
  if (call.fdeaf) return toast('Um moderador desativou o seu áudio nesta sala.');
  call.deaf = !call.deaf;
  if (call.deaf) { call.micOn = false; if (call.micTrack) call.micTrack.enabled = false; }
  applyAllVolumes();
  sendState(); renderControls(); renderCallbar(); renderTiles();
}
function applyOne(peer, kind, v) {
  const el = kind === 'mic' ? peer.micAudio : peer.screenAudio;
  const key = kind + 'Gain';
  if (!el) return;
  if (v > 100 && el.srcObject && call.audioCtx) {
    // acima de 100% precisamos amplificar pelo WebAudio
    try {
      if (!peer[key] || peer[key].stream !== el.srcObject) {
        try { peer[key]?.src.disconnect(); peer[key]?.g.disconnect(); } catch {}
        const src = call.audioCtx.createMediaStreamSource(el.srcObject);
        const g = call.audioCtx.createGain();
        src.connect(g).connect(call.audioCtx.destination);
        peer[key] = { src, g, stream: el.srcObject };
      }
      peer[key].g.gain.value = v / 100;
      el.muted = true;
      return;
    } catch (e) { console.warn('gain', e); }
  }
  if (peer[key]) { try { peer[key].src.disconnect(); peer[key].g.disconnect(); } catch {} peer[key] = null; }
  el.muted = false;
  el.volume = Math.max(0, Math.min(100, v)) / 100;
}

function makeAudioEl() {
  const a = document.createElement('audio');
  a.autoplay = true;
  a.playsInline = true;
  applySink(a);
  $('#audio-sink').appendChild(a);
  return a;
}

function removePeer(sid) {
  const peer = call.peers.get(sid);
  if (!peer) return;
  try { peer.pc.close(); } catch {}
  try { peer.micGain?.src.disconnect(); peer.screenGain?.src.disconnect(); } catch {}
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
      applyVolume(peer);
      playSafe(peer.micAudio);
      attachMeter(peer.sid, t);
    } else if (idx === 1) {
      swapTrack(peer.camStream, t);
    } else if (idx === 2) {
      swapTrack(peer.screenStream, t);
    } else if (idx === 3) {
      peer.screenAudio.srcObject = new MediaStream([t]);
      applyVolume(peer);
      playSafe(peer.screenAudio);
    }
    renderPeerTiles(peer);
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') { tunePeerSenders(peer); if (peer.watched) { S.socket.emit('voice:watch', { to: peer.sid, on: true }); requestQuality(peer); } }
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
  const local = localTracksFor(peer);
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
        const local = localTracksFor(peer);
        const txs = pc.getTransceivers();
        for (let i = 0; i < txs.length && i < 4; i++) {
          txs[i].direction = 'sendrecv';
          if (txs[i].sender.track !== (local[i] || null) && (local[i] || i >= 2)) await txs[i].sender.replaceTrack(local[i] || null);
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
  peer.state = { mic: !!p.mic, cam: !!p.cam, screen: !!p.screen, deaf: !!p.deaf, fmute: !!p.fmute, fdeaf: !!p.fdeaf };
  renderPeerTiles(peer);
  // a transmissão acabou: na próxima vez, a pessoa escolhe de novo se quer assistir
  if (wasScreen && !peer.state.screen) peer.watched = false;
  if (!wasScreen && peer.state.screen) toast(`${nameOf(peer.userId, peer.username)} começou a transmitir. Toque em "Assistir" para ver.`, 4500);
}

// Troca a faixa em todas as conexoes (sem renegociar)
function setTrackForAll(idx, track) {
  for (const peer of call.peers.values()) {
    const tx = peer.pc.getTransceivers()[idx];
    const t = idx >= 2 && !peer.watching ? null : track;     // tela: só para quem assiste
    if (tx && tx.sender.track !== t) tx.sender.replaceTrack(t).catch(e => console.warn('replaceTrack', e));
  }
}
// Alguém começou ou parou de assistir a minha transmissão
function onWatchRequest({ from, on }) {
  const peer = call.peers.get(from);
  if (!peer) return;
  peer.watching = !!on;
  const txs = peer.pc.getTransceivers();
  txs[2]?.sender.replaceTrack(on ? call.screenTrack : null).catch(() => {});
  txs[3]?.sender.replaceTrack(on ? call.screenAudioTrack : null).catch(() => {});
  if (on && call.screenTrack) tunePeerSenders(peer);
  renderControls();
  renderTiles();
}
// "AO VIVO" na lista da sala: abre a transmissão daquela pessoa
document.getElementById('channels').addEventListener('click', e => {
  const live = e.target.closest('.vuser .live');
  if (!live) return;
  e.stopPropagation();
  const uid = live.closest('.vuser')?.dataset.uid;
  const peer = [...call.peers.values()].find(p => p.userId === uid && p.state.screen);
  if (peer) { setView('voice'); closeDrawer(); if (!peer.watched) watchStream(peer, true); }
  else if (uid === S.user?.id) setView('voice');
  else toast('Entre na sala de voz para assistir a transmissão.');
}, true);

// Ajusta bitrate/fps para a tela ficar nitida em Full HD
async function tuneSender(sender, maxBitrate, maxFramerate, pref, scale = 1) {
  if (!sender) return;
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = maxBitrate;
    if (maxFramerate) p.encodings[0].maxFramerate = maxFramerate;
    p.encodings[0].scaleResolutionDownBy = Math.max(1, scale);
    await sender.setParameters(p);
  } catch (e) { console.warn('setParameters', e); }
  if (pref) {
    try { const p = sender.getParameters(); p.degradationPreference = pref; await sender.setParameters(p); } catch {}
  }
}
function tunePeerSenders(peer) {
  const txs = peer.pc.getTransceivers();
  const q = curQ();
  tuneSender(txs[1]?.sender, 1_500_000, 30, 'balanced');
  // Se esse espectador pediu uma resolução menor, só a conexão com ele é reduzida
  const srcH = call.screenTrack?.getSettings?.().height || q.h;
  const scale = peer.wantH && srcH > peer.wantH ? Math.min(8, srcH / peer.wantH) : 1;
  const br = Math.max(300_000, Math.round(q.br / (scale * scale)));
  tuneSender(txs[2]?.sender, br, q.fps, q.fps >= 60 ? 'maintain-framerate' : 'maintain-resolution', scale);
}

// ---------- Resolução que EU recebo de cada transmissão ----------
const RECV = [[0, 'Automática (a melhor)'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p (economizar dados)']];
const recvOf = uid => call.recvOverride.has(uid) ? call.recvOverride.get(uid) : call.recvH;
function requestQuality(peer) {
  if (!peer || !S.socket?.connected) return;
  S.socket.emit('voice:quality', { to: peer.sid, maxH: recvOf(peer.userId) });
}
function watchStream(peer, on) {
  if (!peer) return;
  peer.watched = !!on;
  S.socket?.emit('voice:watch', { to: peer.sid, on: !!on });
  const id = 't-scr-' + peer.sid;
  if (on) {
    requestQuality(peer);
    if (!call.pinned) call.pinned = id;
    playSafe(peer.screenAudio);
  } else {
    if (call.pinned === id) call.pinned = null;
    if (document.fullscreenElement?.id === id) document.exitFullscreen().catch(() => {});
  }
  renderTiles();
}

function setRecvQuality(h, uid) {
  if (uid) call.recvOverride.set(uid, h);
  else { call.recvH = h; call.recvOverride.clear(); store.set('nexo_recvh', String(h)); }
  for (const p of call.peers.values()) if (!uid || p.userId === uid) requestQuality(p);
  const label = RECV.find(r => r[0] === h)?.[1] || 'Automática';
  toast('Você vai receber em: ' + label);
  renderControls();
}

// ---------- Controles ----------
async function toggleMic() {
  if (!call.channelId) return;
  if (call.fmute && !call.micOn) return toast('Um moderador silenciou o seu microfone nesta sala.');
  if (call.fdeaf) return toast('Um moderador desativou o seu áudio nesta sala.');
  if (call.deaf && !call.micOn) { call.deaf = false; applyAllVolumes(); }
  if (!call.micTrack) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
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
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: call.facing, ...camDeviceConstraint() },
  });
  return s.getVideoTracks()[0];
}

async function toggleCam() {
  if (!call.camTrack && !callIsDm() && !can(group(call.groupId), 'video')) return toast('Você não tem permissão para usar vídeo neste grupo.');
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
  if (!callIsDm() && !can(group(call.groupId), 'video')) return toast('Você não tem permissão para transmitir a tela neste grupo.');
  if (NATIVE) return startNativeScreen();
  if (!canShareScreen()) {
    if (IS_ANDROID) apkModal('Para transmitir a tela do celular, instale o app Nexo para Android. O navegador não permite capturar a tela.');
    else toast('O iPhone não permite transmitir a tela por aqui. Transmita pelo PC ou por um Android com o app — no iPhone você assiste normalmente.', 7000);
    return;
  }
  const q = curQ();
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.w, max: q.w }, height: { ideal: q.h, max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
      // restrictOwnAudio: tira do som as vozes da chamada (o que o próprio Nexo toca)
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true, suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
      systemAudio: 'include',   // tela inteira: som do computador
      windowAudio: 'window',    // uma janela (ex.: o jogo): só o som dela
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
  call.screenAudioInfo = describeScreenAudio(vt, call.screenAudioTrack);
  // Tela inteira sem como tirar as vozes da chamada: começa sem som, para não dar eco na live
  if (call.screenAudioInfo.risky && call.screenAudioTrack) call.screenAudioTrack.enabled = false;
  setTrackForAll(2, vt);
  setTrackForAll(3, call.screenAudioTrack);
  call.peers.forEach(tunePeerSenders);
  sendState(); renderControls(); renderLocalTiles();
  toast(`Transmitindo em ${q.label}. ${call.screenAudioInfo.msg}`, 7000);
}

// Explica que som está indo para a transmissão
function describeScreenAudio(vt, at) {
  const surface = vt.getSettings?.().displaySurface || '';
  const restricted = at?.getSettings?.().restrictOwnAudio === true;
  if (!at) {
    return { kind: 'none', msg: surface === 'window'
      ? 'Sem som: este navegador não envia o som de uma janela só. Atualize o Chrome ou o Edge, ou transmita a aba.'
      : 'Sem som. Para enviar o som, marque "Compartilhar áudio" na janela de escolha.' };
  }
  if (surface === 'window') return { kind: 'window', msg: 'Indo só o som desta janela.' };
  if (surface === 'browser') return { kind: 'tab', msg: 'Indo só o som desta aba.' };
  if (restricted) return { kind: 'system', msg: 'Indo o som do computador, sem as vozes da chamada. Som de outros programas (ex.: Discord) também vai; para mandar só o do jogo, transmita a janela do jogo.' };
  return { kind: 'system', risky: true, msg: 'O som começou desligado: neste navegador, o som da tela inteira levaria as vozes da chamada junto. Transmita a janela do jogo, ou ligue o som no botão de alto-falante.' };
}
function toggleScreenAudio() {
  const at = call.screenAudioTrack;
  if (!at) return toast(call.screenAudioInfo?.msg || 'Esta transmissão não tem som.', 5000);
  at.enabled = !at.enabled;
  toast(at.enabled ? 'Som da transmissão ligado.' : 'Som da transmissão desligado.');
  renderControls();
}

// ---------- Transmissao de tela pelo app Android ----------
// O app captura a tela e entrega os quadros em JPEG; aqui eles sao desenhados
// em um canvas, e o canvas vira a faixa de video enviada na chamada.
let nativeCap = null;
function apkModal(text) {
  modal(`<h3>App Nexo para Android</h3><p class="muted" style="margin:0">${esc(text)}</p>
    <p class="muted" style="margin:0;font-size:13px">Ao abrir o arquivo, o Android pede para permitir a instalação "de fontes desconhecidas". Permita e toque em Instalar.</p>
    <div class="acts"><button class="btn" data-close>Agora não</button><a class="btn primary" href="/nexo.apk" download style="text-decoration:none">Baixar APK</a></div>`);
}
function startNativeScreen() {
  const q = curQ();
  window.__nexoScreen = ok => {
    if (ok && call.channelId && !nativeCap) beginNativeCapture();
    else if (!ok) { if (call.screenTrack) stopScreen(); else toast('Transmissão cancelada.'); }
  };
  NATIVE.startScreen(q.w, Math.min(q.fps, 30));
}
function beginNativeCapture() {
  const q = curQ(), fps = Math.min(q.fps, 30);
  const cv = document.createElement('canvas');
  cv.width = 720; cv.height = 1280;
  const cx = cv.getContext('2d');
  cx.fillRect(0, 0, cv.width, cv.height);
  const img = new Image();
  let last = 0, busy = false;
  img.onload = () => {
    if (cv.width !== img.naturalWidth || cv.height !== img.naturalHeight) { cv.width = img.naturalWidth; cv.height = img.naturalHeight; }
    cx.drawImage(img, 0, 0);
    busy = false;
  };
  img.onerror = () => { busy = false; };
  const timer = setInterval(() => {
    if (busy) return;
    let r = '';
    try { r = NATIVE.frame(last); } catch {}
    if (!r) return;
    const i = r.indexOf('|');
    last = Number(r.slice(0, i));
    busy = true;
    img.src = 'data:image/jpeg;base64,' + r.slice(i + 1);
  }, Math.round(1000 / fps));
  const vt = cv.captureStream(fps).getVideoTracks()[0];
  try { vt.contentHint = 'detail'; } catch {}
  nativeCap = { timer };
  call.screenTrack = vt;
  call.screenAudioTrack = null;
  setTrackForAll(2, vt);
  call.peers.forEach(tunePeerSenders);
  sendState(); renderControls(); renderLocalTiles();
  toast('Transmitindo a tela do celular. Pode sair do app: a transmissão continua.', 5000);
}
function endNativeCapture() {
  if (!nativeCap) return;
  clearInterval(nativeCap.timer);
  nativeCap = null;
  try { NATIVE.stopScreen(); } catch {}
}

function stopScreen() {
  if (!call.screenTrack) return;
  endNativeCapture();
  call.screenTrack.onended = null;
  call.screenTrack.stop();
  call.screenAudioTrack?.stop();
  call.screenTrack = call.screenAudioTrack = null;
  call.screenAudioInfo = null;
  setTrackForAll(2, null);
  setTrackForAll(3, null);
  if (call.pinned === 't-scr-me') call.pinned = null;
  sendState(); renderControls(); renderLocalTiles();
}

async function changeQuality(kind, v) {
  if (kind === 'res') { call.res = v; store.set('nexo_res', v); }
  else { call.fps = Number(v); store.set('nexo_fps', String(v)); }
  const q = curQ();
  if (call.screenTrack) {
    try {
      await call.screenTrack.applyConstraints({ width: { ideal: q.w, max: q.w }, height: { ideal: q.h, max: q.h }, frameRate: { ideal: q.fps, max: q.fps } });
      call.screenTrack.contentHint = q.fps >= 60 ? 'motion' : 'detail';
    } catch (e) { console.warn(e); }
    call.peers.forEach(tunePeerSenders);
    toast('Transmissão: ' + q.label);
  }
}

function renderControls() {
  const c = $('#controls');
  const micOn = !!call.micTrack && call.micOn;
  const fm = call.fmute;
  const scrOk = canShareScreen();
  c.innerHTML = `
    <button class="cbtn ${micOn ? '' : 'off'}" data-k="mic" title="${fm && !micOn ? 'Silenciado por um moderador' : micOn ? 'Silenciar' : 'Ativar microfone'}">${micOn ? I.mic : I.micOff}</button>
    <button class="cbtn ${isDeaf() ? 'off' : ''}" data-k="deaf" title="${call.fdeaf ? 'Áudio desativado por um moderador' : call.deaf ? 'Ouvir de novo' : 'Desativar o áudio'}">${isDeaf() ? I.headOff : I.head}</button>
    <button class="cbtn ${call.camTrack ? 'on' : ''}" data-k="cam" title="${call.camTrack ? 'Desligar câmera' : 'Ligar câmera'}">${call.camTrack ? I.cam : I.camOff}</button>
    ${call.camTrack && isMobile() ? `<button class="cbtn" data-k="flip" title="Trocar câmera">${I.flip}</button>` : ''}
    ${call.screenTrack ? `<button class="cbtn ${call.screenAudioTrack?.enabled ? '' : 'off'}" data-k="saudio" title="${call.screenAudioTrack ? (call.screenAudioTrack.enabled ? 'Som da transmissão: ligado (clique para desligar)' : 'Som da transmissão: desligado (clique para ligar)') : 'Esta transmissão está sem som'}">${call.screenAudioTrack?.enabled ? I.vol2 : I.volX}</button>` : ''}
    <button class="cbtn ${call.screenTrack ? 'on' : ''}" data-k="screen" title="${scrOk ? (call.screenTrack ? 'Parar transmissão' : 'Transmitir tela') : 'Transmissão de tela disponível só no PC'}" ${scrOk ? '' : 'style="opacity:.45"'}>${call.screenTrack ? I.screenOff : I.screen}</button>
    ${scrOk ? `<select class="quality" data-q="res" title="Resolução da transmissão">${Object.keys(RES).map(k => `<option value="${k}" ${k === call.res ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <select class="quality" data-q="fps" title="Quadros por segundo da transmissão">${[60, 30, 15].map(k => `<option value="${k}" ${k === call.fps ? 'selected' : ''}>${k} fps</option>`).join('')}</select>` : ''}
    ${[...call.peers.values()].some(p => p.state.screen) ? `<select class="quality" data-q="recv" title="Resolução que você recebe das transmissões (vale só para você)">${RECV.map(([h, label]) => `<option value="${h}" ${h === call.recvH ? 'selected' : ''}>${h ? 'Receber ' + label : 'Receber: automática'}</option>`).join('')}</select>` : ''}
    <button class="cbtn leave" data-k="leave" title="Sair da chamada">${I.phoneOff}</button>`;
  c.querySelector('[data-k=mic]').onclick = toggleMic;
  c.querySelector('[data-k=deaf]').onclick = toggleDeaf;
  c.querySelector('[data-k=cam]').onclick = toggleCam;
  c.querySelector('[data-k=screen]').onclick = toggleScreen;
  c.querySelector('[data-k=saudio]')?.addEventListener('click', toggleScreenAudio);
  c.querySelector('[data-k=leave]').onclick = () => leaveCall();
  c.querySelector('[data-k=flip]')?.addEventListener('click', flipCamera);
  c.querySelectorAll('.quality').forEach(el => el.addEventListener('change', e => {
    el.blur();
    if (el.dataset.q === 'recv') setRecvQuality(Number(e.target.value));
    else changeQuality(el.dataset.q, e.target.value);
  }));
}

// ---------- Blocos de video ----------
function ensureTile(id, who, isScreen) {
  let t = document.getElementById(id);
  if (t) return t;
  t = document.createElement('div');
  t.id = id;
  t.className = 'tile' + (isScreen ? ' screen' : '');
  t.dataset.uid = who.id ?? who.userId ?? '';
  t.innerHTML = `<video autoplay playsinline muted></video><div class="ph">${avatar(who, 'nodot')}</div>
    <div class="tag"><span></span></div><button class="icon-btn fs" title="Tela cheia">${I.expand}</button>
    <button class="icon-btn menu hidden" title="Opções">${I.more}</button>
    ${isScreen ? `<div class="wcard hidden"><div class="wlive">AO VIVO</div><div class="wname"></div>
      <button class="btn primary wbtn">${I.eye}Assistir</button></div>
      <button class="icon-btn wclose hidden" title="Parar de assistir">${I.x}</button>` : ''}`;
  t.onclick = e => {
    if (e.target.closest('.fs, .wclose, .wbtn')) return;
    if (t.classList.contains('unwatched')) { watchStream(t._peer, true); return; }
    call.pinned = call.pinned === id ? null : id;
    layoutTiles();
  };
  t.querySelector('.wbtn')?.addEventListener('click', e => { e.stopPropagation(); watchStream(t._peer, true); });
  t.querySelector('.wclose')?.addEventListener('click', e => { e.stopPropagation(); watchStream(t._peer, false); });
  t.querySelector('.fs').onclick = e => { e.stopPropagation(); goFullscreen(t); };
  t.querySelector('.menu').onclick = e => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    if (t._peer) openPeerMenu(t._peer, t.classList.contains('screen'), r.right - 280, r.bottom + 6);
  };
  $('#tiles').appendChild(t);
  return t;
}

// Mantem a foto do quadradinho em dia (troca de foto, cor ou nome)
function refreshTilePhoto(t) {
  const uid = t.dataset.uid;
  const u = uid === S.user?.id ? S.user : userById(uid);
  if (!u) return;
  const sig = `${u.av || 0}|${u.color}|${u.gif ? 1 : 0}|${u.name || u.username}`;
  if (t._sig === sig) return;
  t._sig = sig;
  t.querySelector('.ph').innerHTML = avatar(u, 'nodot');
  const key = t.id.startsWith('t-cam-') ? t.id.slice(6) : null;
  if (key && speakState.get(key)) animIn(t, true);
}

function setTile(t, { stream, showVideo, label, micOff, deaf, mirror, vol, peer, screen }) {
  refreshTilePhoto(t);
  const v = t.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  v.style.visibility = showVideo ? 'visible' : 'hidden';
  v.classList.toggle('mirror', !!mirror);
  t.querySelector('.ph').style.display = showVideo ? 'none' : 'flex';
  t._peer = peer || null;
  t.querySelector('.menu').classList.toggle('hidden', !peer);
  t.classList.toggle('muted-me', vol === 0);
  const volTag = peer && vol !== 100 && vol !== undefined ? `<small style="color:var(--mut)">${vol}%</small>` : '';
  t.querySelector('.tag').innerHTML = `${micOff ? I.micOff : ''}${deaf ? I.headOff : ''}<span>${esc(label)}</span>${volTag}`;
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

let _localCam2 = null;
function localCamStream2() {
  if (!call.camTrack) { _localCam2 = null; return null; }
  if (!_localCam2 || _localCam2.getVideoTracks()[0] !== call.camTrack) _localCam2 = new MediaStream([call.camTrack]);
  return _localCam2;
}

// Desenha todos os quadrinhos da chamada.
// Uma pessoa = um quadro de perfil, mesmo com vários aparelhos;
// cada transmissão de tela ganha o seu próprio quadro.
function renderTiles() {
  if (!call.channelId) return;
  const keep = new Set(['t-cam-me']);
  const me = { id: S.user.id, name: S.user.name, username: S.user.username, color: S.user.color };
  setTile(ensureTile('t-cam-me', me, false), {
    stream: localCamStream2(), showVideo: !!call.camTrack,
    label: S.user.name + (myOtherDevices().length ? ` (você · ${deviceName()})` : ' (você)'), micOff: !(call.micTrack && call.micOn), deaf: isDeaf(), mirror: call.facing === 'user',
  });
  if (call.screenTrack) {
    keep.add('t-scr-me');
    const t = ensureTile('t-scr-me', me, true);
    if (t.querySelector('video').srcObject?.getVideoTracks()[0] !== call.screenTrack)
      setTile(t, { stream: new MediaStream([call.screenTrack]), showVideo: true, label: 'Sua tela (ao vivo)' });
    const n = [...call.peers.values()].filter(p => p.watching).length;
    t.querySelector('.tag span').textContent = `Sua tela (ao vivo) · ${n === 0 ? 'ninguém assistindo' : n === 1 ? '1 assistindo' : n + ' assistindo'}`;
  }
  const byUser = new Map();
  for (const p of call.peers.values()) (byUser.get(p.userId) || byUser.set(p.userId, []).get(p.userId)).push(p);
  for (const [uid, list] of byUser) {
    const mine = uid === S.user.id;                       // outro aparelho meu
    const primary = list.find(p => p.state.cam) || list.find(p => p.state.mic) || list[0];
    if (mine) {
      // um quadro para cada aparelho meu, com os botões de microfone e áudio dele
      for (const d of list) {
        const id = 't-cam-' + d.sid;
        keep.add(id);
        const t = ensureTile(id, d, false);
        t.classList.add('mydev');
        setTile(t, {
          stream: d.camStream, showVideo: d.state.cam && d.camStream.getVideoTracks().length > 0,
          label: `Você · ${d.dev || 'outro aparelho'}`, micOff: !d.state.mic, deaf: d.state.deaf || d.state.fdeaf, peer: d,
        });
        let bar = t.querySelector('.devctl');
        if (!bar) {
          bar = document.createElement('div');
          bar.className = 'devctl';
          bar.onclick = e => {
            e.stopPropagation();
            const b = e.target.closest('button[data-act]');
            if (b && t._peer) controlMyDevice(t._peer, b.dataset.act);
          };
          t.appendChild(bar);
        }
        const micOn = d.state.mic, deaf = d.state.deaf || d.state.fdeaf;
        bar.innerHTML = `<button class="${micOn ? '' : 'off'}" data-act="${micOn ? 'mic-off' : 'mic-on'}" title="${micOn ? 'Desligar o microfone' : 'Ligar o microfone'} do ${esc(d.dev || 'outro aparelho')}">${micOn ? I.mic : I.micOff}</button>
          <button class="${deaf ? 'off' : ''}" data-act="${deaf ? 'deaf-off' : 'deaf-on'}" title="${deaf ? 'Reativar' : 'Desativar'} o áudio do ${esc(d.dev || 'outro aparelho')}">${deaf ? I.headOff : I.head}</button>`;
      }
    } else {
      const id = 't-cam-' + primary.sid;
      keep.add(id);
      const v = volOf(uid);
      setTile(ensureTile(id, primary, false), {
        stream: primary.camStream,
        showVideo: primary.state.cam && primary.camStream.getVideoTracks().length > 0,
        label: nameOf(uid, primary.username) + (list.length > 1 ? ` (${list.length} aparelhos)` : ''),
        micOff: !primary.state.mic, deaf: primary.state.deaf || primary.state.fdeaf, vol: v.mic, peer: primary,
      });
    }
    let n = 0;
    for (const p of list) {
      if (!p.state.screen) { document.getElementById('t-scr-' + p.sid)?.remove(); continue; }
      n++;
      const id = 't-scr-' + p.sid;
      keep.add(id);
      const extra = list.filter(x => x.state.screen).length > 1 ? ` (${n})` : '';
      const t = ensureTile(id, p, true);
      const who = (mine ? 'Você (outro aparelho)' : nameOf(uid, p.username)) + extra;
      setTile(t, {
        stream: p.screenStream, showVideo: p.watched && p.screenStream.getVideoTracks().length > 0,
        label: (mine ? 'Sua tela' : 'Tela de ' + nameOf(uid, p.username)) + extra,
        vol: volOf(uid).screen, peer: p, screen: true,
      });
      // não está assistindo: mostra o cartão com o botão "Assistir"
      t.classList.toggle('unwatched', !p.watched);
      t.querySelector('.wcard').classList.toggle('hidden', p.watched);
      t.querySelector('.wclose').classList.toggle('hidden', !p.watched);
      t.querySelector('.wname').textContent = `${who} está transmitindo`;
    }
  }
  for (const t of [...$('#tiles').children]) if (!keep.has(t.id)) t.remove();
  layoutTiles();
}
const renderLocalTiles = renderTiles;
const renderPeerTiles = () => renderTiles();

// Menu de uma pessoa na chamada: volume (só para mim) e moderação
function openPeerMenu(peer, isScreen, x, y) {
  const g = group(call.groupId);
  const uid = peer.userId;
  const v = volOf(uid);
  const mine = uid === S.user?.id;
  const canMute = g && can(g, 'muteMembers'), canDeaf = g && can(g, 'deafenMembers'), canMove = g && can(g, 'moveMembers'), canKick = g && can(g, 'disconnectMembers');
  const higher = g && !mine && (uid === g.ownerId || rankOf(g, S.user.id) >= rankOf(g, uid));
  const rooms = (g?.channels || []).filter(c => c.type === 'voice' && c.id !== call.channelId);
  const slider = (kind, label, val) => `<div class="vol-h">${label}</div><div class="vol">${I.vol}
    <input type="range" min="0" max="200" step="5" value="${val}" data-v="${kind}"><b data-vl="${kind}">${val}%</b></div>`;
  ctx.innerHTML = `<div class="me-card">${avatar(peer, 'sm')}<span class="col"><b>${esc(nameOf(uid, peer.username))}</b><span>${mine ? 'você, no ' + esc(peer.dev || 'outro aparelho') : '@' + esc(userById(uid)?.username || '')}</span></span></div>
    ${mine ? `<button class="item" data-self="${peer.state.mic ? 'mic-off' : 'mic-on'}">${peer.state.mic ? I.micOff : I.mic}${peer.state.mic ? 'Desligar o microfone' : 'Ligar o microfone'} do ${esc(peer.dev || 'outro aparelho')}</button>
      <button class="item" data-self="${peer.state.deaf ? 'deaf-off' : 'deaf-on'}">${peer.state.deaf ? I.head : I.headOff}${peer.state.deaf ? 'Reativar o áudio' : 'Desativar o áudio'} do ${esc(peer.dev || 'outro aparelho')}</button>` : slider('mic', 'Volume da voz', v.mic)}
    ${peer.state.screen ? slider('screen', 'Volume da transmissão', v.screen) : ''}
    ${mine ? '' : `<button class="item" data-a="mute0">${v.mic === 0 ? I.vol : I.volOff}${v.mic === 0 ? 'Ouvir de novo' : 'Silenciar para mim'}</button>`}
    <button class="item" data-a="profile">${I.users}Ver perfil</button>
    ${!higher && (canMute || canDeaf || canKick || canMove) ? '<div class="sep"></div>' : ''}
    ${!higher && canMute ? `<button class="item" data-a="${peer.state.fmute ? 'unmute' : 'fmute'}">${peer.state.fmute ? I.mic : I.micOff}${peer.state.fmute ? 'Tirar o silêncio' : 'Silenciar voz no servidor'}</button>` : ''}
    ${!higher && canDeaf ? `<button class="item" data-a="${peer.state.fdeaf ? 'undeafen' : 'deafen'}">${peer.state.fdeaf ? I.head : I.headOff}${peer.state.fdeaf ? 'Reativar o áudio' : 'Desativar áudio no servidor'}</button>` : ''}
    ${!higher && canKick ? `<button class="item danger" data-a="kick">${I.phoneOff}Desconectar da chamada</button>` : ''}
    ${peer.state.screen ? `<div class="vol-h">Qualidade que eu recebo</div>` + RECV.map(([h, label]) => `<button class="item" data-rq="${h}">${h === recvOf(uid) ? '✓' : '<i style="width:10px"></i>'} ${label}</button>`).join('') : ''}
    ${!higher && canMove && rooms.length ? `<div class="vol-h">Mover para</div>` + rooms.map(c => `<button class="item" data-move="${esc(c.id)}">${I.speaker}${esc(c.name)}</button>`).join('') : ''}`;
  ctx.oninput = e => {
    const r = e.target.closest('[data-v]');
    if (!r) return;
    const kind = r.dataset.v;
    setVolume(uid, kind, r.value);
    const lab = ctx.querySelector(`[data-vl="${kind}"]`);
    if (lab) lab.textContent = r.value + '%';
    renderTiles();
  };
  ctx.onclick = async e => {
    const rq = e.target.closest('[data-rq]');
    if (rq) { closeCtx(); setRecvQuality(Number(rq.dataset.rq), uid); return; }
    const sf = e.target.closest('[data-self]');
    if (sf) { closeCtx(); controlMyDevice(peer, sf.dataset.self); return; }
    const mv = e.target.closest('[data-move]'), it = e.target.closest('[data-a]');
    if (mv) { closeCtx(); const r = await emit('voice:force', { sid: peer.sid, action: 'move', to: mv.dataset.move }); if (r.error) toast(r.error); return; }
    if (!it) return;
    const a = it.dataset.a;
    if (a === 'mute0') {
      setVolume(uid, 'mic', v.mic === 0 ? 100 : 0);
      closeCtx(); renderTiles();
      return;
    }
    closeCtx();
    if (a === 'profile') return openProfile(uid);
    const act = a === 'fmute' ? 'mute' : a === 'unmute' ? 'unmute' : a === 'deafen' ? 'deafen' : a === 'undeafen' ? 'undeafen' : 'disconnect';
    const r = await emit('voice:force', { sid: peer.sid, action: act });
    if (r.error) toast(r.error);
  };
  placeCtx(x, y);
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
      setSpeaking(key, key === 'me' ? S.user?.id : call.peers.get(key)?.userId, !!speaking);
    }
  }, 120);
}
// Guarda quem está falando, para só mexer na tela quando muda
const speakState = new Map();
function setSpeaking(key, uid, on) {
  if (speakState.get(key) === on) return;
  speakState.set(key, on);
  const tile = document.getElementById('t-cam-' + key);
  tile?.classList.toggle('speaking', on);
  animIn(tile, on);
  if (uid) document.querySelectorAll(`.vuser[data-uid="${CSS.escape(uid)}"]`).forEach(r => animIn(r, on));
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
// Botão de amizade no cartão de perfil
// ---------------------------------------------------------------------
function friendRel(uid) {
  if (S.friends.friends.some(x => x.id === uid)) return 'friend';
  if (S.friends.in.some(x => x.id === uid)) return 'in';
  if (S.friends.out.some(x => x.id === uid)) return 'out';
  return 'none';
}
function friendBtnHtml(uid) {
  const rel = friendRel(uid);
  if (rel === 'friend') return `<button class="btn" id="pf-fr" data-rel="friend" title="Desfazer amizade">${I.userCheck} Amigos</button>`;
  if (rel === 'in') return `<button class="btn primary" id="pf-fr" data-rel="in">${I.userPlus} Aceitar pedido</button>`;
  if (rel === 'out') return `<button class="btn" id="pf-fr" data-rel="out">Pedido enviado</button>`;
  return `<button class="btn" id="pf-fr" data-rel="none" title="Adicionar amigo">${I.userPlus} Adicionar amigo</button>`;
}
function wireFriendBtn(card, uid) {
  const b = card.querySelector('#pf-fr');
  if (!b) return;
  b.onclick = async () => {
    const rel = b.dataset.rel;
    const u = userById(uid);
    let r;
    if (rel === 'none') r = await emit('friend:add', { query: u?.username || uid });
    else if (rel === 'in') r = await emit('friend:accept', { userId: uid });
    else r = await emit('friend:remove', { userId: uid });
    if (r.error) return toast(r.error);
    if (r.msg) toast(r.msg);
    else if (rel === 'in') toast('Agora vocês são amigos!');
    else if (rel !== 'none') toast('Pronto.');
    const n = card.querySelector('.acts');
    if (n) { b.outerHTML = friendBtnHtml(uid); wireFriendBtn(card, uid); }
  };
}

// ---------------------------------------------------------------------
// Ligação privada (dentro da conversa)
// ---------------------------------------------------------------------
const ring = { timer: null, channelId: null, nodes: [] };

async function startDmCall(peerId, withCam) {
  const cid = dmChannelId(peerId);
  if (call.channelId === cid) { setView('voice'); return; }
  const who = nameOf(peerId, '');
  await joinCall(cid);
  if (call.channelId !== cid) return;
  if (withCam && !call.camTrack) await toggleCam();
  const alone = call.peers.size === 0;
  toast(alone ? `Chamando ${who}…` : `Você entrou na ligação com ${who}.`);
}

// Toque de chamada (dois bipes a cada 2,5 s)
function startRing() {
  stopRingSound();
  ensureAudioCtx();
  const beep = () => {
    const ctx = call.audioCtx;
    if (!ctx) return;
    [0, 0.4].forEach(off => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + off;
      o.type = 'sine';
      o.frequency.setValueAtTime(880, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.36);
      ring.nodes.push(o);
    });
  };
  beep();
  ring.timer = setInterval(beep, 2500);
}
function stopRingSound() {
  clearInterval(ring.timer);
  ring.timer = null;
  ring.nodes.forEach(o => { try { o.stop(); } catch {} });
  ring.nodes = [];
}

function showIncoming(channelId, from) {
  cacheUser(from);
  ring.channelId = channelId;
  startRing();
  try { navigator.vibrate?.([400, 300, 400, 300, 400]); } catch {}
  modal(`<div class="ring-card">${avatar(from, 'xl')}
      <h3>${esc(from.name)}</h3>
      <p class="muted">está te ligando…</p>
      <div class="ring-acts">
        <button class="cbtn leave" id="rg-no" title="Recusar">${I.phoneOff}</button>
        <button class="cbtn answer" id="rg-yes" title="Atender">${I.phone}</button>
      </div>
      <button class="btn" id="rg-cam">Atender com vídeo</button>
    </div>`, card => {
    const answer = async cam => { stopIncoming(); closeModal(); await startDmCall(from.id, cam); };
    card.querySelector('#rg-yes').onclick = () => answer(false);
    card.querySelector('#rg-cam').onclick = () => answer(true);
    card.querySelector('#rg-no').onclick = () => { stopIncoming(); closeModal(); emit('dm:decline', { channelId }); };
  });
  // notificação do sistema, caso o app esteja em segundo plano
  try {
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(`${from.name} está te ligando`, { body: 'Toque para atender', icon: '/icons/icon-192.png', tag: 'ring' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch {}
}
function stopIncoming() {
  stopRingSound();
  ring.channelId = null;
}

// ---------------------------------------------------------------------
// Menu do próprio usuário (clique no seu nome, embaixo à esquerda)
// ---------------------------------------------------------------------
const PRESENCE_LABEL = { online: 'Disponível', idle: 'Ausente', dnd: 'Não perturbar', invisible: 'Invisível' };
function openMeMenu(anchor) {
  const u = S.user, cur = u.presence || 'online';
  ctx.innerHTML = `<div class="me-card">${avatar(u, 'sm')}<span class="col"><b>${esc(u.name)}</b><span>@${esc(u.username)}</span></span></div>
    <button class="item" data-a="profile">${I.users}Ver meu perfil</button>
    <button class="item" data-a="edit">${I.edit}Editar perfil</button>
    <div class="sep"></div>
    ${Object.entries(PRESENCE_LABEL).map(([k, v]) => `<button class="item" data-p="${k}"><i class="pres ${k === 'invisible' ? 'offline' : k}"></i>${v}${k === cur ? '<span class="sub">✓</span>' : ''}</button>`).join('')}
    <div class="sep"></div>
    <button class="item" data-a="settings">${I.gear}Configurações</button>
    <button class="item" data-a="copy">${I.copy}Copiar ID do usuário</button>
    <button class="item danger" data-a="logout">${I.logout}Sair da conta</button>`;
  ctx.onclick = async e => {
    const pr = e.target.closest('[data-p]'), it = e.target.closest('[data-a]');
    if (pr) {
      closeCtx();
      const r = await emit('profile:update', { presence: pr.dataset.p });
      if (r.error) return toast(r.error);
      S.user = r.user; renderAll();
      toast('Status: ' + PRESENCE_LABEL[pr.dataset.p]);
      return;
    }
    if (!it) return;
    closeCtx();
    const a = it.dataset.a;
    if (a === 'profile') openProfile(S.user.id);
    if (a === 'edit') editProfile();
    if (a === 'settings') openAccount();
    if (a === 'copy') navigator.clipboard?.writeText(S.user.id).then(() => toast('ID copiado!')).catch(() => toast(S.user.id));
    if (a === 'logout') confirmModal('Sair da conta?', 'Você poderá entrar de novo quando quiser.', 'Sair', logout);
  };
  const r = anchor.getBoundingClientRect();
  placeCtx(r.left, r.top - 330);
}

// ---------------------------------------------------------------------
// Perfil: ver o de qualquer pessoa e editar o seu
// ---------------------------------------------------------------------
$('#members').addEventListener('click', e => { const r = e.target.closest('[data-uid]'); if (r) openProfile(r.dataset.uid); });

function openProfile(uid, fallback) {
  const u = userById(uid) || (fallback && { id: uid, username: fallback.username, color: fallback.color, gone: true });
  if (!u) return;
  if (isMobile()) setMembers(false);
  const me = uid === S.user?.id;
  const g = curGroup();
  const on = me || !!u.online;
  let v = null;
  for (const gr of S.groups) for (const c of gr.channels) if (c.type === 'voice')
    for (const p of gr.voice?.[c.id] || []) if (p.userId === uid) v = { name: c.name, group: gr.name, screen: p.screen };
  const since = u.created ? new Date(u.created).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  modal(`<div class="pf-banner" style="background:${esc(u.banner || u.color || '#555')}"></div>
    <div class="pf-av">${avatar(u, 'xl anim')}</div>
    <h3 class="pf-name" style="color:${esc(nameColor(uid, '#e8e9ee'))}">${esc(u.name || u.username)}${g && g.ownerId === uid ? `<i class="crown" title="Dono do grupo">${I.crown}</i>` : ''}</h3>
    <div class="pf-tag">@${esc(u.username)}</div>
    ${u.status ? `<div class="pf-status">${esc(u.status)}</div>` : ''}
    ${u.gone ? '<div class="pf-status">Esta pessoa não está mais no grupo.</div>' : profileExtras(uid)}
    ${v ? `<div class="pf-box"><div class="pf-h">${v.screen ? 'Transmitindo a tela' : 'Em chamada de voz'}</div><div class="pf-voice">${v.screen ? I.screen : I.speaker} ${esc(v.name)}, em ${esc(v.group)}</div></div>` : ''}
    ${u.gone ? '' : `<div class="pf-box">
      <div class="pf-h">Sobre mim</div><div class="pf-bio">${u.bio ? linkify(u.bio) : '<span class="muted">Nada por aqui ainda.</span>'}</div>
      ${since ? `<div class="pf-h">Membro desde</div><div>${since}</div>` : ''}
      <div class="pf-h">Situação</div><div class="pres-line"><i class="pres ${presOf(u)}"></i>${presOf(u) === 'offline' ? 'Offline' : (PRESENCE_LABEL[presOf(u)] || 'Online')}</div></div>`}
    <div class="acts">${me || u.gone ? '' : friendBtnHtml(uid)}${me ? '<button class="btn primary" id="pf-edit">Editar perfil</button>' : (u.gone || !canTalkTo(uid) ? '' : '<button class="btn primary" id="pf-dm">Enviar mensagem</button>')}<button class="btn" data-close>Fechar</button></div>`,
    card => {
      const b = card.querySelector('#pf-edit'); if (b) b.onclick = editProfile;
      const d = card.querySelector('#pf-dm'); if (d) d.onclick = () => { closeModal(); openDM(uid); };
      wireFriendBtn(card, uid);
      wireProfileExtras(card);
    });
}

async function uploadBlob(blob, name, mime) {
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'x-token': S.token, 'x-name': encodeURIComponent(name || 'imagem'), 'x-mime': mime || blob.type || 'application/octet-stream' },
    body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.att) throw new Error(j.error || 'Não consegui enviar a imagem.');
  return j.att.id;
}

// Desenha o primeiro quadro da imagem (serve de "foto parada" do GIF)
function makeStill(file, square, max) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      if (square) {
        const side = Math.min(img.width, img.height);
        c.width = c.height = Math.min(max, side);
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
      } else {
        const k = Math.min(1, max / img.width);
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      }
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('img')), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}

// Prepara uma foto de perfil / ícone / capa. Aceita GIF, que fica animado.
async function prepareImage(file, { square = true, max = 256, gifMax = 3 * 1024 * 1024 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Isso não é uma imagem.');
  const gif = file.type === 'image/gif';
  if (gif && file.size > gifMax) throw new Error(`O GIF passa de ${Math.round(gifMax / 1048576)} MB. Escolha um menor.`);
  const still = await makeStill(file, square, max);
  const stillId = await uploadBlob(still, 'still.jpg', 'image/jpeg');
  const id = gif ? await uploadBlob(file, file.name || 'anim.gif', 'image/gif') : stillId;
  return { id, stillId, gif, preview: URL.createObjectURL(file) };
}


function editProfile() {
  const u = S.user;
  const PAL = ['#7c5cff', '#2fc27a', '#f5a524', '#f04f5a', '#3ba7ff', '#e05fd0', '#14b8a6', '#f97316'];
  const st = { color: u.color, banner: u.banner || u.color, avatar: undefined, img: null, busy: false };
  modal(`<h3>Editar perfil</h3>
    <div class="pe-top"><div id="pe-av">${avatar(u, 'xl')}</div>
      <div class="btns"><button type="button" class="btn primary" id="pe-pick">Trocar foto</button>
      <button type="button" class="btn" id="pe-rm">Remover foto</button>
      <span class="muted small">Pode ser GIF (até 3 MB): ele se mexe quando você fala na chamada.</span></div>
      <input type="file" id="pe-file" accept="image/*" hidden></div>
    <label>Nome exibido<input id="pe-display" maxlength="32" placeholder="${esc(u.username)}" value="${esc(u.name === u.username ? '' : u.name)}"></label>
    <p class="muted" style="margin:-8px 0 0;font-size:13px">É o nome que os outros veem. Deixe vazio para usar @${esc(u.username)}.</p>
    <label>Cor do nome<div class="swatches" id="pe-colors">${PAL.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}"></button>`).join('')}
      <input type="color" id="pe-color" value="${esc(st.color)}" title="Outra cor"></div></label>
    <label>Cor da capa<div class="swatches"><input type="color" id="pe-banner" value="${esc(st.banner)}"></div></label>
    <label>Status<input id="pe-status" maxlength="60" placeholder="Ex.: Jogando PUBG" value="${esc(u.status || '')}"></label>
    <label>Sobre mim<textarea id="pe-bio" rows="3" maxlength="190" placeholder="Conte algo sobre você">${esc(u.bio || '')}</textarea><span class="cnt" id="pe-cnt"></span></label>
    <p class="muted" style="margin:0;font-size:13px">O nome de usuário @${esc(u.username)} é o seu login e não pode ser alterado.</p>
    <div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pe-save">Salvar</button></div>`, card => {
    const q = sel => card.querySelector(sel);
    const preview = () => {
      const el = q('#pe-av .av');
      el.style.background = st.color;
      if (st.img) el.innerHTML = `<img src="${st.img.preview}" alt="">`;
      else if (st.avatar === null) el.innerHTML = initial(q('#pe-display').value || u.username);
      card.querySelectorAll('.swatch').forEach(b => b.classList.toggle('sel', b.dataset.c.toLowerCase() === st.color.toLowerCase()));
    };
    const cnt = () => { q('#pe-cnt').textContent = `${q('#pe-bio').value.length}/190`; };
    q('#pe-pick').onclick = () => q('#pe-file').click();
    q('#pe-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      st.busy = true; q('#pe-save').disabled = true;
      try {
        st.img = await prepareImage(f, { square: true, max: 256 });
        st.avatar = undefined;
        preview();
      } catch (err) { toast(err.message || 'Não consegui abrir essa imagem.'); }
      st.busy = false; q('#pe-save').disabled = false;
    };
    q('#pe-rm').onclick = () => { st.avatar = null; st.img = null; preview(); };
    q('#pe-colors').onclick = e => { const b = e.target.closest('.swatch'); if (b) { st.color = b.dataset.c; q('#pe-color').value = st.color; preview(); } };
    q('#pe-color').oninput = e => { st.color = e.target.value; preview(); };
    q('#pe-banner').oninput = e => { st.banner = e.target.value; };
    q('#pe-bio').oninput = cnt;
    q('#pe-save').onclick = async () => {
      q('#pe-save').disabled = true;
      const img = st.img ? { avatarId: st.img.id, avatarStillId: st.img.stillId, avatarGif: st.img.gif } : {};
      const r = await emit('profile:update', { display: q('#pe-display').value, color: st.color, banner: st.banner, avatar: st.img ? undefined : st.avatar, ...img, status: q('#pe-status').value, bio: q('#pe-bio').value });
      if (r.error) { q('#pe-save').disabled = false; return toast(r.error); }
      S.user = r.user;
      renderAll();
      if (S.cid && S.view === 'chat') renderMessages('keep');
      if (call.channelId) renderLocalTiles();
      toast('Perfil atualizado!');
      openProfile(S.user.id);
    };
    preview(); cnt();
  });
}

// ---------------------------------------------------------------------
// Instalar como aplicativo (PC e celular)
// ---------------------------------------------------------------------
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; renderUserbar(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; renderUserbar(); toast('Nexo instalado! Procure o ícone na sua área de trabalho.'); });
async function installApp() {
  const ev = S.installEvt;
  if (!ev) return;
  ev.prompt();
  try { await ev.userChoice; } catch {}
  S.installEvt = null; renderUserbar();
}

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
  try { NATIVE?.ready?.(); } catch {}
  // Botao "voltar" do Android: fecha o que estiver aberto antes de minimizar o app
  window.__nexoLeaveCall = () => { if (call.channelId) leaveCall(); };
  window.__nexoBack = () => {
    if (!$('#lightbox').classList.contains('hidden')) { $('#lightbox').classList.add('hidden'); return true; }
    if (!ctx.classList.contains('hidden')) { closeCtx(); return true; }
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return true; }
    if (!$('#settings').classList.contains('hidden')) { closeSettings(); return true; }
    const app = $('#app');
    if (app.classList.contains('drawer')) { closeDrawer(); return true; }
    if (isMobile() && app.classList.contains('show-members')) { setMembers(false); return true; }
    return false;
  };
  // O app Android carrega o site, entao ja abre sempre atualizado.
  // So avisa quando existe um APK mais novo (mudancas na parte nativa).
  try {
    if (NATIVE && NATIVE.version() < APK_LATEST)
      setTimeout(() => apkModal('Saiu uma versão nova do app Nexo para Android. Baixe e instale por cima da atual.'), 1500);
  } catch {}
  if (S.token) start(); else showAuth();
})();
