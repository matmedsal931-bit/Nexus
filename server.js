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
let db = { users: {}, tokens: {}, groups: {}, messages: {} };
let pgPool = null;

async function loadDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pgPool.query('CREATE TABLE IF NOT EXISTS nexo_store (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
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
// Utilidades
// ------------------------------------------------------------------
const newId = () => crypto.randomBytes(8).toString('hex');
const newInvite = () => crypto.randomBytes(4).toString('hex');
const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const COLORS = ['#7c5cff', '#2fc27a', '#f5a524', '#f04f5a', '#3ba7ff', '#e05fd0', '#14b8a6', '#f97316'];

function publicUser(u) {
  return { id: u.id, username: u.username, color: u.color, banner: u.banner || '', bio: u.bio || '',
    status: u.status || '', av: u.avatar ? (u.av || 1) : 0, created: u.created };
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
const online = new Map(); // userId -> numero de conexoes abertas

function findChannel(cid) {
  for (const g of Object.values(db.groups)) {
    const c = g.channels.find(ch => ch.id === cid);
    if (c) return { g, c };
  }
  return null;
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
    members: g.members.map(m => db.users[m]).filter(Boolean).map(x => ({ ...publicUser(x), online: online.has(x.id) })),
    voice: voicePresence(g),
  };
}
const emitGroup = g => io.to('g:' + g.id).emit('group:update', groupView(g));
const emitPresence = g => io.to('g:' + g.id).emit('voice:presence', { groupId: g.id, voice: voicePresence(g) });

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
  if (online.get(u.id) === 1) mine.forEach(g => socket.to('g:' + g.id).emit('presence', { userId: u.id, online: true }));
  socket.emit('init', { user: publicUser(u), groups: mine.map(groupView) });

  // ---------- Perfil ----------
  socket.on('profile:update', (d = {}, cb) => {
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
    io.to('u:' + u.id).emit('profile:me', publicUser(u));
    for (const g of Object.values(db.groups)) if (g.members.includes(u.id)) emitGroup(g);
    reply(cb, { user: publicUser(u) });
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
    if (!g.members.includes(u.id)) { g.members.push(u.id); save(); }
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
      g.members = g.members.filter(m => m !== u.id);
      io.in('u:' + u.id).socketsLeave('g:' + g.id);
      io.to('u:' + u.id).emit('group:removed', { groupId: g.id });
      emitGroup(g);
    }
    save();
    reply(cb, { ok: true });
  });

  // ---------- Canais ----------
  socket.on('channel:create', ({ groupId, name, type } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || g.ownerId !== u.id) return reply(cb, { error: 'Só o dono do grupo pode criar canais.' });
    type = type === 'voice' ? 'voice' : 'text';
    name = cleanName(name, 32);
    if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (!name) return reply(cb, { error: 'Dê um nome ao canal.' });
    if (g.channels.length >= 50) return reply(cb, { error: 'Limite de canais atingido.' });
    const c = { id: newId(), name, type };
    g.channels.push(c);
    save();
    emitGroup(g);
    reply(cb, { channel: c });
  });

  socket.on('channel:delete', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || f.g.ownerId !== u.id) return reply(cb, { error: 'Sem permissão.' });
    if (f.g.channels.length <= 1) return reply(cb, { error: 'O grupo precisa ter pelo menos um canal.' });
    f.g.channels = f.g.channels.filter(c => c.id !== channelId);
    delete db.messages[channelId];
    save();
    emitGroup(f.g);
    reply(cb, { ok: true });
  });

  // ---------- Mensagens ----------
  socket.on('channel:history', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id)) return reply(cb, { error: 'Canal não encontrado.' });
    reply(cb, { messages: (db.messages[channelId] || []).slice(-150) });
  });

  let lastMsgs = [];
  socket.on('message:send', ({ channelId, text, replyTo } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id) || f.c.type !== 'text') return reply(cb, { error: 'Canal não encontrado.' });
    text = String(text || '').trim().slice(0, 2000);
    if (!text) return reply(cb, { error: 'Mensagem vazia.' });
    const now = Date.now();
    lastMsgs = lastMsgs.filter(t => now - t < 5000);
    if (lastMsgs.length >= 8) return reply(cb, { error: 'Calma! Você está enviando rápido demais.' });
    lastMsgs.push(now);
    const arr = (db.messages[channelId] ||= []);
    const msg = { id: newId(), userId: u.id, username: u.username, color: u.color, text, ts: now };
    if (replyTo) {
      const r = arr.find(m => m.id === replyTo);
      if (r) msg.reply = { id: r.id, username: r.username, color: r.color, text: r.text.slice(0, 120) };
    }
    arr.push(msg);
    if (arr.length > MAX_MSGS_PER_CHANNEL) arr.splice(0, arr.length - MAX_MSGS_PER_CHANNEL);
    save();
    io.to('g:' + f.g.id).emit('message', { groupId: f.g.id, channelId, msg });
    reply(cb, { ok: true });
  });

  // ---------- Editar / excluir / reagir ----------
  function locate(channelId, id) {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id)) return null;
    const arr = db.messages[channelId] || [];
    const m = arr.find(x => x.id === id);
    return m ? { f, arr, m } : null;
  }

  socket.on('message:edit', ({ channelId, id, text } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (l.m.userId !== u.id) return reply(cb, { error: 'Você só pode editar as suas mensagens.' });
    text = String(text || '').trim().slice(0, 2000);
    if (!text) return reply(cb, { error: 'Mensagem vazia.' });
    l.m.text = text;
    l.m.edited = true;
    save();
    io.to('g:' + l.f.g.id).emit('message:edit', { channelId, id, text });
    reply(cb, { ok: true });
  });

  socket.on('message:delete', ({ channelId, id } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (l.m.userId !== u.id && l.f.g.ownerId !== u.id) return reply(cb, { error: 'Sem permissão.' });
    l.arr.splice(l.arr.indexOf(l.m), 1);
    save();
    io.to('g:' + l.f.g.id).emit('message:delete', { channelId, id });
    reply(cb, { ok: true });
  });

  socket.on('message:react', ({ channelId, id, emoji } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    emoji = String(emoji || '').trim();
    if (!emoji || emoji.length > 16 || /[\s<>&"']/.test(emoji)) return reply(cb, { error: 'Reação inválida.' });
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
    io.to('g:' + l.f.g.id).emit('message:react', { channelId, id, reactions: rs });
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
    const f = findChannel(cid);
    if (f) emitPresence(f.g);
  }

  socket.on('voice:join', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id) || f.c.type !== 'voice') return reply(cb, { error: 'Sala não encontrada.' });
    leaveVoice();
    const r = voice.get(channelId) || new Map();
    if (r.size >= 12) return reply(cb, { error: 'Sala cheia (máximo 12 pessoas).' });
    voice.set(channelId, r);
    const peers = [...r.entries()].map(([sid, p]) => ({ sid, ...p }));
    const me = { userId: u.id, username: u.username, color: u.color, mic: false, cam: false, screen: false };
    r.set(socket.id, me);
    currentVoice = channelId;
    socket.join('v:' + channelId);
    socket.to('v:' + channelId).emit('voice:peer-joined', { sid: socket.id, ...me });
    reply(cb, { peers, sid: socket.id });
    emitPresence(f.g);
  });

  socket.on('voice:leave', leaveVoice);

  socket.on('voice:state', (st = {}) => {
    if (!currentVoice) return;
    const p = voice.get(currentVoice)?.get(socket.id);
    if (!p) return;
    for (const k of ['mic', 'cam', 'screen']) if (typeof st[k] === 'boolean') p[k] = st[k];
    socket.to('v:' + currentVoice).emit('voice:state', { sid: socket.id, ...p });
    const f = findChannel(currentVoice);
    if (f) emitPresence(f.g);
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
    for (const g of Object.values(db.groups))
      if (g.members.includes(u.id)) io.to('g:' + g.id).emit('presence', { userId: u.id, online: false });
  });
});

// ------------------------------------------------------------------
loadDb().then(() => {
  server.listen(PORT, () => {
    const proto = process.env.HTTPS === '1' ? 'https' : 'http';
    console.log(`Nexo rodando em ${proto}://localhost:${PORT}`);
  });
}).catch(e => { console.error('Falha ao iniciar', e); process.exit(1); });

process.on('SIGTERM', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
process.on('SIGINT', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
