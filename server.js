// Nexo - servidor (Express + Socket.IO)
// Chat em tempo real, grupos, canais de texto/voz e sinalizacao WebRTC
// para chamadas de video e transmissao de tela.

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MSGS_PER_CHANNEL = 1000;

// ------------------------------------------------------------------
// Armazenamento
//   - Sem DATABASE_URL: salva em data/db.json (bom para rodar local)
//   - Com DATABASE_URL (PostgreSQL, ex.: Neon gratuito): salva no banco,
//     assim nada se perde quando o servidor na nuvem reinicia.
// ------------------------------------------------------------------
let db = { users: {}, tokens: {}, groups: {}, messages: {}, dms: {}, files: {}, friends: {}, freq: {} };
let pgPool = null;

async function loadDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pgPool.query('CREATE TABLE IF NOT EXISTS nexo_store (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
    await pgPool.query('CREATE TABLE IF NOT EXISTS nexo_files (id TEXT PRIMARY KEY, mime TEXT, name TEXT, data BYTEA)');
    const r = await pgPool.query("SELECT data FROM nexo_store WHERE id = 'main'");
    if (r.rows[0]) db = { ...db, ...r.rows[0].data };
    console.log('Banco: PostgreSQL');
  } else if (fs.existsSync(DB_FILE)) {
    try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; }
    catch (e) { console.error('Falha ao ler db.json', e); }
    console.log('Banco: arquivo local data/db.json');
  } else {
    console.log('Banco: arquivo local data/db.json (novo)');
  }
}

let saveTimer = null;
let saving = false;
let saveAgain = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
async function flush() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    const json = JSON.stringify(db);
    if (pgPool) {
      await pgPool.query(
        "INSERT INTO nexo_store (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
        [json]
      );
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE + '.tmp', json);
      fs.renameSync(DB_FILE + '.tmp', DB_FILE);
    }
  } catch (e) {
    console.error('Erro ao salvar', e);
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; save(); }
  }
}

// ------------------------------------------------------------------
// Arquivos enviados no chat (imagens e anexos)
//   - com PostgreSQL: ficam no banco (não somem quando o servidor reinicia)
//   - sem banco: ficam na pasta data/files
// ------------------------------------------------------------------
const FILES_DIR = path.join(DATA_DIR, 'files');
const MAX_FILE = 8 * 1024 * 1024;

async function putFile(id, mime, name, buf) {
  if (pgPool) await pgPool.query('INSERT INTO nexo_files (id, mime, name, data) VALUES ($1,$2,$3,$4)', [id, mime, name, buf]);
  else { fs.mkdirSync(FILES_DIR, { recursive: true }); fs.writeFileSync(path.join(FILES_DIR, id), buf); }
  db.files[id] = { mime, name, size: buf.length };
}
async function getFile(id) {
  const meta = db.files[id];
  if (!meta || !/^[a-f0-9]{16}$/.test(id)) return null;
  if (pgPool) {
    const r = await pgPool.query('SELECT data FROM nexo_files WHERE id = $1', [id]);
    return r.rows[0] ? { ...meta, buf: r.rows[0].data } : null;
  }
  const f = path.join(FILES_DIR, id);
  return fs.existsSync(f) ? { ...meta, buf: fs.readFileSync(f) } : null;
}
async function delFile(id) {
  if (!db.files[id]) return;
  delete db.files[id];
  try {
    if (pgPool) await pgPool.query('DELETE FROM nexo_files WHERE id = $1', [id]);
    else fs.unlinkSync(path.join(FILES_DIR, id));
  } catch (e) { /* ja apagado */ }
}

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const newId = () => crypto.randomBytes(8).toString('hex');
const newInvite = () => crypto.randomBytes(4).toString('hex');
const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const COLORS = ['#7c5cff', '#2fc27a', '#f5a524', '#f04f5a', '#3ba7ff', '#e05fd0', '#14b8a6', '#f97316'];

const PRESENCES = ['online', 'idle', 'dnd', 'invisible'];
function publicUser(u) {
  return { id: u.id, username: u.username, name: u.display || u.username, color: u.color,
    banner: u.banner || '', bio: u.bio || '', status: u.status || '',
    av: u.avatar ? (u.av || 1) : 0, created: u.created };
}
// "invisivel" aparece como offline para os outros
const isOnline = id => online.has(id) && (db.users[id]?.presence || 'online') !== 'invisible';
const visPresence = id => isOnline(id) ? (db.users[id].presence || 'online') : 'offline';
const memberView = u => ({ ...publicUser(u), online: isOnline(u.id), presence: visPresence(u.id) });
// ------------------------------------------------------------------
// Cargos e permissoes
// ------------------------------------------------------------------
const PERMS = ['admin', 'manageGroup', 'manageChannels', 'manageRoles', 'manageEmoji', 'kick', 'ban',
  'manageMessages', 'viewAudit', 'muteMembers', 'moveMembers', 'disconnectMembers',
  'sendMessages', 'addReactions', 'connect', 'video'];
const DEFAULT_EVERYONE = { sendMessages: true, addReactions: true, connect: true, video: true };

// Garante que grupos antigos tenham os campos novos
function ensureGroup(g) {
  g.roles ||= [];                 // do mais alto para o mais baixo
  g.everyone ||= { ...DEFAULT_EVERYONE };
  g.memberRoles ||= {};
  g.joined ||= {};
  g.bans ||= [];
  g.audit ||= [];
  g.emojis ||= [];
  g.categories ||= [];
  g.sys ||= { welcome: true, channel: null };
  g.desc ||= '';
  g.banner ||= '';
  g.created ||= Date.now();
  for (const m of g.members) g.joined[m] ||= g.created;
  return g;
}
function permsOf(g, uid) {
  const out = {};
  if (g.ownerId === uid) { for (const k of PERMS) out[k] = true; return out; }
  Object.assign(out, g.everyone);
  const mine = g.memberRoles[uid] || [];
  for (const r of g.roles) if (mine.includes(r.id)) for (const k of PERMS) if (r.perms[k]) out[k] = true;
  if (out.admin) for (const k of PERMS) out[k] = true;
  return out;
}
const can = (g, uid, p) => !!permsOf(g, uid)[p];
// Posicao na hierarquia: menor = mais alto. Dono = -1, sem cargo = fim da lista.
function rank(g, uid) {
  if (g.ownerId === uid) return -1;
  const mine = g.memberRoles[uid] || [];
  const i = g.roles.findIndex(r => mine.includes(r.id));
  return i < 0 ? g.roles.length : i;
}
function audit(g, u, text) {
  g.audit.unshift({ ts: Date.now(), by: u.username, text });
  if (g.audit.length > 200) g.audit.length = 200;
}
function sendDataUrl(res, dataUrl, cache) {
  const m = dataUrl && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', cache);
  res.send(Buffer.from(m[2], 'base64'));
}

function cleanName(s, max) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max); }

// ------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Limite simples contra tentativas de senha em massa
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 60_000);
  a.push(now);
  attempts.set(ip, a);
  return a.length > 20;
}

function issueToken(u) {
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = u.id;
  save();
  return token;
}

app.post('/api/register', (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const username = cleanName(req.body?.username, 24);
  const password = String(req.body?.password || '');
  if (!/^[\p{L}\p{N}_.\- ]{2,24}$/u.test(username))
    return res.status(400).json({ error: 'O nome deve ter de 2 a 24 caracteres (letras, números, espaço, _ . -).' });
  if (password.length < 4) return res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });
  if (Object.values(db.users).some(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Esse nome já está em uso.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id: newId(), username, salt, hash: hashPass(password, salt),
    color: COLORS[Object.keys(db.users).length % COLORS.length], created: Date.now(),
  };
  db.users[u.id] = u;
  res.json({ token: issueToken(u), user: publicUser(u) });
});

app.post('/api/login', (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const username = cleanName(req.body?.username, 24).toLowerCase();
  const password = String(req.body?.password || '');
  const u = Object.values(db.users).find(x => x.username.toLowerCase() === username);
  if (!u) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  const a = Buffer.from(hashPass(password, u.salt), 'hex');
  const b = Buffer.from(u.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  res.json({ token: issueToken(u), user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const t = String(req.body?.token || '');
  if (db.tokens[t]) { delete db.tokens[t]; save(); }
  res.json({ ok: true });
});

// Servidores STUN/TURN usados pelo WebRTC.
// TURN e necessario quando as pessoas estao em redes restritas (4G, empresas).
app.get('/api/config', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  res.json({ iceServers });
});

// Foto de perfil (guardada como data URL no banco)
app.get('/api/avatar/:id', (req, res) => {
  const u = db.users[req.params.id];
  const m = u?.avatar && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(u.avatar);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(m[2], 'base64'));
});

app.get('/api/gicon/:gid', (req, res) => sendDataUrl(res, db.groups[req.params.gid]?.icon, 'public, max-age=31536000, immutable'));
app.get('/api/emoji/:gid/:id', (req, res) => {
  const e = db.groups[req.params.gid]?.emojis?.find(x => x.id === req.params.id);
  sendDataUrl(res, e?.data, 'public, max-age=31536000, immutable');
});

// Envio de arquivo: o corpo é o arquivo puro; nome e tipo vêm nos cabeçalhos
app.post('/api/upload', express.raw({ type: '*/*', limit: MAX_FILE + 1024 }), async (req, res) => {
  const uid = db.tokens[req.get('x-token')];
  if (!uid || !db.users[uid]) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Arquivo vazio.' });
  if (buf.length > MAX_FILE) return res.status(413).json({ error: 'O arquivo passa de 8 MB.' });
  let mime = String(req.get('x-mime') || 'application/octet-stream').slice(0, 100);
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) mime = 'application/octet-stream';
  let name = '';
  try { name = decodeURIComponent(req.get('x-name') || ''); } catch { name = ''; }
  name = name.replace(/[\r\n"\\/]/g, '').trim().slice(0, 80) || 'arquivo';
  const id = newId();
  try { await putFile(id, mime, name, buf); } catch (e) { console.error(e); return res.status(500).json({ error: 'Falha ao salvar o arquivo.' }); }
  save();
  res.json({ att: { id, name, mime, size: buf.length } });
});

app.get('/api/file/:id', async (req, res) => {
  const f = await getFile(req.params.id);
  if (!f) return res.status(404).end();
  const inline = f.mime.startsWith('image/') || f.mime.startsWith('video/') || f.mime.startsWith('audio/');
  res.set('Content-Type', f.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.send(f.buf);
});

app.get('/health', (req, res) => res.send('ok'));

// ------------------------------------------------------------------
// Servidor HTTP/HTTPS
// ------------------------------------------------------------------
function createServer() {
  if (process.env.HTTPS === '1') {
    // Certificado autoassinado para testar na rede local (celular precisa de HTTPS)
    const selfsigned = require('selfsigned');
    const pems = selfsigned.generate([{ name: 'commonName', value: 'nexo.local' }], { days: 365, keySize: 2048 });
    console.log('HTTPS ativado (certificado autoassinado — aceite o aviso no navegador)');
    return https.createServer({ key: pems.private, cert: pems.cert }, app);
  }
  return http.createServer(app);
}
const server = createServer();
const io = new Server(server, { maxHttpBufferSize: 1e6 });

// ------------------------------------------------------------------
// Estado em memoria das salas de voz
//   voice: channelId -> Map(socketId -> { userId, username, color, mic, cam, screen })
// ------------------------------------------------------------------
const voice = new Map();
const online = new Map();
// Avisa grupos e conversas privadas quando alguem fica online/offline ou muda o status
function broadcastPresence(uid, exceptSocket) {
  const data = { userId: uid, online: isOnline(uid), presence: visPresence(uid) };
  const seen = new Set();
  for (const g of Object.values(db.groups)) if (g.members.includes(uid) && !seen.has(g.id)) { seen.add(g.id); (exceptSocket || io).to('g:' + g.id).emit('presence', data); }
  for (const other of db.dms[uid] || []) io.to('u:' + other).emit('presence', data);
  for (const other of db.friends[uid] || []) io.to('u:' + other).emit('presence', data);
} // userId -> numero de conexoes abertas

function findChannel(cid) {
  for (const g of Object.values(db.groups)) {
    const c = g.channels.find(ch => ch.id === cid);
    if (c) return { g, c };
  }
  return null;
}
// Tira alguem da sala de voz (usado ao desconectar pela moderacao)
function dropVoice(cid, sid) {
  const r = voice.get(cid);
  if (!r || !r.has(sid)) return;
  r.delete(sid);
  if (!r.size) voice.delete(cid);
  io.to('v:' + cid).emit('voice:peer-left', { sid });
  io.in(sid).socketsLeave('v:' + cid);
}

// Quem está numa sala de voz (serve tanto para grupo quanto para conversa privada)
function voiceRoomView(cid) {
  const r = voice.get(cid);
  return r ? [...r.entries()].map(([sid, p]) => ({ sid, ...p })) : [];
}
// Avisa quem precisa saber que a sala mudou
function notifyVoice(cid) {
  const pr = dmPeers(cid);
  if (pr) {
    const people = voiceRoomView(cid);
    for (const x of pr) io.to('u:' + x).emit('dm:voice', { channelId: cid, people });
    return;
  }
  const f = findChannel(cid);
  if (f) emitPresence(f.g);
}

function voicePresence(g) {
  const out = {};
  for (const c of g.channels) {
    if (c.type !== 'voice') continue;
    const r = voice.get(c.id);
    out[c.id] = r ? [...r.entries()].map(([sid, p]) => ({ sid, ...p })) : [];
  }
  return out;
}
function groupView(g) {
  return {
    id: g.id, name: g.name, ownerId: g.ownerId, invite: g.invite, channels: g.channels,
    desc: g.desc, banner: g.banner, iv: g.icon ? (g.iv || 1) : 0, created: g.created,
    roles: g.roles, everyone: g.everyone, memberRoles: g.memberRoles, joined: g.joined,
    categories: g.categories, sys: g.sys,
    emojis: g.emojis.map(e => ({ id: e.id, name: e.name })),
    members: g.members.map(m => db.users[m]).filter(Boolean).map(memberView),
    voice: voicePresence(g),
  };
}
// Mensagem do sistema (ex.: "Fulano entrou no grupo")
function sysMessage(g, text) {
  const c = g.channels.find(x => x.id === g.sys.channel && x.type === 'text') || g.channels.find(x => x.type === 'text');
  if (!c) return;
  const msg = { id: newId(), sys: true, text, ts: Date.now() };
  const arr = (db.messages[c.id] ||= []);
  arr.push(msg);
  if (arr.length > MAX_MSGS_PER_CHANNEL) arr.splice(0, arr.length - MAX_MSGS_PER_CHANNEL);
  io.to('g:' + g.id).emit('message', { groupId: g.id, channelId: c.id, msg });
}
// Tira alguem do grupo (saiu, foi expulso ou banido)
function removeMember(g, uid, reason) {
  g.members = g.members.filter(m => m !== uid);
  delete g.memberRoles[uid];
  delete g.joined[uid];
  for (const c of g.channels) {
    const r = voice.get(c.id);
    if (!r) continue;
    for (const [sid, p] of r) if (p.userId === uid) {
      r.delete(sid);
      io.to('v:' + c.id).emit('voice:peer-left', { sid });
      io.in(sid).socketsLeave('v:' + c.id);
    }
    if (!r.size) voice.delete(c.id);
  }
  io.in('u:' + uid).socketsLeave('g:' + g.id);
  io.to('u:' + uid).emit('group:removed', { groupId: g.id, reason });
  emitGroup(g);
}
const emitGroup = g => io.to('g:' + g.id).emit('group:update', groupView(g));
const emitPresence = g => io.to('g:' + g.id).emit('voice:presence', { groupId: g.id, voice: voicePresence(g) });

// ------------------------------------------------------------------
// Mensagens diretas (conversa privada entre duas pessoas)
//   o "canal" de uma DM tem id "d<menor>_<maior>"
// ------------------------------------------------------------------
const dmId = (a, b) => 'd' + [a, b].sort().join('_');
function dmPeers(cid) {
  if (typeof cid !== 'string' || cid[0] !== 'd' || !cid.includes('_')) return null;
  const p = cid.slice(1).split('_');
  return p.length === 2 && p.every(x => db.users[x]) ? p : null;
}
// Onde a mensagem vive: um canal de grupo ou uma conversa privada
function channelCtx(cid, uid) {
  const p = dmPeers(cid);
  if (p) return p.includes(uid) ? { dm: true, peers: p, other: p.find(x => x !== uid) || uid } : null;
  const f = findChannel(cid);
  return f && f.g.members.includes(uid) ? { g: f.g, c: f.c } : null;
}
function emitCtx(ctx, ev, payload) {
  if (ctx.dm) for (const p of ctx.peers) io.to('u:' + p).emit(ev, payload);
  else io.to('g:' + ctx.g.id).emit(ev, payload);
}
// Garante que a conversa apareça na lista dos dois
function linkDm(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const l = (db.dms[x] ||= []);
    if (!l.includes(y)) l.push(y);
  }
}
function dmEntry(uid, other) {
  const u = db.users[other];
  if (!u) return null;
  const inCall = voiceRoomView(dmId(uid, other)).length > 0;
  const msgs = db.messages[dmId(uid, other)] || [];
  const last = msgs[msgs.length - 1];
  return { user: memberView(u), inCall, last: last ? { text: last.text, ts: last.ts, mine: last.userId === uid, att: !!last.att } : null };
}

// ------------------------------------------------------------------
// Amigos
// ------------------------------------------------------------------
const friendsOf = id => (db.friends[id] ||= []);
const freqOf = id => (db.freq[id] ||= { in: [], out: [] });
const areFriends = (a, b) => friendsOf(a).includes(b);
function friendState(uid) {
  const f = freqOf(uid);
  const u = id => db.users[id] && memberView(db.users[id]);
  return {
    friends: friendsOf(uid).map(u).filter(Boolean),
    in: f.in.map(u).filter(Boolean),
    out: f.out.map(u).filter(Boolean),
  };
}
const pushFriends = uid => io.to('u:' + uid).emit('friends', friendState(uid));

io.use((socket, next) => {
  const uid = db.tokens[socket.handshake.auth?.token];
  const u = uid && db.users[uid];
  if (!u) return next(new Error('auth'));
  socket.user = u;
  next();
});

io.on('connection', socket => {
  const u = socket.user;
  const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };
  socket.join('u:' + u.id);
  const mine = Object.values(db.groups).filter(g => g.members.includes(u.id));
  mine.forEach(g => socket.join('g:' + g.id));
  online.set(u.id, (online.get(u.id) || 0) + 1);
  if (online.get(u.id) === 1) broadcastPresence(u.id, socket);
  socket.emit('init', {
    user: { ...publicUser(u), presence: u.presence || 'online' },
    groups: mine.map(groupView),
    dms: (db.dms[u.id] || []).map(o => dmEntry(u.id, o)).filter(Boolean),
    friends: friendState(u.id),
  });

  // ---------- Perfil ----------
  socket.on('profile:update', (d = {}, cb) => {
    if (typeof d.display === 'string') {
      const n = cleanName(d.display, 32);
      if (d.display.trim() && n.length < 2) return reply(cb, { error: 'O nome exibido precisa ter ao menos 2 caracteres.' });
      if (n) u.display = n; else delete u.display;
    }
    if (PRESENCES.includes(d.presence)) {
      const was = visPresence(u.id);
      u.presence = d.presence;
      if (visPresence(u.id) !== was) broadcastPresence(u.id);
    }
    const hex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    if (hex(d.color)) u.color = d.color;
    if (hex(d.banner)) u.banner = d.banner;
    if (typeof d.bio === 'string') u.bio = d.bio.trim().slice(0, 190);
    if (typeof d.status === 'string') u.status = cleanName(d.status, 60);
    if (d.avatar === null) { delete u.avatar; }
    else if (typeof d.avatar === 'string') {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.avatar) || d.avatar.length > 90000)
        return reply(cb, { error: 'Imagem inválida ou grande demais.' });
      u.avatar = d.avatar;
      u.av = (u.av || 0) + 1;
    }
    save();
    io.to('u:' + u.id).emit('profile:me', { ...publicUser(u), presence: u.presence || 'online' });
    for (const g of Object.values(db.groups)) if (g.members.includes(u.id)) emitGroup(g);
    for (const other of db.dms[u.id] || []) io.to('u:' + other).emit('dm:update', { entry: dmEntry(other, u.id) });
    for (const other of db.friends[u.id] || []) pushFriends(other);
    reply(cb, { user: { ...publicUser(u), presence: u.presence || 'online' } });
  });

  // ---------- Grupos ----------
  socket.on('group:create', ({ name } = {}, cb) => {
    name = cleanName(name, 40);
    if (name.length < 1) return reply(cb, { error: 'Dê um nome ao grupo.' });
    const g = {
      id: newId(), name, ownerId: u.id, invite: newInvite(), members: [u.id], created: Date.now(),
      channels: [
        { id: newId(), name: 'geral', type: 'text' },
        { id: newId(), name: 'Sala de voz', type: 'voice' },
      ],
    };
    ensureGroup(g);
    g.joined[u.id] = Date.now();
    db.groups[g.id] = g;
    save();
    io.in('u:' + u.id).socketsJoin('g:' + g.id);
    emitGroup(g);
    reply(cb, { group: groupView(g) });
  });

  socket.on('group:join', ({ invite } = {}, cb) => {
    invite = String(invite || '').trim().toLowerCase().replace(/^.*convite=/, '');
    const g = Object.values(db.groups).find(x => x.invite === invite);
    if (!g) return reply(cb, { error: 'Convite inválido.' });
    if (g.bans.some(b => b.id === u.id)) return reply(cb, { error: 'Você foi banido deste grupo.' });
    if (!g.members.includes(u.id)) {
      g.members.push(u.id);
      g.joined[u.id] = Date.now();
      if (g.sys.welcome) sysMessage(g, `${u.username} entrou no grupo. Boas-vindas! 👋`);
      save();
    }
    io.in('u:' + u.id).socketsJoin('g:' + g.id);
    emitGroup(g);
    reply(cb, { group: groupView(g) });
  });

  socket.on('group:leave', ({ groupId } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || !g.members.includes(u.id)) return reply(cb, { error: 'Grupo não encontrado.' });
    if (g.ownerId === u.id) {
      // Dono saindo = apaga o grupo
      io.to('g:' + g.id).emit('group:removed', { groupId: g.id });
      io.in('g:' + g.id).socketsLeave('g:' + g.id);
      for (const c of g.channels) delete db.messages[c.id];
      delete db.groups[g.id];
    } else {
      removeMember(g, u.id);
    }
    save();
    reply(cb, { ok: true });
  });

  // ---------- Amigos ----------
  socket.on('friend:add', ({ query } = {}, cb) => {
    const q = String(query || '').trim().replace(/^@/, '').toLowerCase();
    if (!q) return reply(cb, { error: 'Digite o nome de usuário.' });
    const other = Object.values(db.users).find(x => x.username.toLowerCase() === q || x.id === q);
    if (!other) return reply(cb, { error: 'Não achei ninguém com esse nome de usuário.' });
    if (other.id === u.id) return reply(cb, { error: 'Esse é você. 🙂' });
    if (areFriends(u.id, other.id)) return reply(cb, { error: `Você e ${other.display || other.username} já são amigos.` });
    const mine = freqOf(u.id), theirs = freqOf(other.id);
    if (mine.in.includes(other.id)) {   // ja tinha pedido deles: vira amizade na hora
      mine.in = mine.in.filter(x => x !== other.id);
      theirs.out = theirs.out.filter(x => x !== u.id);
      friendsOf(u.id).push(other.id);
      friendsOf(other.id).push(u.id);
      save(); pushFriends(u.id); pushFriends(other.id);
      return reply(cb, { ok: true, msg: `Agora vocês são amigos!` });
    }
    if (mine.out.includes(other.id)) return reply(cb, { error: 'Você já enviou um pedido para essa pessoa.' });
    if (mine.out.length >= 200) return reply(cb, { error: 'Muitos pedidos pendentes.' });
    mine.out.push(other.id);
    theirs.in.push(u.id);
    save(); pushFriends(u.id); pushFriends(other.id);
    reply(cb, { ok: true, msg: `Pedido enviado para ${other.display || other.username}.` });
  });

  socket.on('friend:accept', ({ userId } = {}, cb) => {
    const mine = freqOf(u.id), theirs = freqOf(userId);
    if (!mine.in.includes(userId)) return reply(cb, { error: 'Pedido não encontrado.' });
    mine.in = mine.in.filter(x => x !== userId);
    theirs.out = theirs.out.filter(x => x !== u.id);
    if (!areFriends(u.id, userId)) { friendsOf(u.id).push(userId); friendsOf(userId).push(u.id); }
    save(); pushFriends(u.id); pushFriends(userId);
    reply(cb, { ok: true });
  });

  // recusar um pedido recebido, cancelar um enviado ou desfazer a amizade
  socket.on('friend:remove', ({ userId } = {}, cb) => {
    const mine = freqOf(u.id), theirs = freqOf(userId);
    mine.in = mine.in.filter(x => x !== userId);
    mine.out = mine.out.filter(x => x !== userId);
    theirs.in = theirs.in.filter(x => x !== u.id);
    theirs.out = theirs.out.filter(x => x !== u.id);
    db.friends[u.id] = friendsOf(u.id).filter(x => x !== userId);
    db.friends[userId] = friendsOf(userId).filter(x => x !== u.id);
    save(); pushFriends(u.id); pushFriends(userId);
    reply(cb, { ok: true });
  });

  // ---------- Mensagens diretas ----------
  socket.on('dm:open', ({ userId } = {}, cb) => {
    const other = db.users[userId];
    if (!other || userId === u.id) return reply(cb, { error: 'Pessoa não encontrada.' });
    linkDm(u.id, userId);
    save();
    io.to('u:' + userId).emit('dm:update', { entry: dmEntry(userId, u.id) });
    reply(cb, { channelId: dmId(u.id, userId), user: memberView(other), inCall: voiceRoomView(dmId(u.id, userId)).length > 0, messages: (db.messages[dmId(u.id, userId)] || []).slice(-150) });
  });

  socket.on('dm:close', ({ userId } = {}, cb) => {
    db.dms[u.id] = (db.dms[u.id] || []).filter(x => x !== userId);
    save();
    reply(cb, { ok: true });
  });

  socket.on('user:find', ({ query } = {}, cb) => {
    const q = cleanName(query, 24).toLowerCase();
    if (q.length < 2) return reply(cb, { users: [] });
    const out = Object.values(db.users)
      .filter(x => x.id !== u.id && (x.username.toLowerCase().includes(q) || (x.display || '').toLowerCase().includes(q)))
      .slice(0, 12).map(memberView);
    reply(cb, { users: out });
  });

  // ---------- Configuracoes do grupo ----------
  const DENY = { error: 'Você não tem permissão para isso.' };
  const G = (groupId, perm) => {
    const g = db.groups[groupId];
    return g && g.members.includes(u.id) && (!perm || can(g, u.id, perm)) ? g : null;
  };
  const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  const isImg = (v, max) => typeof v === 'string' && v.length <= max && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
  const done = (g, cb, extra) => { save(); emitGroup(g); reply(cb, { ok: true, ...extra }); };
  // quem a pessoa pode moderar: nunca o dono, nunca a si mesma, so quem esta abaixo
  const outranks = (g, target) => target !== u.id && target !== g.ownerId && g.members.includes(target) && rank(g, u.id) < rank(g, target);

  socket.on('group:edit', (d = {}, cb) => {
    const g = G(d.groupId, 'manageGroup'); if (!g) return reply(cb, DENY);
    if (typeof d.name === 'string') {
      const n = cleanName(d.name, 40);
      if (!n) return reply(cb, { error: 'Dê um nome ao grupo.' });
      g.name = n;
    }
    if (typeof d.desc === 'string') g.desc = d.desc.trim().slice(0, 300);
    if (d.banner === '' || isHex(d.banner)) g.banner = d.banner;
    if (d.icon === null) delete g.icon;
    else if (d.icon !== undefined) {
      if (!isImg(d.icon, 90000)) return reply(cb, { error: 'Imagem inválida ou grande demais.' });
      g.icon = d.icon; g.iv = (g.iv || 0) + 1;
    }
    audit(g, u, 'atualizou o perfil do grupo');
    done(g, cb);
  });

  socket.on('group:sys', ({ groupId, welcome, channel } = {}, cb) => {
    const g = G(groupId, 'manageGroup'); if (!g) return reply(cb, DENY);
    if (typeof welcome === 'boolean') g.sys.welcome = welcome;
    if (channel !== undefined) g.sys.channel = g.channels.some(c => c.id === channel && c.type === 'text') ? channel : null;
    audit(g, u, 'alterou as mensagens do sistema');
    done(g, cb);
  });

  socket.on('invite:reset', ({ groupId } = {}, cb) => {
    const g = G(groupId, 'manageGroup'); if (!g) return reply(cb, DENY);
    g.invite = newInvite();
    audit(g, u, 'gerou um novo convite (o antigo parou de funcionar)');
    done(g, cb);
  });

  socket.on('category:create', ({ groupId, name } = {}, cb) => {
    const g = G(groupId, 'manageChannels'); if (!g) return reply(cb, DENY);
    name = cleanName(name, 32);
    if (!name) return reply(cb, { error: 'Dê um nome à categoria.' });
    if (g.categories.length >= 20) return reply(cb, { error: 'Limite de categorias atingido.' });
    g.categories.push({ id: newId(), name });
    audit(g, u, `criou a categoria ${name}`);
    done(g, cb);
  });

  socket.on('category:delete', ({ groupId, id } = {}, cb) => {
    const g = G(groupId, 'manageChannels'); if (!g) return reply(cb, DENY);
    const c = g.categories.find(x => x.id === id); if (!c) return reply(cb, { error: 'Categoria não encontrada.' });
    g.categories = g.categories.filter(x => x.id !== id);
    for (const ch of g.channels) if (ch.cat === id) delete ch.cat; // os canais continuam, sem categoria
    audit(g, u, `excluiu a categoria ${c.name}`);
    done(g, cb);
  });

  // ---------- Cargos ----------
  socket.on('role:create', ({ groupId } = {}, cb) => {
    const g = G(groupId, 'manageRoles'); if (!g) return reply(cb, DENY);
    if (g.roles.length >= 50) return reply(cb, { error: 'Limite de cargos atingido.' });
    const r = { id: newId(), name: 'novo cargo', color: '', perms: {} };
    g.roles.push(r);
    audit(g, u, 'criou um cargo');
    done(g, cb, { role: r });
  });

  socket.on('role:edit', ({ groupId, id, name, color, perms } = {}, cb) => {
    const g = G(groupId, 'manageRoles'); if (!g) return reply(cb, DENY);
    const mine = permsOf(g, u.id);
    // so da para ligar/desligar permissoes que voce mesmo tem
    const merge = old => {
      const out = {};
      for (const k of PERMS) if (mine[k] ? perms?.[k] === true : old[k]) out[k] = true;
      return out;
    };
    if (id === '@everyone') {
      if (perms) { g.everyone = merge(g.everyone); delete g.everyone.admin; }
      audit(g, u, 'alterou as permissões padrão (@everyone)');
      return done(g, cb);
    }
    const i = g.roles.findIndex(r => r.id === id);
    if (i < 0) return reply(cb, { error: 'Cargo não encontrado.' });
    if (rank(g, u.id) >= i) return reply(cb, { error: 'Esse cargo está no mesmo nível ou acima do seu.' });
    const r = g.roles[i];
    if (typeof name === 'string' && cleanName(name, 32)) r.name = cleanName(name, 32);
    if (color === '' || isHex(color)) r.color = color;
    if (perms) r.perms = merge(r.perms);
    audit(g, u, `editou o cargo ${r.name}`);
    done(g, cb);
  });

  socket.on('role:delete', ({ groupId, id } = {}, cb) => {
    const g = G(groupId, 'manageRoles'); if (!g) return reply(cb, DENY);
    const i = g.roles.findIndex(r => r.id === id);
    if (i < 0) return reply(cb, { error: 'Cargo não encontrado.' });
    if (rank(g, u.id) >= i) return reply(cb, { error: 'Esse cargo está no mesmo nível ou acima do seu.' });
    audit(g, u, `excluiu o cargo ${g.roles[i].name}`);
    g.roles.splice(i, 1);
    for (const k of Object.keys(g.memberRoles)) g.memberRoles[k] = g.memberRoles[k].filter(x => x !== id);
    done(g, cb);
  });

  socket.on('role:move', ({ groupId, id, dir } = {}, cb) => {
    const g = G(groupId, 'manageRoles'); if (!g) return reply(cb, DENY);
    const i = g.roles.findIndex(r => r.id === id), j = i + (dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= g.roles.length) return reply(cb, { error: 'Não dá para mover.' });
    const me = rank(g, u.id);
    if (me >= i || me >= j) return reply(cb, { error: 'Você só pode reordenar cargos abaixo do seu.' });
    [g.roles[i], g.roles[j]] = [g.roles[j], g.roles[i]];
    done(g, cb);
  });

  // ---------- Membros ----------
  socket.on('member:roles', ({ groupId, userId, roles } = {}, cb) => {
    const g = G(groupId, 'manageRoles'); if (!g) return reply(cb, DENY);
    if (!g.members.includes(userId) || !Array.isArray(roles)) return reply(cb, { error: 'Membro não encontrado.' });
    const me = rank(g, u.id);
    const mine = new Set(g.roles.filter((r, i) => i > me).map(r => r.id)); // cargos que eu posso dar/tirar
    const cur = g.memberRoles[userId] || [];
    g.memberRoles[userId] = [...cur.filter(id => !mine.has(id)), ...roles.filter(id => mine.has(id))];
    audit(g, u, `alterou os cargos de ${db.users[userId]?.username || '?'}`);
    done(g, cb);
  });

  socket.on('member:kick', ({ groupId, userId } = {}, cb) => {
    const g = G(groupId, 'kick'); if (!g) return reply(cb, DENY);
    if (!outranks(g, userId)) return reply(cb, { error: 'Você não pode expulsar essa pessoa.' });
    audit(g, u, `expulsou ${db.users[userId]?.username || '?'}`);
    removeMember(g, userId, `Você foi expulso de "${g.name}".`);
    save();
    reply(cb, { ok: true });
  });

  socket.on('member:ban', ({ groupId, userId } = {}, cb) => {
    const g = G(groupId, 'ban'); if (!g) return reply(cb, DENY);
    if (!outranks(g, userId)) return reply(cb, { error: 'Você não pode banir essa pessoa.' });
    const name = db.users[userId]?.username || '?';
    g.bans.push({ id: userId, username: name, by: u.username, ts: Date.now() });
    audit(g, u, `baniu ${name}`);
    removeMember(g, userId, `Você foi banido de "${g.name}".`);
    save();
    reply(cb, { ok: true });
  });

  socket.on('ban:remove', ({ groupId, userId } = {}, cb) => {
    const g = G(groupId, 'ban'); if (!g) return reply(cb, DENY);
    const b = g.bans.find(x => x.id === userId);
    if (!b) return reply(cb, { error: 'Banimento não encontrado.' });
    g.bans = g.bans.filter(x => x.id !== userId);
    audit(g, u, `removeu o banimento de ${b.username}`);
    save();
    reply(cb, { ok: true, bans: g.bans });
  });

  socket.on('group:bans', ({ groupId } = {}, cb) => {
    const g = G(groupId, 'ban'); if (!g) return reply(cb, DENY);
    reply(cb, { bans: g.bans });
  });

  socket.on('group:audit', ({ groupId } = {}, cb) => {
    const g = G(groupId, 'viewAudit'); if (!g) return reply(cb, DENY);
    reply(cb, { audit: g.audit });
  });

  // ---------- Emojis do grupo ----------
  socket.on('emoji:add', ({ groupId, name, data } = {}, cb) => {
    const g = G(groupId, 'manageEmoji'); if (!g) return reply(cb, DENY);
    if (g.emojis.length >= 50) return reply(cb, { error: 'Limite de 50 emojis atingido.' });
    if (!isImg(data, 70000)) return reply(cb, { error: 'Imagem inválida ou grande demais.' });
    let base = String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (base.length < 2) base = 'emoji';
    let n = base, k = 2;
    while (g.emojis.some(e => e.name === n)) n = base + (k++);
    g.emojis.push({ id: newId(), name: n, data, by: u.id });
    audit(g, u, `adicionou o emoji :${n}:`);
    done(g, cb);
  });

  socket.on('emoji:delete', ({ groupId, id } = {}, cb) => {
    const g = G(groupId, 'manageEmoji'); if (!g) return reply(cb, DENY);
    const e = g.emojis.find(x => x.id === id);
    if (!e) return reply(cb, { error: 'Emoji não encontrado.' });
    g.emojis = g.emojis.filter(x => x.id !== id);
    audit(g, u, `removeu o emoji :${e.name}:`);
    done(g, cb);
  });

  // ---------- Canais ----------
  socket.on('channel:create', ({ groupId, name, type, cat } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || !g.members.includes(u.id) || !can(g, u.id, 'manageChannels')) return reply(cb, { error: 'Você não tem permissão para criar canais.' });
    type = type === 'voice' ? 'voice' : 'text';
    name = cleanName(name, 32);
    if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (!name) return reply(cb, { error: 'Dê um nome ao canal.' });
    if (g.channels.length >= 50) return reply(cb, { error: 'Limite de canais atingido.' });
    const c = { id: newId(), name, type };
    if (g.categories.some(x => x.id === cat)) c.cat = cat;
    audit(g, u, `criou o canal ${type === 'voice' ? '🔊' : '#'}${name}`);
    g.channels.push(c);
    save();
    emitGroup(g);
    reply(cb, { channel: c });
  });

  socket.on('channel:delete', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id) || !can(f.g, u.id, 'manageChannels')) return reply(cb, { error: 'Sem permissão.' });
    if (f.g.channels.length <= 1) return reply(cb, { error: 'O grupo precisa ter pelo menos um canal.' });
    audit(f.g, u, `excluiu o canal ${f.c.name}`);
    f.g.channels = f.g.channels.filter(c => c.id !== channelId);
    if (f.g.sys.channel === channelId) f.g.sys.channel = null;
    delete db.messages[channelId];
    save();
    emitGroup(f.g);
    reply(cb, { ok: true });
  });

  socket.on('channel:move', ({ groupId, channelId, cat, before } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || !g.members.includes(u.id) || !can(g, u.id, 'manageChannels')) return reply(cb, { error: 'Você não tem permissão para mover canais.' });
    const i = g.channels.findIndex(c => c.id === channelId);
    if (i < 0) return reply(cb, { error: 'Canal não encontrado.' });
    const c = g.channels[i];
    g.channels.splice(i, 1);
    if (cat && g.categories.some(x => x.id === cat)) c.cat = cat; else delete c.cat;
    const j = before ? g.channels.findIndex(x => x.id === before) : -1;
    if (j < 0) g.channels.push(c); else g.channels.splice(j, 0, c);
    save();
    emitGroup(g);
    reply(cb, { ok: true });
  });

  // ---------- Mensagens ----------
  socket.on('channel:history', ({ channelId } = {}, cb) => {
    if (!channelCtx(channelId, u.id)) return reply(cb, { error: 'Canal não encontrado.' });
    reply(cb, { messages: (db.messages[channelId] || []).slice(-150) });
  });

  let lastMsgs = [];
  socket.on('message:send', ({ channelId, text, replyTo, att } = {}, cb) => {
    const ctx = channelCtx(channelId, u.id);
    if (!ctx || (ctx.c && ctx.c.type !== 'text')) return reply(cb, { error: 'Canal não encontrado.' });
    text = String(text || '').trim().slice(0, 2000);
    const file = att && db.files[att.id] ? { id: att.id, ...db.files[att.id] } : null;
    if (att && !file) return reply(cb, { error: 'O arquivo não foi encontrado. Tente enviar de novo.' });
    if (!text && !file) return reply(cb, { error: 'Mensagem vazia.' });
    if (ctx.g && !can(ctx.g, u.id, 'sendMessages')) return reply(cb, { error: 'Você não tem permissão para enviar mensagens.' });
    const now = Date.now();
    lastMsgs = lastMsgs.filter(t => now - t < 5000);
    if (lastMsgs.length >= 8) return reply(cb, { error: 'Calma! Você está enviando rápido demais.' });
    lastMsgs.push(now);
    const arr = (db.messages[channelId] ||= []);
    const msg = { id: newId(), userId: u.id, username: u.username, color: u.color, text, ts: now };
    if (replyTo) {
      const r = arr.find(m => m.id === replyTo);
      if (r) msg.reply = { id: r.id, username: r.username, color: r.color, text: (r.text || '📎 ' + (r.att?.name || 'arquivo')).slice(0, 120) };
    }
    if (file) {
      msg.att = { id: file.id, name: file.name, mime: file.mime, size: file.size };
      if (Number.isFinite(att.w) && Number.isFinite(att.h)) { msg.att.w = Math.round(att.w); msg.att.h = Math.round(att.h); }
    }
    arr.push(msg);
    if (arr.length > MAX_MSGS_PER_CHANNEL) arr.splice(0, arr.length - MAX_MSGS_PER_CHANNEL);
    if (ctx.dm) linkDm(...ctx.peers);
    save();
    emitCtx(ctx, 'message', { groupId: ctx.g?.id, channelId, msg, dm: !!ctx.dm });
    if (ctx.dm) for (const p of ctx.peers) io.to('u:' + p).emit('dm:update', { entry: dmEntry(p, p === u.id ? ctx.other : u.id) });
    reply(cb, { ok: true });
  });

  // ---------- Editar / excluir / reagir ----------
  function locate(channelId, id) {
    const ctx = channelCtx(channelId, u.id);
    if (!ctx) return null;
    const arr = db.messages[channelId] || [];
    const m = arr.find(x => x.id === id);
    return m ? { ctx, g: ctx.g, arr, m } : null;
  }

  socket.on('message:edit', ({ channelId, id, text } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (l.m.userId !== u.id) return reply(cb, { error: 'Você só pode editar as suas mensagens.' });
    text = String(text || '').trim().slice(0, 2000);
    if (!text && !l.m.att) return reply(cb, { error: 'Mensagem vazia.' });
    l.m.text = text;
    l.m.edited = true;
    save();
    emitCtx(l.ctx, 'message:edit', { channelId, id, text });
    reply(cb, { ok: true });
  });

  socket.on('message:delete', ({ channelId, id } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (l.m.userId !== u.id && !(l.g && can(l.g, u.id, 'manageMessages'))) return reply(cb, { error: 'Sem permissão.' });
    if (l.m.userId !== u.id && l.g) audit(l.g, u, `excluiu uma mensagem de ${l.m.username || 'sistema'}`);
    l.arr.splice(l.arr.indexOf(l.m), 1);
    if (l.m.att) delFile(l.m.att.id);
    save();
    emitCtx(l.ctx, 'message:delete', { channelId, id });
    reply(cb, { ok: true });
  });

  socket.on('message:react', ({ channelId, id, emoji } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    emoji = String(emoji || '').trim();
    if (l.g && !can(l.g, u.id, 'addReactions')) return reply(cb, { error: 'Você não tem permissão para reagir.' });
    if (!emoji || emoji.length > 30 || /[\s<>&"']/.test(emoji)) return reply(cb, { error: 'Reação inválida.' });
    const rs = (l.m.reactions ||= {});
    const list = rs[emoji] || [];
    const i = list.indexOf(u.id);
    if (i >= 0) list.splice(i, 1);
    else {
      if (!rs[emoji] && Object.keys(rs).length >= 20) return reply(cb, { error: 'Limite de reações atingido.' });
      list.push(u.id);
    }
    if (list.length) rs[emoji] = list; else delete rs[emoji];
    save();
    emitCtx(l.ctx, 'message:react', { channelId, id, reactions: rs });
    reply(cb, { ok: true });
  });

  // ---------- Voz / video (sinalizacao WebRTC) ----------
  let currentVoice = null;

  function leaveVoice() {
    if (!currentVoice) return;
    const cid = currentVoice;
    currentVoice = null;
    const r = voice.get(cid);
    if (r) { r.delete(socket.id); if (!r.size) voice.delete(cid); }
    socket.to('v:' + cid).emit('voice:peer-left', { sid: socket.id });
    socket.leave('v:' + cid);
    const pr = dmPeers(cid);
    // se quem estava chamando desistiu, para de tocar do outro lado
    if (pr && !voice.get(cid)) for (const x of pr) io.to('u:' + x).emit('dm:ring-stop', { channelId: cid });
    notifyVoice(cid);
  }

  socket.on('voice:join', ({ channelId } = {}, cb) => {
    const pr = dmPeers(channelId);
    let f = null;
    if (pr) {
      if (!pr.includes(u.id)) return reply(cb, { error: 'Conversa não encontrada.' });
    } else {
      f = findChannel(channelId);
      if (!f || !f.g.members.includes(u.id) || f.c.type !== 'voice') return reply(cb, { error: 'Sala não encontrada.' });
      if (!can(f.g, u.id, 'connect')) return reply(cb, { error: 'Você não tem permissão para entrar em salas de voz.' });
    }
    leaveVoice();
    const r = voice.get(channelId) || new Map();
    if (r.size >= 12) return reply(cb, { error: 'Sala cheia (máximo 12 pessoas).' });
    voice.set(channelId, r);
    const peers = [...r.entries()].map(([sid, p]) => ({ sid, ...p }));
    const dupe = [...r.values()].some(p => p.userId === u.id);   // mesma conta em outro aparelho
    const me = { userId: u.id, username: u.username, color: u.color, mic: false, cam: false, screen: false, fmute: false, dupe };
    r.set(socket.id, me);
    currentVoice = channelId;
    socket.join('v:' + channelId);
    socket.to('v:' + channelId).emit('voice:peer-joined', { sid: socket.id, ...me });
    reply(cb, { peers, sid: socket.id, dupe });
    if (pr) {
      const other = pr.find(x => x !== u.id);
      // primeiro a entrar numa conversa privada = está ligando
      const alone = [...r.values()].every(x => x.userId === u.id);
      if (alone) io.to('u:' + other).emit('dm:ring', { channelId, from: publicUser(u) });
      else io.to('u:' + other).emit('dm:ring-stop', { channelId });
      io.to('u:' + u.id).emit('dm:ring-stop', { channelId });
    }
    notifyVoice(channelId);
  });

  // Recusar uma ligação privada
  socket.on('dm:decline', ({ channelId } = {}, cb) => {
    const pr = dmPeers(channelId);
    if (!pr || !pr.includes(u.id)) return reply(cb, { error: 'Conversa não encontrada.' });
    const other = pr.find(x => x !== u.id);
    io.to('u:' + u.id).emit('dm:ring-stop', { channelId });
    io.to('u:' + other).emit('dm:declined', { channelId, by: publicUser(u) });
    reply(cb, { ok: true });
  });

  socket.on('voice:leave', leaveVoice);

  socket.on('voice:state', (st = {}) => {
    if (!currentVoice) return;
    const p = voice.get(currentVoice)?.get(socket.id);
    if (!p) return;
    for (const k of ['mic', 'cam', 'screen']) if (typeof st[k] === 'boolean') p[k] = st[k];
    if (p.fmute) p.mic = false;
    const fv = dmPeers(currentVoice) ? null : findChannel(currentVoice);
    if (fv && !can(fv.g, u.id, 'video')) { p.cam = false; p.screen = false; }
    socket.to('v:' + currentVoice).emit('voice:state', { sid: socket.id, ...p });
    notifyVoice(currentVoice);
  });

  // Moderação da chamada: silenciar, desconectar e mover
  socket.on('voice:force', ({ sid, action, to } = {}, cb) => {
    let cid = null, p = null;
    for (const [ch, r] of voice) if (r.has(sid)) { cid = ch; p = r.get(sid); break; }
    if (!p) return reply(cb, { error: 'Essa pessoa não está mais na chamada.' });
    if (dmPeers(cid)) return reply(cb, { error: 'Isso não existe em conversa privada.' });
    const f = findChannel(cid);
    if (!f || !f.g.members.includes(u.id)) return reply(cb, { error: 'Sem permissão.' });
    const g = f.g;
    const need = action === 'move' ? 'moveMembers' : action === 'disconnect' ? 'disconnectMembers' : 'muteMembers';
    if (!can(g, u.id, need)) return reply(cb, { error: 'Você não tem permissão para isso.' });
    if (p.userId !== u.id && (p.userId === g.ownerId || rank(g, u.id) >= rank(g, p.userId)))
      return reply(cb, { error: 'Essa pessoa está no mesmo nível ou acima do seu.' });
    const who = db.users[p.userId]?.display || p.username;
    if (action === 'mute' || action === 'unmute') {
      p.fmute = action === 'mute';
      if (p.fmute) p.mic = false;
      io.to(sid).emit('voice:force', { action, by: u.username });
      io.to('v:' + cid).emit('voice:state', { sid, ...p });
      audit(g, u, `${p.fmute ? 'silenciou' : 'tirou o silêncio de'} ${who} na sala ${f.c.name}`);
    } else if (action === 'disconnect') {
      io.to(sid).emit('voice:force', { action, by: u.username });
      dropVoice(cid, sid);
      audit(g, u, `desconectou ${who} da sala ${f.c.name}`);
    } else if (action === 'move') {
      const dest = g.channels.find(c => c.id === to && c.type === 'voice');
      if (!dest) return reply(cb, { error: 'Sala não encontrada.' });
      if (dest.id === cid) return reply(cb, { ok: true });
      io.to(sid).emit('voice:force', { action, channelId: dest.id, by: u.username });
      audit(g, u, `moveu ${who} para a sala ${dest.name}`);
    } else return reply(cb, { error: 'Ação inválida.' });
    save();
    emitPresence(g);
    reply(cb, { ok: true });
  });

  // Cada espectador escolhe a resolução que quer RECEBER da transmissão.
  // O pedido vai para quem transmite, que ajusta só a conexão com essa pessoa.
  socket.on('voice:quality', ({ to, maxH } = {}) => {
    if (!currentVoice) return;
    if (!voice.get(currentVoice)?.has(to)) return;
    io.to(to).emit('voice:quality', { from: socket.id, maxH: Math.max(0, Math.min(2160, Number(maxH) || 0)) });
  });

  socket.on('signal', ({ to, data } = {}) => {
    if (!currentVoice || !data) return;
    if (!voice.get(currentVoice)?.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    leaveVoice();
    const n = (online.get(u.id) || 1) - 1;
    if (n > 0) { online.set(u.id, n); return; }
    online.delete(u.id);
    broadcastPresence(u.id);
  });
});

// ------------------------------------------------------------------
loadDb().then(() => {
  Object.values(db.groups).forEach(ensureGroup);
  db.dms ||= {}; db.files ||= {}; db.friends ||= {}; db.freq ||= {};
  server.listen(PORT, () => {
    const proto = process.env.HTTPS === '1' ? 'https' : 'http';
    console.log(`Nexo rodando em ${proto}://localhost:${PORT}`);
  });
}).catch(e => { console.error('Falha ao iniciar', e); process.exit(1); });

process.on('SIGTERM', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
process.on('SIGINT', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
