// Nexo - servidor (Express + Socket.IO)
// Chat em tempo real, grupos, canais de texto/voz e sinalizacao WebRTC
// para chamadas de video e transmissao de tela.

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createStorage, sendRange } = require('./storage');
// Versão do app = "impressão digital" dos arquivos do site. Muda a cada atualização;
// quem está com o Nexo aberto recebe a nova e o app se atualiza sozinho.
const APP_VERSION = (() => {
  const h = crypto.createHash('sha1');
  const dir = require('path').join(__dirname, 'public');
  try {
    for (const f of require('fs').readdirSync(dir).sort()) if (/\.(js|css|html)$/.test(f)) h.update(f).update(require('fs').readFileSync(require('path').join(dir, f)));
  } catch {}
  return h.digest('hex').slice(0, 10);
})();
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
// onde ficam os arquivos grandes (R2, pasta local ou banco) — veja storage.js
const store = createStorage({ dataDir: DATA_DIR, hasDb: !!process.env.DATABASE_URL });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MSGS_PER_CHANNEL = 1000;

// ------------------------------------------------------------------
// Armazenamento
//   - Sem DATABASE_URL: salva em data/db.json (bom para rodar local)
//   - Com DATABASE_URL (PostgreSQL, ex.: Neon gratuito): salva no banco,
//     assim nada se perde quando o servidor na nuvem reinicia.
// ------------------------------------------------------------------
let db = { users: {}, tokens: {}, groups: {}, messages: {}, dms: {}, files: {}, friends: {}, freq: {}, reads: {}, uploads: {} };
let pgPool = null;

// O banco é gravado em partes: uma linha com os dados gerais (usuários, grupos...)
// e uma linha por canal com as mensagens dele. Assim, cada mensagem nova grava
// só o canal onde ela entrou, e não o banco inteiro.
const MSG_DIR = path.join(DATA_DIR, 'msgs');
const dirtyMsgs = new Set();
const safeName = cid => String(cid).replace(/[^a-zA-Z0-9_-]/g, '');

async function loadDb() {
  let legacy = false;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pgPool.query('CREATE TABLE IF NOT EXISTS nexo_store (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
    await pgPool.query('CREATE TABLE IF NOT EXISTS nexo_files (id TEXT PRIMARY KEY, mime TEXT, name TEXT, data BYTEA)');
    const r = await pgPool.query('SELECT id, data FROM nexo_store');
    const main = r.rows.find(x => x.id === 'main');
    if (main) { legacy = !!main.data.messages; db = { ...db, ...main.data }; }
    db.messages = db.messages || {};
    for (const row of r.rows) if (row.id.startsWith('m:')) db.messages[row.id.slice(2)] = row.data;
    console.log('Banco: PostgreSQL');
  } else {
    if (fs.existsSync(DB_FILE)) {
      try { const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); legacy = !!d.messages; db = { ...db, ...d }; }
      catch (e) { console.error('Falha ao ler db.json', e); }
    }
    db.messages = db.messages || {};
    if (fs.existsSync(MSG_DIR)) for (const f of fs.readdirSync(MSG_DIR)) {
      if (!f.endsWith('.json')) continue;
      try { db.messages[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(MSG_DIR, f), 'utf8')); }
      catch (e) { console.error('Falha ao ler', f, e); }
    }
    console.log('Banco: arquivo local data/');
  }
  // banco antigo (tudo numa linha só): separa as mensagens na próxima gravação
  if (legacy) { for (const cid of Object.keys(db.messages)) dirtyMsgs.add(cid); save(); console.log('Convertendo o banco para o formato novo…'); }
}

let saveTimer = null;
let saving = false;
let saveAgain = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
// marca que as mensagens de um canal mudaram
function touchMsgs(cid) { dirtyMsgs.add(cid); save(); }

async function flush() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  const dirty = [...dirtyMsgs];
  dirtyMsgs.clear();
  try {
    const { messages, ...rest } = db;
    const main = JSON.stringify(rest);
    if (pgPool) {
      await pgPool.query(
        "INSERT INTO nexo_store (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", [main]);
      for (const cid of dirty) {
        if (messages[cid]) await pgPool.query(
          'INSERT INTO nexo_store (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
          ['m:' + cid, JSON.stringify(messages[cid])]);
        else await pgPool.query('DELETE FROM nexo_store WHERE id = $1', ['m:' + cid]);
      }
    } else {
      fs.mkdirSync(MSG_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE + '.tmp', main);
      fs.renameSync(DB_FILE + '.tmp', DB_FILE);
      for (const cid of dirty) {
        const f = path.join(MSG_DIR, safeName(cid) + '.json');
        if (messages[cid]) { fs.writeFileSync(f + '.tmp', JSON.stringify(messages[cid])); fs.renameSync(f + '.tmp', f); }
        else if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }
  } catch (e) {
    console.error('Erro ao salvar', e);
    for (const cid of dirty) dirtyMsgs.add(cid);   // tenta de novo na próxima
    saveAgain = true;
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
// Tipos que podem abrir direto no navegador (o resto é sempre baixado)
const INLINE_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']);
// MOV é o mesmo formato do MP4 por dentro: os navegadores tocam quando ele é entregue como MP4 (o arquivo não muda)
const PLAY_AS = { 'video/quicktime': 'video/mp4' };
// Descobre o tipo pelo conteúdo do arquivo, sem confiar no que o navegador disse
function sniffMime(b) {
  const at = (o, ...bytes) => bytes.every((x, i) => b[o + i] === x);
  const str = (o, t) => b.length >= o + t.length && b.toString('latin1', o, o + t.length) === t;
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (str(0, 'GIF8')) return 'image/gif';
  if (str(0, 'RIFF') && str(8, 'WEBP')) return 'image/webp';
  if (str(0, 'RIFF') && str(8, 'WAVE')) return 'audio/wav';
  if (str(4, 'ftyp')) {
    const brand = b.toString('latin1', 8, 12);
    if (/^(M4A |M4B )/.test(brand)) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';            // .mov do iPhone/Mac
    return 'video/mp4';
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) {                          // Matroska: WebM ou MKV (o "doctype" diz qual)
    const head = b.toString('latin1', 0, Math.min(b.length, 64));
    return head.includes('webm') ? 'video/webm' : 'video/x-matroska';
  }
  if (str(0, 'OggS')) return 'audio/ogg';
  if (str(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}
// Cabeçalhos que impedem um arquivo enviado de rodar código no site
function safeFileHeaders(res) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
}

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
  const meta = db.files[id];
  if (!meta) return;
  delete db.files[id];
  if (meta.thumb) delFile(meta.thumb);
  if (meta.store === 's3' || meta.store === 'disk') { store.del(meta.key); return; }
  try {
    if (pgPool) await pgPool.query('DELETE FROM nexo_files WHERE id = $1', [id]);
    else fs.unlinkSync(path.join(FILES_DIR, id));
  } catch (e) { /* ja apagado */ }
}

// Coloca uma mensagem no canal, apaga as mais antigas que passarem do limite
// (e os arquivos delas) e marca o canal para gravar.
function pushMsg(cid, msg) {
  const arr = (db.messages[cid] ||= []);
  arr.push(msg);
  if (arr.length > MAX_MSGS_PER_CHANNEL) {
    for (const old of arr.splice(0, arr.length - MAX_MSGS_PER_CHANNEL)) if (old.att) delFile(old.att.id);
  }
  touchMsgs(cid);
  return arr;
}
// Apaga todas as mensagens de um canal (e os arquivos enviados nele)
function dropChannelMsgs(cid) {
  for (const m of db.messages[cid] || []) if (m.att) delFile(m.att.id);
  delete db.messages[cid];
  touchMsgs(cid);
}

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const slowLast = new Map();   // modo lento: pessoa+canal -> última mensagem
const newId = () => crypto.randomBytes(8).toString('hex');
const newInvite = () => crypto.randomBytes(6).toString('hex');
const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const COLORS = ['#7c5cff', '#2fc27a', '#f5a524', '#f04f5a', '#3ba7ff', '#e05fd0', '#14b8a6', '#f97316'];

const PRESENCES = ['online', 'idle', 'dnd', 'invisible'];
function publicUser(u) {
  return { id: u.id, username: u.username, name: u.display || u.username, color: u.color,
    banner: u.banner || '', bio: u.bio || '', status: u.status || '',
    av: (u.avatar || u.avId || u.avStillId) ? (u.av || 1) : 0, gif: !!u.avGif, created: u.created };
}
// "invisivel" aparece como offline para os outros
const isOnline = id => online.has(id) && (db.users[id]?.presence || 'online') !== 'invisible';
const awake = new Map();   // uid -> aparelhos que estão sendo usados agora
const isAway = id => online.has(id) && !(awake.get(id)?.size);
const visPresence = id => {
  if (!isOnline(id)) return 'offline';
  const p = db.users[id].presence || 'online';
  return p === 'online' && isAway(id) ? 'idle' : p;
};
const memberView = u => ({ ...publicUser(u), online: isOnline(u.id), presence: visPresence(u.id) });
// ------------------------------------------------------------------
// Cargos e permissoes
// ------------------------------------------------------------------
const PERMS = ['admin', 'manageGroup', 'manageChannels', 'manageRoles', 'manageEmoji', 'kick', 'ban',
  'manageMessages', 'viewAudit', 'muteMembers', 'deafenMembers', 'moveMembers', 'disconnectMembers',
  'sendMessages', 'addReactions', 'connect', 'video',
  'view', 'readHistory', 'attachFiles', 'embedLinks', 'speak', 'stream', 'useVAD'];
const DEFAULT_EVERYONE = { sendMessages: true, addReactions: true, connect: true, video: true,
  view: true, readHistory: true, attachFiles: true, embedLinks: true, speak: true, stream: true, useVAD: true };
// Permissões que podem ser trocadas em cada canal / categoria (permitir, negar ou herdar)
const CH_PERMS = ['view', 'manageChannels', 'sendMessages', 'readHistory', 'attachFiles', 'embedLinks', 'addReactions',
  'manageMessages', 'connect', 'speak', 'video', 'stream', 'useVAD', 'muteMembers', 'deafenMembers', 'moveMembers', 'disconnectMembers'];
// Configurações de cada canal (com os limites aceitos)
const TEXT_CFG = { maxLen: 2000, slow: 0, edit: true, del: true, replies: true, maxFileMB: 0, newHistory: true, retention: 0 };
const VOICE_CFG = { limit: 0, locked: false, temp: false, bitrate: 64, ns: '', screenAudio: true };
function cleanCfg(type, cur, inc) {
  const base = type === 'voice' ? VOICE_CFG : TEXT_CFG;
  const out = { ...base, ...(cur || {}) };
  if (!inc || typeof inc !== 'object') return out;
  const num = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  if (type === 'voice') {
    if ('limit' in inc) out.limit = num(inc.limit, 0, 12, 0);
    if ('locked' in inc) out.locked = !!inc.locked;
    if ('temp' in inc) out.temp = !!inc.temp;
    if ('bitrate' in inc) out.bitrate = [32, 64, 96, 128].includes(Number(inc.bitrate)) ? Number(inc.bitrate) : 64;
    if ('ns' in inc) out.ns = ['', 'off', 'low', 'med', 'high', 'auto'].includes(inc.ns) ? inc.ns : '';
    if ('screenAudio' in inc) out.screenAudio = !!inc.screenAudio;
  } else {
    if ('maxLen' in inc) out.maxLen = num(inc.maxLen, 1, 2000, 2000);
    if ('slow' in inc) out.slow = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600].includes(Number(inc.slow)) ? Number(inc.slow) : 0;
    for (const k of ['edit', 'del', 'replies', 'newHistory']) if (k in inc) out[k] = !!inc[k];
    if ('maxFileMB' in inc) out.maxFileMB = num(inc.maxFileMB, 0, 5000, 0);   // 0 = segue o limite do grupo
    if ('retention' in inc) out.retention = [0, 1, 7, 30, 90, 365].includes(Number(inc.retention)) ? Number(inc.retention) : 0;
  }
  return out;
}
// Sobrescritas: { everyone|r:<cargo>|m:<pessoa>: { a: {perm:1}, d: {perm:1} } }
function cleanOw(g, ow) {
  const out = {};
  if (!ow || typeof ow !== 'object') return out;
  for (const [key, v] of Object.entries(ow)) {
    if (!(key === 'everyone' || (key.startsWith('r:') && g.roles.some(r => 'r:' + r.id === key)) || (key.startsWith('m:') && db.users[key.slice(2)]))) continue;
    const a = {}, d = {};
    for (const k of CH_PERMS) {
      if (v?.a?.[k]) a[k] = 1;
      else if (v?.d?.[k]) d[k] = 1;
    }
    if (Object.keys(a).length || Object.keys(d).length) out[key] = { a, d };
  }
  return out;
}

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
  // v20: permissões novas (ver canal, histórico, anexos, links, falar, transmitir, detecção de voz)
  if ((g.permV || 0) < 2) {
    for (const k of ['view', 'readHistory', 'attachFiles', 'embedLinks', 'speak', 'useVAD']) if (!(k in g.everyone)) g.everyone[k] = true;
    if (!('stream' in g.everyone)) g.everyone.stream = !!g.everyone.video;
    for (const r of g.roles) if (r.perms?.video && !('stream' in r.perms)) r.perms.stream = true;
    g.permV = 2;
  }
  // v22: o limite de anexo do canal passa a "seguir o grupo" (antes o padrão era 25 MB fixo)
  if ((g.permV || 0) < 3) { for (const c of g.channels) if (c.cfg?.maxFileMB === 25) c.cfg.maxFileMB = 0; g.permV = 3; }
  for (const c of g.channels) { c.cfg = cleanCfg(c.type, c.cfg); c.ow ||= {}; c.topic ||= ''; }
  for (const c of g.categories) c.ow ||= {};
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
// Sobrescritas que valem para o canal: as do canal; o que estiver "herdar" vem da categoria
function effOw(g, c) {
  const cat = c.cat && g.categories.find(x => x.id === c.cat);
  const out = {};
  const keys = new Set([...Object.keys(cat?.ow || {}), ...Object.keys(c.ow || {})]);
  for (const key of keys) {
    const co = c.ow?.[key] || {}, ko = cat?.ow?.[key] || {};
    const a = {}, d = {};
    for (const k of CH_PERMS) {
      if (co.a?.[k]) a[k] = 1; else if (co.d?.[k]) d[k] = 1;
      else if (ko.a?.[k]) a[k] = 1; else if (ko.d?.[k]) d[k] = 1;
    }
    out[key] = { a, d };
  }
  return out;
}
// Permissões da pessoa DENTRO de um canal (ou categoria).
// Ordem igual à do Discord: cargos do grupo → @everyone do canal → cargos do canal → a pessoa.
// Administrador e dono não são afetados.
function permsIn(g, uid, c) {
  const out = permsOf(g, uid);
  if (!c || out.admin) return out;
  const ow = c.channels ? c.ow /* categoria */ : null;
  const eff = ow ? Object.fromEntries(Object.entries(ow).map(([k, v]) => [k, { a: v.a || {}, d: v.d || {} }])) : effOw(g, c);
  const apply = o => { if (!o) return; for (const k in o.d) out[k] = false; for (const k in o.a) out[k] = true; };
  apply(eff.everyone);
  const mine = g.memberRoles[uid] || [];
  const A = {}, D = {};
  for (const rid of mine) { const o = eff['r:' + rid]; if (!o) continue; Object.assign(D, o.d); Object.assign(A, o.a); }
  apply({ d: D, a: A });
  apply(eff['m:' + uid]);
  if (!out.view) for (const k of CH_PERMS) out[k] = false;
  if (!out.sendMessages) { out.attachFiles = false; out.embedLinks = false; }
  if (!out.connect) { out.speak = false; out.video = false; out.stream = false; }
  return out;
}
const canIn = (g, uid, c, p) => !!permsIn(g, uid, c)[p];
const catAsChannel = cat => ({ ...cat, channels: true });   // usado para calcular a permissão numa categoria
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
// Serve uma imagem do grupo ou do perfil.
// Sem ?a=1 manda a versão parada; com ?a=1 manda o GIF animado.
async function sendImage(req, res, rec) {
  if (!rec) return res.status(404).end();
  const wantAnim = req.query.a === '1';
  const fid = wantAnim ? (rec.id || rec.stillId) : (rec.stillId || rec.id);
  if (fid && db.files[fid]) {
    const f = await getFile(fid);
    if (f && INLINE_OK.has(f.mime) && f.mime.startsWith('image/')) {
      safeFileHeaders(res);
      res.set('Content-Type', f.mime);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(f.buf);
    }
  }
  if (rec.dataUrl) return sendDataUrl(res, rec.dataUrl, 'public, max-age=31536000, immutable');
  return res.status(404).end();
}

function sendDataUrl(res, dataUrl, cache) {
  const m = dataUrl && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', cache);
  res.send(Buffer.from(m[2], 'base64'));
}

// Para pesquisar sem ligar para acento e maiúscula
const fold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Acha os @nomes de usuário citados na mensagem que fazem parte da conversa
function findMentions(text, memberIds) {
  const names = new Set([...String(text || '').matchAll(/@([a-zA-Z0-9_.\-]{2,24})/g)].map(m => m[1].toLowerCase()));
  if (!names.size) return [];
  return memberIds.filter(id => db.users[id] && names.has(db.users[id].username.toLowerCase()));
}

function cleanName(s, max) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max); }

// ------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)');
  next();
});
app.use(express.json({ limit: '50kb' }));
// Arquivos de texto do app (js, css, html) saem comprimidos: ~4x menores, abre mais rápido no 4G
const zlib = require('zlib');
const PUB = path.join(__dirname, 'public');
const ZTYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const zcache = new Map();
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let rel; try { rel = decodeURIComponent(req.path); } catch { return next(); }
  if (rel === '/') rel = '/index.html';
  const ext = path.extname(rel), type = ZTYPES[ext];
  const ae = String(req.headers['accept-encoding'] || '');
  const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
  if (!type || !enc || rel.includes('..') || rel.startsWith('/api/')) return next();
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB + path.sep)) return next();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile() || st.size < 1024 || st.size > 3e6) return next();
    const key = file + '|' + enc, tag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}-${enc}"`;
    res.set('Vary', 'Accept-Encoding'); res.set('ETag', tag); res.set('Cache-Control', 'public, max-age=0');
    if (req.headers['if-none-match'] === tag) return res.status(304).end();
    const send = buf => { res.set('Content-Type', type); res.set('Content-Encoding', enc); res.set('Content-Length', String(buf.length)); req.method === 'HEAD' ? res.end() : res.end(buf); };
    const hit = zcache.get(key);
    if (hit && hit.tag === tag) return send(hit.buf);
    fs.readFile(file, (e2, raw) => {
      if (e2) return next();
      const done = (e3, buf) => { if (e3) return next(); zcache.set(key, { tag, buf }); send(buf); };
      if (enc === 'br') zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }, done); else zlib.gzip(raw, { level: 9 }, done);
    });
  });
});
app.use(express.static(PUB, { extensions: ['html'] }));

// Limite simples contra tentativas de senha em massa
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 60_000);
  a.push(now);
  attempts.set(ip, a);
  return a.length > 20;
}

// Sessões: valem 60 dias desde o último uso; cada conta guarda no máximo 15.
const SESSION_DAYS = 60;
const MAX_SESSIONS = 15;
const cookieOf = (req, name) => { const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : null; };
const reqUser = req => sessionUser(req.get('x-token') || cookieOf(req, 'nexo_s'));
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `nexo_s=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function sessionUser(token) {
  if (typeof token !== 'string' || !token) return null;
  let s = db.tokens[token];
  if (!s) return null;
  if (typeof s === 'string') s = db.tokens[token] = { uid: s, at: Date.now() };   // formato antigo
  if (Date.now() - s.at > SESSION_DAYS * 864e5 || !db.users[s.uid]) { delete db.tokens[token]; save(); return null; }
  if (Date.now() - s.at > 864e5) { s.at = Date.now(); save(); }   // renova uma vez por dia
  return s.uid;
}
function issueToken(u) {
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = { uid: u.id, at: Date.now() };
  const mine = Object.entries(db.tokens).filter(([, v]) => (typeof v === 'string' ? v : v.uid) === u.id)
    .sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  while (mine.length > MAX_SESSIONS) delete db.tokens[mine.shift()[0]];
  save();
  return token;
}
function dropSessions(uid, except) {
  for (const [t, v] of Object.entries(db.tokens)) if ((typeof v === 'string' ? v : v.uid) === uid && t !== except) delete db.tokens[t];
  save();
}

app.post('/api/register', (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const username = cleanName(req.body?.username, 24);
  const password = String(req.body?.password || '');
  if (!/^[\p{L}\p{N}_.\- ]{2,24}$/u.test(username))
    return res.status(400).json({ error: 'O nome deve ter de 2 a 24 caracteres (letras, números, espaço, _ . -).' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (password.length > 200) return res.status(400).json({ error: 'Senha longa demais.' });
  if (Object.values(db.users).some(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Esse nome já está em uso.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id: newId(), username, salt, hash: hashPass(password, salt),
    color: COLORS[Object.keys(db.users).length % COLORS.length], created: Date.now(),
  };
  db.users[u.id] = u;
  const tk = issueToken(u); setSessionCookie(req, res, tk);
  res.json({ token: tk, user: publicUser(u) });
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
  const tk = issueToken(u); setSessionCookie(req, res, tk);
  res.json({ token: tk, user: publicUser(u) });
});
// o app chama ao abrir: guarda a sessão num cookie protegido (o JavaScript não lê) para os arquivos
app.post('/api/cookie', (req, res) => {
  const t = req.get('x-token');
  if (!sessionUser(t)) return res.status(401).json({ error: 'Sessão expirada.' });
  setSessionCookie(req, res, t);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const t = String(req.body?.token || '');
  if (db.tokens[t]) { delete db.tokens[t]; save(); }
  res.append('Set-Cookie', 'nexo_s=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// Servidores STUN/TURN usados pelo WebRTC.
// TURN e necessario quando as pessoas estao em redes restritas (4G, empresas).
// Aceita três jeitos de configurar o TURN (variáveis no Render):
//  - Cloudflare: CF_TURN_KEY_ID + CF_TURN_KEY_TOKEN (gera senhas temporárias sozinho)
//  - Metered/Open Relay: METERED_TURN_URL (o link "credentials?apiKey=..." do painel)
//  - Qualquer outro: TURN_URL + TURN_USER + TURN_PASS
let iceCache = { at: 0, list: null };
async function turnServers() {
  if (iceCache.list && Date.now() - iceCache.at < 6 * 3600e3) return iceCache.list;
  const out = [];
  try {
    if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_KEY_TOKEN) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(process.env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST', signal: AbortSignal.timeout(6000),
        headers: { Authorization: 'Bearer ' + process.env.CF_TURN_KEY_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      const j = await r.json();
      for (const x of j.iceServers || []) if ([].concat(x.urls).some(u => /^turns?:/.test(u))) out.push(x);
      if (!out.length) console.warn('TURN Cloudflare: resposta sem servidores', r.status);
    }
    if (process.env.METERED_TURN_URL) {
      const r = await fetch(process.env.METERED_TURN_URL, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      for (const x of Array.isArray(j) ? j : []) if ([].concat(x.urls).some(u => /^turns?:/.test(u))) out.push(x);
      if (!out.length) console.warn('TURN Metered: resposta sem servidores', r.status);
    }
  } catch (e) { console.warn('TURN: não consegui buscar as senhas', e.message); }
  if (process.env.TURN_URL) {
    out.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  if (out.length) iceCache = { at: Date.now(), list: out };
  return out;
}
// ---------------------------------------------------------------------
// App para PC (Windows): o instalador e o latest.yml ficam no R2, na pasta desktop/
// (ou em data/desktop/ sem R2). O app se atualiza sozinho lendo /desktop/latest.yml.
// ---------------------------------------------------------------------
const DESK_DIR = path.join(DATA_DIR, 'desktop');
const deskName = n => /^[\w.\- ]{1,120}$/.test(n) && !n.startsWith('.') ? n : null;
let deskCache = { at: 0, info: null };
async function desktopInfo() {
  if (Date.now() - deskCache.at < 5 * 60e3) return deskCache.info;
  let info = null;
  try {
    let yml = null;
    if (store.mode === 's3') { if ((await store.size('desktop/latest.yml')) > 0) yml = (await store.head('desktop/latest.yml', 16384)).toString('utf8'); }
    else if (fs.existsSync(path.join(DESK_DIR, 'latest.yml'))) yml = fs.readFileSync(path.join(DESK_DIR, 'latest.yml'), 'utf8');
    const ver = yml && /^version:\s*['"]?([\w.\-]+)/m.exec(yml)?.[1];
    const file = yml && /^path:\s*['"]?([^'"\r\n]+)/m.exec(yml)?.[1];
    if (ver && file && deskName(file.trim())) info = { version: ver, file: file.trim() };
  } catch (e) { console.warn('app para PC: não consegui ler latest.yml', e.message); }
  deskCache = { at: Date.now(), info };
  return info;
}
app.get('/desktop/:file', async (req, res) => {
  const name = deskName(req.params.file);
  if (!name) return res.status(404).end();
  if (store.mode === 's3') {
    const key = 'desktop/' + name;
    if ((await store.size(key).catch(() => -1)) < 0) return res.status(404).end();
    const mime = name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, await store.readUrl(key, { mime, inline: name.endsWith('.yml'), name }));
  }
  const f = path.join(DESK_DIR, name);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.download(f, name);
});
// link fixo para baixar a versão mais nova (para mandar para os amigos)
app.get('/baixar/pc', async (req, res) => {
  const d = await desktopInfo();
  if (!d) return res.status(404).send('O app para PC ainda não foi publicado neste servidor.');
  res.redirect(302, '/desktop/' + encodeURIComponent(d.file));
});
app.get('/api/config', async (req, res) => {
  const turn = await turnServers();
  res.json({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, ...turn], turn: turn.length > 0,
    upload: { maxMB: Math.round(store.maxBytes / MBY), mode: store.mode, partMB: store.partSize / MBY }, desktop: await desktopInfo() });
});

// Foto de perfil (guardada como data URL no banco)
app.get('/api/avatar/:id', (req, res) => {
  const u = db.users[req.params.id];
  if (!u) return res.status(404).end();
  sendImage(req, res, { id: u.avId, stillId: u.avStillId, dataUrl: u.avatar });
});

app.get('/api/gicon/:gid', (req, res) => {
  const g = db.groups[req.params.gid];
  if (!g) return res.status(404).end();
  sendImage(req, res, { id: g.iconId, stillId: g.iconStillId, dataUrl: g.icon });
});
app.get('/api/gbanner/:gid', (req, res) => {
  const g = db.groups[req.params.gid];
  if (!g) return res.status(404).end();
  sendImage(req, res, { id: g.bannerId, stillId: g.bannerStillId });
});
app.get('/api/emoji/:gid/:id', (req, res) => {
  const e = db.groups[req.params.gid]?.emojis?.find(x => x.id === req.params.id);
  sendDataUrl(res, e?.data, 'public, max-age=31536000, immutable');
});

// Envio de arquivo: o corpo é o arquivo puro; nome e tipo vêm nos cabeçalhos
app.post('/api/upload', express.raw({ type: '*/*', limit: MAX_FILE + 1024 }), async (req, res) => {
  const uid = reqUser(req);
  if (!uid || !db.users[uid]) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Arquivo vazio.' });
  if (buf.length > MAX_FILE) return res.status(413).json({ error: 'O arquivo passa de 8 MB.' });
  let mime = String(req.get('x-mime') || 'application/octet-stream').slice(0, 100).toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) mime = 'application/octet-stream';
  // imagem/vídeo/áudio só se o conteúdo confirmar; o resto vira "arquivo para baixar"
  const real = sniffMime(buf);
  if (real) mime = real;
  else if (/^(image|video|audio)\//.test(mime) || /html|xml|javascript|svg/.test(mime)) mime = 'application/octet-stream';
  if (!uploadAllowed(uid, buf.length)) return res.status(429).json({ error: 'Você enviou muitos arquivos agora. Espere alguns minutos.' });
  let name = '';
  try { name = decodeURIComponent(req.get('x-name') || ''); } catch { name = ''; }
  name = name.replace(/[\r\n"\\/]/g, '').trim().slice(0, 80) || 'arquivo';
  const id = newId();
  if (storageFull(uid, buf.length)) return res.status(507).json({ error: storageFull(uid, buf.length) });
  try { await putFile(id, mime, name, buf); } catch (e) { console.error(e); return res.status(500).json({ error: 'Falha ao salvar o arquivo.' }); }
  const purpose = String(req.get('x-purpose') || '');
  Object.assign(db.files[id], { uid, at: Date.now(), kind: purpose === 'thumb' ? 'thumb' : purpose === 'att' ? 'att' : 'img' });
  save();
  res.json({ att: { id, name, mime, size: buf.length } });
});

// No máximo 40 arquivos ou 600 MB a cada 10 minutos por pessoa
const uploadLog = new Map();
function uploadAllowed(uid, size) {
  const now = Date.now();
  const list = (uploadLog.get(uid) || []).filter(x => now - x.t < 10 * 60_000);
  const total = list.reduce((a, x) => a + x.s, 0);
  if (list.length >= 40 || total + size > 600 * 1024 * 1024) { uploadLog.set(uid, list); return false; }
  list.push({ t: now, s: size });
  uploadLog.set(uid, list);
  return true;
}

// Quem pode abrir um arquivo: quem pode ler a conversa onde ele foi enviado
function canReadFile(uid, id, depth = 0) {
  const f = db.files[id];
  if (!f || !uid) return false;
  if (f.parent && depth < 2) return canReadFile(uid, f.parent, depth + 1);
  if (f.cid) {
    const pr = dmPeers(f.cid);
    if (pr) return pr.includes(uid);
    const c = findChannel(f.cid);
    return !!c && c.g.members.includes(uid) && canIn(c.g, uid, c.c, 'view') && canIn(c.g, uid, c.c, 'readHistory');
  }
  if (f.kind === 'att' || f.kind === 'thumb') return f.uid === uid;   // ainda não foi enviado: só quem subiu
  return true;                                                          // imagens de perfil/grupo antigas
}
app.get('/api/file/:id', async (req, res) => {
  const id = req.params.id, meta = db.files[id];
  if (!meta || !/^[a-f0-9]{16}$/.test(id)) return res.status(404).end();
  const uid = reqUser(req);
  if (!uid) return res.status(401).json({ error: 'Entre na sua conta para ver este arquivo.' });
  if (!canReadFile(uid, id)) return res.status(403).json({ error: 'Você não tem acesso a este arquivo.' });
  const inline = INLINE_OK.has(meta.mime);
  const type = inline ? (PLAY_AS[meta.mime] || meta.mime) : 'application/octet-stream';
  const name = meta.name || 'arquivo';
  if (meta.store === 's3') {
    // o vídeo sai direto do R2 (sem passar pelo servidor), por um link que vale pouco tempo
    res.set('Cache-Control', 'private, max-age=600');
    return res.redirect(302, await store.readUrl(meta.key, { mime: type, inline, name }));
  }
  safeFileHeaders(res);
  res.set('Content-Type', type);
  res.set('Cache-Control', 'private, max-age=86400');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (meta.store === 'disk') {
    const fp = store.localPath(meta.key);
    if (!fs.existsSync(fp)) return res.status(404).end();
    return sendRange(req, res, { size: fs.statSync(fp).size, open: (a, b) => fs.createReadStream(fp, { start: a, end: b }) });
  }
  const f = await getFile(id);
  if (!f) return res.status(404).end();
  const { Readable } = require('stream');
  return sendRange(req, res, { size: f.buf.length, open: (a, b) => Readable.from([f.buf.subarray(a, b + 1)]) });
});

// ------------------------------------------------------------------
// Envio de arquivos grandes em partes (pode continuar de onde parou)
//   POST /api/up            → começa (ou retoma o mesmo arquivo)
//   POST /api/up/:id/urls   → links para enviar as partes (R2) — ou PUT /api/up/:id/part/:n
//   GET  /api/up/:id        → quais partes já chegaram
//   POST /api/up/:id/done   → confere tudo e libera o arquivo
//   DELETE /api/up/:id      → cancela
// ------------------------------------------------------------------
const MBY = 1024 * 1024;
// limite para um canal: servidor → grupo → canal (o menor vence)
function uploadLimit(uid, cid) {
  let lim = store.maxBytes;
  if (!cid || dmPeers(cid)) return lim;
  const f = findChannel(cid);
  if (!f) return lim;
  if (f.g.maxUploadMB) lim = Math.min(lim, f.g.maxUploadMB * MBY);
  if (f.c.cfg?.maxFileMB) lim = Math.min(lim, f.c.cfg.maxFileMB * MBY);
  return lim;
}
const fmtMB = b => (b / MBY >= 10 ? Math.round(b / MBY) : (b / MBY).toFixed(1)) + ' MB';
const USER_QUOTA = (Number(process.env.USER_QUOTA_MB) || 2048) * MBY;
const TOTAL_QUOTA = (Number(process.env.STORAGE_QUOTA_MB) || (store.mode === 's3' ? 9500 : store.mode === 'db' ? 300 : 0)) * MBY;
function usage(uid) {
  let me = 0, all = 0;
  for (const f of Object.values(db.files)) { all += f.size || 0; if (f.uid === uid) me += f.size || 0; }
  for (const u of Object.values(db.uploads)) { all += u.size; if (u.uid === uid) me += u.size; }
  return { me, all };
}
function storageFull(uid, size) {
  const u = usage(uid);
  if (u.me + size > USER_QUOTA) return `Você já usa ${fmtMB(u.me)} de ${fmtMB(USER_QUOTA)} com arquivos. Apague mensagens antigas com anexos para liberar espaço.`;
  if (TOTAL_QUOTA && u.all + size > TOTAL_QUOTA) return 'O armazenamento do servidor está cheio. Avise o dono do site.';
  return null;
}
function canSendFileTo(uid, cid) {
  const pr = dmPeers(cid);
  if (pr) return pr.includes(uid) && canDm(uid, pr.find(x => x !== uid) || uid) ? null : 'Você não pode enviar arquivos nesta conversa.';
  const f = findChannel(cid);
  if (!f || !f.g.members.includes(uid)) return 'Canal não encontrado.';
  const P = permsIn(f.g, uid, f.c);
  if (!P.sendMessages || !P.attachFiles) return 'Não é permitido enviar arquivos neste canal.';
  return null;
}
const upOf = (req, res) => {
  const uid = reqUser(req);
  if (!uid) { res.status(401).json({ error: 'Sessão expirada. Entre de novo.' }); return null; }
  const up = db.uploads[req.params.id];
  if (!up || up.uid !== uid) { res.status(404).json({ error: 'Envio não encontrado (pode ter expirado). Escolha o arquivo de novo.' }); return null; }
  return up;
};
app.post('/api/up', express.json({ limit: '16kb' }), async (req, res) => {
  const uid = reqUser(req);
  if (!uid || !db.users[uid]) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  const b = req.body || {};
  const size = Math.floor(Number(b.size));
  const cid = String(b.channelId || '');
  if (!(size > 0)) return res.status(400).json({ error: 'Arquivo vazio.' });
  const deny = canSendFileTo(uid, cid);
  if (deny) return res.status(403).json({ error: deny });
  const lim = uploadLimit(uid, cid);
  if (size > lim) return res.status(413).json({ error: `O arquivo tem ${fmtMB(size)} e o limite aqui é ${fmtMB(lim)}.`, limit: lim });
  let name = String(b.name || '').replace(/[\r\n"\\/]/g, '').trim().slice(0, 120) || 'arquivo';
  const fkey = String(b.fkey || '').slice(0, 300);
  // o mesmo arquivo de novo: continua o envio que já existe (não duplica)
  const same = Object.entries(db.uploads).find(([, u]) => u.uid === uid && fkey && u.fkey === fkey && u.size === size);
  if (same) {
    const [id, u] = same;
    u.cid = cid;
    const parts = await store.listParts(u.key, u.uploadId).catch(() => []);
    return res.json({ id, partSize: u.partSize, parts: u.parts, done: parts.map(p => p.n), mode: store.mode, resumed: true });
  }
  const full = storageFull(uid, size);
  if (full) return res.status(507).json({ error: full });
  if (!uploadAllowed(uid, size)) return res.status(429).json({ error: 'Você enviou muitos arquivos agora. Espere alguns minutos.' });
  let mime = String(b.mime || '').toLowerCase().slice(0, 100);
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime) || /html|xml|javascript|svg/.test(mime)) mime = 'application/octet-stream';
  const id = newId();
  const partSize = store.partSize;
  const up = { uid, cid, name, size, mime, fkey, key: 'f/' + id, at: Date.now(), partSize, parts: Math.max(1, Math.ceil(size / partSize)) };
  if (store.mode !== 's3') up.key = id;
  try { up.uploadId = await store.start(up.key, store.mode === 's3' ? 'application/octet-stream' : mime); }
  catch (e) { console.error(e); return res.status(502).json({ error: 'O armazenamento não respondeu. Tente de novo.' }); }
  const m = b.meta || {};
  up.meta = { dur: Number(m.dur) > 0 ? Math.round(Number(m.dur) * 10) / 10 : undefined, w: Math.round(Number(m.w)) || undefined, h: Math.round(Number(m.h)) || undefined, playable: m.playable === true ? true : m.playable === false ? false : undefined };
  if (typeof m.thumb === 'string' && db.files[m.thumb]?.uid === uid && db.files[m.thumb].kind === 'thumb') up.meta.thumb = m.thumb;
  db.uploads[id] = up;
  save();
  res.json({ id, partSize, parts: up.parts, done: [], mode: store.mode });
});
app.get('/api/up/:id', async (req, res) => {
  const up = upOf(req, res); if (!up) return;
  const parts = await store.listParts(up.key, up.uploadId).catch(() => []);
  res.json({ partSize: up.partSize, parts: up.parts, done: parts.map(p => p.n) });
});
app.post('/api/up/:id/urls', express.json({ limit: '16kb' }), async (req, res) => {
  const up = upOf(req, res); if (!up) return;
  if (store.mode !== 's3') return res.json({ urls: {} });
  const want = (Array.isArray(req.body?.parts) ? req.body.parts : []).map(Number).filter(n => n >= 1 && n <= up.parts).slice(0, 50);
  const urls = {};
  for (const n of want) {
    const sz = n < up.parts ? up.partSize : up.size - up.partSize * (up.parts - 1);
    urls[n] = await store.partUrl(up.key, up.uploadId, n, sz);
  }
  res.json({ urls });
});
app.put('/api/up/:id/part/:n', express.raw({ type: () => true, limit: store.partSize + 1024 }), async (req, res) => {
  const up = upOf(req, res); if (!up) return;
  const n = Number(req.params.n);
  if (!(n >= 1 && n <= up.parts)) return res.status(400).json({ error: 'Parte inválida.' });
  const want = n < up.parts ? up.partSize : up.size - up.partSize * (up.parts - 1);
  if (!Buffer.isBuffer(req.body) || req.body.length !== want) return res.status(400).json({ error: 'Parte com tamanho errado.' });
  try { await store.writePart(up.uploadId, n, req.body); } catch (e) { return res.status(500).json({ error: 'Falha ao salvar a parte.' }); }
  res.json({ ok: true });
});
app.delete('/api/up/:id', async (req, res) => {
  const up = upOf(req, res); if (!up) return;
  await store.abort(up.key, up.uploadId);
  if (up.meta?.thumb) delFile(up.meta.thumb);
  delete db.uploads[req.params.id];
  save();
  res.json({ ok: true });
});
app.post('/api/up/:id/done', async (req, res) => {
  const up = upOf(req, res); if (!up) return;
  const id = req.params.id;
  const fail = async (code, error) => { await store.abort(up.key, up.uploadId); await store.del(up.key); delete db.uploads[id]; save(); res.status(code).json({ error }); };
  try {
    const parts = await store.listParts(up.key, up.uploadId);
    const got = new Set(parts.map(p => p.n));
    const missing = []; for (let n = 1; n <= up.parts; n++) if (!got.has(n)) missing.push(n);
    if (missing.length) return res.status(409).json({ error: 'Ainda faltam partes.', missing });
    const total = parts.reduce((a, p) => a + p.size, 0);
    if (total !== up.size) return fail(400, 'O arquivo chegou com tamanho diferente do combinado.');
    await store.finish(up.key, up.uploadId, parts);
    const real = await store.size(up.key);
    if (real !== up.size) return fail(400, 'O arquivo chegou incompleto.');
    // o tipo vem do CONTEÚDO, não do nome nem do que o navegador disse
    const sniffed = sniffMime(await store.head(up.key));
    let mime = sniffed || 'application/octet-stream';
    if (!sniffed && !/^(image|video|audio)\//.test(up.mime)) mime = up.mime === 'application/octet-stream' ? mime : up.mime.startsWith('text/plain') ? 'text/plain' : 'application/octet-stream';
    if (/^(image|video|audio)\//.test(up.mime) && !sniffed) mime = 'application/octet-stream';   // disse que era vídeo, mas não é
    const rec = { mime, name: up.name, size: up.size, store: store.mode, key: up.key, uid: up.uid, at: Date.now(), kind: 'att' };
    if (store.mode === 'db') {
      // banco: o arquivo (pequeno) vai para o PostgreSQL, como antes
      const fp = store.localPath(up.key), buf = fs.readFileSync(fp);
      await putFile(id, mime, up.name, buf);
      fs.unlinkSync(fp);
      delete rec.store; delete rec.key;
    }
    if (mime.startsWith('video/') || mime.startsWith('image/')) Object.assign(rec, Object.fromEntries(Object.entries(up.meta || {}).filter(([, v]) => v !== undefined)));
    if (rec.thumb) db.files[rec.thumb].parent = id;
    db.files[id] = rec;
    delete db.uploads[id];
    save();
    res.json({ att: attView(id) });
  } catch (e) {
    console.error('upload done', e);
    res.status(502).json({ error: 'Falha ao terminar o envio. Tente de novo (as partes enviadas continuam guardadas).' });
  }
});
// o que vai na mensagem sobre o anexo
function attView(id) {
  const f = db.files[id];
  if (!f) return null;
  const a = { id, name: f.name, mime: f.mime, size: f.size };
  for (const k of ['w', 'h', 'dur', 'thumb', 'playable']) if (f[k] !== undefined) a[k] = f[k];
  return a;
}
// Limpeza (de hora em hora): envios largados há mais de 24 h e anexos que nunca foram enviados
async function sweepFiles() {
  const now = Date.now();
  let changed = false;
  for (const [id, u] of Object.entries(db.uploads)) if (now - u.at > 24 * 3600e3) { await store.abort(u.key, u.uploadId); if (u.meta?.thumb) delFile(u.meta.thumb); delete db.uploads[id]; changed = true; }
  for (const [id, f] of Object.entries(db.files)) if ((f.kind === 'att' || (f.kind === 'thumb' && !f.parent)) && !f.cid && now - (f.at || 0) > 24 * 3600e3) { delFile(id); changed = true; }
  await store.sweep();
  if (changed) save();
}

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
const sentNonces = new Map();   // usuário:código → quando (evita mensagem duplicada ao reenviar)
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 12000, pingTimeout: 10000 });

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
  io.to('v:' + cid).emit('voice:peer-left', { sid });
  io.in(sid).socketsLeave('v:' + cid);
  if (!r.size) { voice.delete(cid); setTimeout(() => { if (!voice.get(cid)) roomEmptied(cid); }, 0); }
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

function voicePresence(g, uid) {
  const out = {};
  for (const c of g.channels) {
    if (c.type !== 'voice' || (uid && !canIn(g, uid, c, 'view'))) continue;
    const r = voice.get(c.id);
    out[c.id] = r ? [...r.entries()].map(([sid, p]) => ({ sid, ...p })) : [];
  }
  return out;
}
// Cada pessoa só recebe os canais que pode ver, com as permissões dela em cada um
const CH_KEYS = CH_PERMS;
function channelView(g, c, uid) {
  const P = permsIn(g, uid, c);
  const v = { id: c.id, name: c.name, type: c.type, topic: c.topic || '', cfg: c.cfg, p: Object.fromEntries(CH_KEYS.map(k => [k, !!P[k]])) };
  if (c.cat) v.cat = c.cat;
  v.priv = !!effOw(g, c).everyone?.d?.view;
  v.synced = !Object.keys(c.ow || {}).length;
  if (P.manageChannels) v.ow = c.ow || {};
  return v;
}
function groupView(g, uid) {
  const chans = g.channels.filter(c => !uid || canIn(g, uid, c, 'view'));
  const manage = uid && can(g, uid, 'manageChannels');
  return {
    id: g.id, name: g.name, ownerId: g.ownerId, invite: g.invite,
    channels: uid ? chans.map(c => channelView(g, c, uid)) : g.channels,
    desc: g.desc, banner: g.banner, created: g.created, maxUploadMB: g.maxUploadMB || 0,
    iv: (g.icon || g.iconId || g.iconStillId) ? (g.iv || 1) : 0, igif: !!g.iconGif,
    bv: g.bannerStillId ? (g.bv || 1) : 0, bgif: !!g.bannerGif,
    roles: g.roles, everyone: g.everyone, memberRoles: g.memberRoles, joined: g.joined,
    categories: g.categories.filter(k => manage || chans.some(c => c.cat === k.id))
      .map(k => ({ id: k.id, name: k.name, ...(manage ? { ow: k.ow || {} } : {}) })),
    sys: g.sys,
    emojis: g.emojis.map(e => ({ id: e.id, name: e.name })),
    members: g.members.map(m => db.users[m]).filter(Boolean).map(memberView),
    voice: voicePresence(g, uid),
  };
}
// Mensagem do sistema (ex.: "Fulano entrou no grupo")
function sysMessage(g, text) {
  const c = g.channels.find(x => x.id === g.sys.channel && x.type === 'text') || g.channels.find(x => x.type === 'text');
  if (!c) return;
  const msg = { id: newId(), sys: true, text, ts: Date.now() };
  pushMsg(c.id, msg);
  toChannel(g, c, 'message', { groupId: g.id, channelId: c.id, msg });
}
// Aviso dentro da conversa privada ("Ligação recusada", etc.)
function dmSys(channelId, text) {
  const pr = dmPeers(channelId);
  if (!pr) return;
  const msg = { id: newId(), sys: true, text, ts: Date.now() };
  pushMsg(channelId, msg);
  for (const x of pr) {
    io.to('u:' + x).emit('message', { channelId, msg, dm: true });
    io.to('u:' + x).emit('dm:update', { entry: dmEntry(x, pr.find(y => y !== x) || x) });
  }
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
    if (!r.size) { voice.delete(c.id); setTimeout(() => roomEmptied(c.id), 0); }
  }
  io.in('u:' + uid).socketsLeave('g:' + g.id);
  io.to('u:' + uid).emit('group:removed', { groupId: g.id, reason });
  emitGroup(g);
}
function emitGroup(g) {
  for (const m of g.members) io.to('u:' + m).emit('group:update', groupView(g, m));
  refreshVoice(g);
}
function emitPresence(g) {
  for (const m of g.members) io.to('u:' + m).emit('voice:presence', { groupId: g.id, voice: voicePresence(g, m) });
}
// Manda um evento de canal só para quem pode ver esse canal
function toChannel(g, c, ev, payload, exceptUid) {
  for (const m of g.members) if (m !== exceptUid && canIn(g, m, c, 'view')) io.to('u:' + m).emit(ev, payload);
}
// Depois de mudar permissões: tira da sala quem perdeu acesso e atualiza o que cada um pode fazer na voz
function refreshVoice(g) {
  let changed = false;
  for (const c of g.channels) {
    if (c.type !== 'voice') continue;
    const r = voice.get(c.id);
    if (!r) continue;
    for (const [sid, p] of [...r.entries()]) {
      const P = permsIn(g, p.userId, c);
      if (!g.members.includes(p.userId) || !P.view || !P.connect) {
        io.to(sid).emit('voice:force', { action: 'disconnect', by: 'as permissões do canal' });
        dropVoice(c.id, sid);
        changed = true;
        continue;
      }
      const vp = { speak: !!P.speak, video: !!P.video, stream: !!P.stream, useVAD: !!P.useVAD };
      io.to(sid).emit('voice:perms', { channelId: c.id, perms: vp, cfg: c.cfg });
      let st = false;
      if (!vp.speak && p.mic) { p.mic = false; st = true; }
      if (!vp.video && p.cam) { p.cam = false; st = true; }
      if (!vp.stream && p.screen) { p.screen = false; st = true; }
      if (st) { io.to('v:' + c.id).emit('voice:state', { sid, ...p }); changed = true; }
    }
  }
  if (changed) emitPresence(g);
}
// Sala temporária: some quando a última pessoa sai
function roomEmptied(cid) {
  const f = findChannel(cid);
  if (!f || f.c.type !== 'voice' || !f.c.cfg?.temp) return;
  if (f.g.channels.length <= 1) return;
  f.g.channels = f.g.channels.filter(c => c.id !== cid);
  dropChannelMsgs(cid);
  f.g.audit.unshift({ ts: Date.now(), by: 'Nexo', text: `apagou a sala temporária ${f.c.name} (ficou vazia)` });
  save();
  emitGroup(f.g);
}

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
// Quem pode abrir conversa com quem: amigos, quem divide um grupo
// ou quem já tem uma conversa aberta. Não existe busca de desconhecidos.
const shareGroup = (a, b) => Object.values(db.groups).some(g => g.members.includes(a) && g.members.includes(b));
const hasDm = (a, b) => (db.dms[a] || []).includes(b);
function canDm(a, b) {
  if (a === b || !db.users[b]) return false;
  return areFriends(a, b) || shareGroup(a, b) || hasDm(a, b);
}

function channelCtx(cid, uid) {
  const p = dmPeers(cid);
  if (p) {
    if (!p.includes(uid)) return null;
    const other = p.find(x => x !== uid) || uid;
    return canDm(uid, other) ? { dm: true, peers: p, other } : null;
  }
  const f = findChannel(cid);
  return f && f.g.members.includes(uid) && canIn(f.g, uid, f.c, 'view') ? { g: f.g, c: f.c } : null;
}
function emitCtx(ctx, ev, payload) {
  if (ctx.dm) for (const p of ctx.peers) io.to('u:' + p).emit(ev, payload);
  else toChannel(ctx.g, ctx.c, ev, payload);
}
// Garante que a conversa apareça na lista dos dois
function linkDm(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const l = (db.dms[x] ||= []);
    if (!l.includes(y)) l.push(y);
  }
}
// ------------------------------------------------------------------
// Mensagens não lidas (guardadas no servidor: valem em todos os aparelhos
// e contam o que chegou enquanto a pessoa estava offline)
// ------------------------------------------------------------------
function readsOf(uid) {
  // primeira vez: começa a contar de agora (não marca o histórico antigo como novo)
  return (db.reads[uid] ||= { _since: Date.now() });
}
function lastRead(uid, cid, g) {
  const r = readsOf(uid);
  if (r[cid]) return r[cid];
  return Math.max(r._since || 0, g?.joined?.[uid] || 0);
}
function countUnread(uid, cid, since, mentionable) {
  const arr = db.messages[cid] || [];
  let n = 0, m = 0;
  for (let i = arr.length - 1; i >= 0 && n < 100; i--) {
    const x = arr[i];
    if (x.ts <= since) break;
    if (x.userId === uid) continue;
    if (x.sys && mentionable) continue;          // "fulano entrou no grupo" não conta
    n++;
    if (mentionable && x.mentions?.includes(uid)) m++;
  }
  return [n, m];
}
function unreadFor(uid) {
  const out = {};
  for (const g of Object.values(db.groups)) {
    if (!g.members.includes(uid)) continue;
    for (const c of g.channels) {
      if (c.type !== 'text' || !canIn(g, uid, c, 'view') || !canIn(g, uid, c, 'readHistory')) continue;
      const [n, m] = countUnread(uid, c.id, lastRead(uid, c.id, g), true);
      if (n) out[c.id] = [n, m];
    }
  }
  for (const other of db.dms[uid] || []) {
    const cid = dmId(uid, other);
    const [n] = countUnread(uid, cid, lastRead(uid, cid), false);
    if (n) out[cid] = [n, n];
  }
  return out;
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
  const uid = sessionUser(socket.handshake.auth?.token);
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
  const wasPres = visPresence(u.id);
  online.set(u.id, (online.get(u.id) || 0) + 1);
  (awake.get(u.id) || awake.set(u.id, new Set()).get(u.id)).add(socket.id);
  if (online.get(u.id) === 1 || visPresence(u.id) !== wasPres) broadcastPresence(u.id, online.get(u.id) === 1 ? socket : undefined);
  // o aparelho avisa quando a pessoa para de mexer nele (e quando volta)
  socket.on('presence:away', ({ away } = {}) => {
    const before = visPresence(u.id);
    const set = awake.get(u.id) || awake.set(u.id, new Set()).get(u.id);
    if (away) set.delete(socket.id); else set.add(socket.id);
    if (visPresence(u.id) !== before) broadcastPresence(u.id);
    socket.emit('presence:self', { away: isAway(u.id) });
  });
  socket.emit('init', {
    user: { ...publicUser(u), presence: u.presence || 'online' },
    groups: mine.map(g => groupView(g, u.id)),
    dms: (db.dms[u.id] || []).map(o => dmEntry(u.id, o)).filter(Boolean),
    friends: friendState(u.id),
    unread: unreadFor(u.id),
    ver: APP_VERSION,
  });

  // Marcou como lido: vale para todos os aparelhos da pessoa
  socket.on('read', ({ channelId } = {}) => {
    if (typeof channelId !== 'string' || channelId.length > 80) return;
    const ok = dmPeers(channelId)?.includes(u.id) || findChannel(channelId)?.g.members.includes(u.id);
    if (!ok) return;
    readsOf(u.id)[channelId] = Date.now();
    save();
    socket.to('u:' + u.id).emit('read', { channelId });
  });

  // ---------- Conta ----------
  const myToken = socket.handshake.auth?.token;
  async function kickOtherDevices() {
    for (const so of await io.in('u:' + u.id).fetchSockets()) {
      if (so.id === socket.id) continue;
      so.emit('session:ended');
      so.disconnect(true);
    }
  }
  let pwTries = [];
  socket.on('account:password', ({ current, next } = {}, cb) => {
    const now = Date.now();
    pwTries = pwTries.filter(t => now - t < 10 * 60_000);
    if (pwTries.length >= 5) return reply(cb, { error: 'Muitas tentativas. Espere alguns minutos.' });
    const a = Buffer.from(hashPass(String(current || ''), u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { pwTries.push(now); return reply(cb, { error: 'A senha atual está errada.' }); }
    next = String(next || '');
    if (next.length < 6) return reply(cb, { error: 'A senha nova precisa ter pelo menos 6 caracteres.' });
    if (next.length > 200) return reply(cb, { error: 'Senha longa demais.' });
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPass(next, u.salt);
    dropSessions(u.id, myToken);      // os outros aparelhos precisam entrar de novo
    kickOtherDevices();
    reply(cb, { ok: true });
  });
  socket.on('account:logout-others', (_, cb) => {
    dropSessions(u.id, myToken);
    kickOtherDevices();
    reply(cb, { ok: true });
  });
  socket.on('account:sessions', (_, cb) => {
    const n = Object.values(db.tokens).filter(v => (typeof v === 'string' ? v : v.uid) === u.id).length;
    reply(cb, { sessions: n });
  });

  // ---------- Perfil ----------
  // Confere se o id veio mesmo de um upload de imagem
  const imgFile = (id, gifOk) => {
    const f = id && db.files[id];
    if (!f || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.mime)) return null;
    if (!gifOk && f.mime === 'image/gif') return null;
    return f;
  };
  const dropFiles = (...ids) => ids.forEach(x => { if (x) delFile(x); });

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
    if (d.avatarId || d.avatarStillId) {
      if (!imgFile(d.avatarId, true) || !imgFile(d.avatarStillId, false))
        return reply(cb, { error: 'Imagem inválida. Tente outra.' });
      dropFiles(u.avId, u.avStillId);
      delete u.avatar;
      u.avId = d.avatarId;
      u.avStillId = d.avatarStillId;
      u.avGif = !!d.avatarGif;
      u.av = (u.av || 0) + 1;
    } else if (d.avatar === null) { dropFiles(u.avId, u.avStillId); delete u.avatar; delete u.avId; delete u.avStillId; delete u.avGif; }
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
    if (Object.values(db.groups).filter(x => x.ownerId === u.id).length >= 100) return reply(cb, { error: 'Você já criou o máximo de 100 grupos.' });
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
    reply(cb, { group: groupView(g, u.id) });
  });

  let badInvites = [];
  socket.on('group:join', ({ invite } = {}, cb) => {
    const now = Date.now();
    badInvites = badInvites.filter(t => now - t < 5 * 60_000);
    if (badInvites.length >= 10) return reply(cb, { error: 'Muitos convites errados. Espere alguns minutos.' });
    invite = String(invite || '').trim().toLowerCase().replace(/^.*convite=/, '').slice(0, 40);
    const g = invite && Object.values(db.groups).find(x => x.invite === invite);
    if (!g) { badInvites.push(now); return reply(cb, { error: 'Convite inválido.' }); }
    if (g.bans.some(b => b.id === u.id)) return reply(cb, { error: 'Você foi banido deste grupo.' });
    if (!g.members.includes(u.id)) {
      g.members.push(u.id);
      g.joined[u.id] = Date.now();
      if (g.sys.welcome) sysMessage(g, `${u.username} entrou no grupo. Boas-vindas! 👋`);
      save();
    }
    io.in('u:' + u.id).socketsJoin('g:' + g.id);
    emitGroup(g);
    reply(cb, { group: groupView(g, u.id) });
  });

  socket.on('group:leave', ({ groupId } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || !g.members.includes(u.id)) return reply(cb, { error: 'Grupo não encontrado.' });
    if (g.ownerId === u.id) {
      // Dono saindo = apaga o grupo
      io.to('g:' + g.id).emit('group:removed', { groupId: g.id });
      io.in('g:' + g.id).socketsLeave('g:' + g.id);
      for (const c of g.channels) dropChannelMsgs(c.id);
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
    if (!q) return reply(cb, { error: 'Digite o nome de usuário ou o ID.' });
    const other = Object.values(db.users).find(x => x.username.toLowerCase() === q || x.id === q);
    if (!other) return reply(cb, { error: 'Não achei ninguém com esse nome de usuário ou ID. Confira se está escrito igualzinho.' });
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
    if (!canDm(u.id, userId))
      return reply(cb, { error: 'Você só pode conversar com amigos ou com quem está em um grupo seu. Envie um pedido de amizade primeiro.' });
    linkDm(u.id, userId);
    save();
    io.to('u:' + userId).emit('dm:update', { entry: dmEntry(userId, u.id) });
    reply(cb, { channelId: dmId(u.id, userId), user: memberView(other), inCall: voiceRoomView(dmId(u.id, userId)).length > 0, messages: (db.messages[dmId(u.id, userId)] || []).slice(-80), hasMore: (db.messages[dmId(u.id, userId)] || []).length > 80 });
  });

  socket.on('dm:close', ({ userId } = {}, cb) => {
    db.dms[u.id] = (db.dms[u.id] || []).filter(x => x !== userId);
    save();
    reply(cb, { ok: true });
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
    if ('maxUploadMB' in d) { const v = Math.round(Number(d.maxUploadMB)); g.maxUploadMB = v > 0 ? Math.min(v, store.maxBytes / MBY) : 0; }
    if (d.banner === '' || isHex(d.banner)) g.banner = d.banner;
    if (d.iconId || d.iconStillId) {
      if (!imgFile(d.iconId, true) || !imgFile(d.iconStillId, false))
        return reply(cb, { error: 'Imagem inválida. Tente outra.' });
      dropFiles(g.iconId, g.iconStillId);
      delete g.icon;
      g.iconId = d.iconId; g.iconStillId = d.iconStillId; g.iconGif = !!d.iconGif;
      g.iv = (g.iv || 0) + 1;
    }
    if (d.bannerId || d.bannerStillId) {
      if (!imgFile(d.bannerId, true) || !imgFile(d.bannerStillId, false))
        return reply(cb, { error: 'Imagem inválida. Tente outra.' });
      dropFiles(g.bannerId, g.bannerStillId);
      g.bannerId = d.bannerId; g.bannerStillId = d.bannerStillId; g.bannerGif = !!d.bannerGif;
      g.bv = (g.bv || 0) + 1;
    }
    if (d.bannerImg === null) { dropFiles(g.bannerId, g.bannerStillId); delete g.bannerId; delete g.bannerStillId; delete g.bannerGif; }
    if (d.icon === null) { dropFiles(g.iconId, g.iconStillId); delete g.icon; delete g.iconId; delete g.iconStillId; delete g.iconGif; }
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

  // Quem pode mexer nas permissões de um canal/categoria e o que pode mudar:
  // precisa de "Gerenciar cargos" + "Gerenciar canais", só cargos abaixo do seu,
  // e só pode permitir/negar permissões que você mesmo tem.
  function owChangeError(g, oldOw, newOw, P) {
    if (g.ownerId === u.id) return null;
    if (!can(g, u.id, 'manageRoles')) return 'Para mudar permissões você precisa de "Gerenciar cargos".';
    const me = rank(g, u.id);
    const keys = new Set([...Object.keys(oldOw || {}), ...Object.keys(newOw || {})]);
    for (const key of keys) {
      const o = oldOw?.[key] || { a: {}, d: {} }, n = newOw?.[key] || { a: {}, d: {} };
      const changed = CH_PERMS.filter(k => !!o.a?.[k] !== !!n.a?.[k] || !!o.d?.[k] !== !!n.d?.[k]);
      if (!changed.length) continue;
      if (key.startsWith('r:')) {
        const i = g.roles.findIndex(r => 'r:' + r.id === key);
        if (i >= 0 && me >= i) return `O cargo ${g.roles[i].name} está no mesmo nível ou acima do seu.`;
      } else if (key.startsWith('m:')) {
        const t = key.slice(2);
        if (t !== u.id && (t === g.ownerId || rank(g, t) <= me)) return `${db.users[t]?.username || 'Essa pessoa'} está no mesmo nível ou acima do seu.`;
      }
      const lacking = changed.find(k => !P.admin && !P[k]);
      if (lacking) return `Você não pode mudar uma permissão que não tem ("${lacking}").`;
    }
    return null;
  }
  const chLabel = c => (c.type === 'voice' ? '🔊' : '#') + c.name;
  const cleanChName = (type, name) => { name = cleanName(name, 32); return type === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name; };

  socket.on('category:edit', ({ groupId, id, name, ow } = {}, cb) => {
    const g = G(groupId, 'manageChannels'); if (!g) return reply(cb, DENY);
    const k = g.categories.find(x => x.id === id); if (!k) return reply(cb, { error: 'Categoria não encontrada.' });
    const parts = [];
    if (typeof name === 'string') {
      const n = cleanName(name, 32);
      if (!n) return reply(cb, { error: 'Dê um nome à categoria.' });
      if (n !== k.name) { parts.push(`nome: ${k.name} → ${n}`); k.name = n; }
    }
    if (ow !== undefined) {
      const nw = cleanOw(g, ow);
      const err = owChangeError(g, k.ow, nw, permsOf(g, u.id));
      if (err) return reply(cb, { error: err });
      if (JSON.stringify(nw) !== JSON.stringify(k.ow || {})) { k.ow = nw; parts.push('permissões'); }
    }
    if (parts.length) audit(g, u, `editou a categoria ${k.name} (${parts.join(', ')})`);
    done(g, cb);
  });

  socket.on('category:move', ({ groupId, id, dir, before } = {}, cb) => {
    const g = G(groupId, 'manageChannels'); if (!g) return reply(cb, DENY);
    const i = g.categories.findIndex(x => x.id === id);
    if (i < 0) return reply(cb, { error: 'Categoria não encontrada.' });
    const [k] = g.categories.splice(i, 1);
    let j;
    if (before !== undefined) { j = before ? g.categories.findIndex(x => x.id === before) : -1; if (j < 0) j = g.categories.length; }
    else j = Math.max(0, Math.min(g.categories.length, i + (dir === 'up' ? -1 : 1)));
    g.categories.splice(j, 0, k);
    done(g, cb);
  });

  // Sincronizar: os canais da categoria passam a herdar tudo dela
  socket.on('category:sync', ({ groupId, id } = {}, cb) => {
    const g = G(groupId, 'manageChannels'); if (!g) return reply(cb, DENY);
    const k = g.categories.find(x => x.id === id); if (!k) return reply(cb, { error: 'Categoria não encontrada.' });
    for (const c of g.channels.filter(c => c.cat === id)) {
      const err = owChangeError(g, c.ow, {}, permsIn(g, u.id, c));
      if (err) return reply(cb, { error: `#${c.name}: ${err}` });
    }
    for (const c of g.channels) if (c.cat === id) c.ow = {};
    audit(g, u, `sincronizou as permissões dos canais com a categoria ${k.name}`);
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
    // Permissão que não veio no pedido: as novas (v20) ficam como estavam, para um app antigo
    // não tirar sem querer o "Ver canais" de todo mundo; as antigas seguem a regra de antes.
    const NEW_PERMS = ['view', 'readHistory', 'attachFiles', 'embedLinks', 'speak', 'stream', 'useVAD'];
    const merge = old => {
      const out = {};
      for (const k of PERMS) {
        const keep = !perms || !mine[k] || (NEW_PERMS.includes(k) && !(k in perms));
        if (keep ? old[k] : perms[k] === true) out[k] = true;
      }
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
  socket.on('channel:create', ({ groupId, name, type, cat, topic, priv, roles, cfg } = {}, cb) => {
    const g = db.groups[groupId];
    if (!g || !g.members.includes(u.id) || !can(g, u.id, 'manageChannels')) return reply(cb, { error: 'Você não tem permissão para criar canais.' });
    type = type === 'voice' ? 'voice' : 'text';
    name = cleanChName(type, name);
    if (!name) return reply(cb, { error: 'Dê um nome ao canal.' });
    if (g.channels.length >= 50) return reply(cb, { error: 'Limite de canais atingido.' });
    const c = { id: newId(), name, type, topic: cleanName(topic, 300), cfg: cleanCfg(type, null, cfg), ow: {} };
    if (g.categories.some(x => x.id === cat)) c.cat = cat;
    if (priv) {
      // privado: @everyone não vê; quem criou e os cargos escolhidos veem
      const vis = type === 'voice' ? { view: 1, connect: 1 } : { view: 1 };
      c.ow.everyone = { a: {}, d: { view: 1 } };
      c.ow['m:' + u.id] = { a: { ...vis }, d: {} };
      for (const rid of Array.isArray(roles) ? roles : []) if (g.roles.some(r => r.id === rid)) c.ow['r:' + rid] = { a: { ...vis }, d: {} };
    }
    audit(g, u, `criou o canal ${chLabel(c)}${priv ? ' (privado)' : ''}`);
    g.channels.push(c);
    save();
    emitGroup(g);
    reply(cb, { channel: channelView(g, c, u.id) });
  });

  // Editar canal: nome, tópico, categoria, configurações e permissões, tudo de uma vez
  socket.on('channel:update', ({ channelId, name, topic, cat, cfg, ow } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id)) return reply(cb, { error: 'Canal não encontrado.' });
    const g = f.g, c = f.c, P = permsIn(g, u.id, c);
    if (!P.manageChannels) return reply(cb, { error: 'Você não tem permissão para editar este canal.' });
    const parts = [];
    if (typeof name === 'string') {
      const n = cleanChName(c.type, name);
      if (!n) return reply(cb, { error: 'Dê um nome ao canal.' });
      if (n !== c.name) { parts.push(`nome: ${c.name} → ${n}`); c.name = n; }
    }
    if (typeof topic === 'string') { const t = cleanName(topic, 300); if (t !== (c.topic || '')) { c.topic = t; parts.push('descrição'); } }
    if (cat !== undefined) {
      const nc = cat && g.categories.some(x => x.id === cat) ? cat : null;
      if ((c.cat || null) !== nc) {
        parts.push(`categoria: ${g.categories.find(x => x.id === c.cat)?.name || 'nenhuma'} → ${g.categories.find(x => x.id === nc)?.name || 'nenhuma'}`);
        if (nc) c.cat = nc; else delete c.cat;
      }
    }
    if (cfg !== undefined) {
      const nc = cleanCfg(c.type, c.cfg, cfg);
      const diff = Object.keys(nc).filter(k => nc[k] !== c.cfg?.[k]);
      if (diff.length) { c.cfg = nc; parts.push('configurações: ' + diff.join(', ')); }
    }
    if (ow !== undefined) {
      const nw = cleanOw(g, ow);
      const err = owChangeError(g, c.ow, nw, P);
      if (err) return reply(cb, { error: err });
      if (JSON.stringify(nw) !== JSON.stringify(c.ow || {})) { c.ow = nw; parts.push('permissões'); }
    }
    if (parts.length) audit(g, u, `editou o canal ${chLabel(c)} (${parts.join('; ')})`);
    save();
    emitGroup(g);
    reply(cb, { ok: true, channel: canIn(g, u.id, c, 'view') ? channelView(g, c, u.id) : null });
  });

  // O canal volta a herdar tudo da categoria
  socket.on('channel:sync', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id)) return reply(cb, { error: 'Canal não encontrado.' });
    const P = permsIn(f.g, u.id, f.c);
    if (!P.manageChannels) return reply(cb, { error: 'Você não tem permissão para editar este canal.' });
    if (!f.c.cat) return reply(cb, { error: 'Este canal não está em uma categoria.' });
    const err = owChangeError(f.g, f.c.ow, {}, P);
    if (err) return reply(cb, { error: err });
    f.c.ow = {};
    audit(f.g, u, `sincronizou as permissões de ${chLabel(f.c)} com a categoria`);
    done(f.g, cb);
  });

  // Duplicar: cria um canal novo com as mesmas configurações e permissões
  socket.on('channel:clone', ({ channelId, name } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id)) return reply(cb, { error: 'Canal não encontrado.' });
    const g = f.g;
    if (!canIn(g, u.id, f.c, 'manageChannels') || !can(g, u.id, 'manageChannels')) return reply(cb, { error: 'Você não tem permissão para criar canais.' });
    if (g.channels.length >= 50) return reply(cb, { error: 'Limite de canais atingido.' });
    const n = cleanChName(f.c.type, name || (f.c.type === 'text' ? f.c.name + '-copia' : f.c.name + ' (cópia)'));
    const c = { id: newId(), name: n || f.c.name, type: f.c.type, topic: f.c.topic || '', cfg: { ...f.c.cfg }, ow: JSON.parse(JSON.stringify(f.c.ow || {})) };
    if (f.c.cat) c.cat = f.c.cat;
    g.channels.splice(g.channels.indexOf(f.c) + 1, 0, c);
    audit(g, u, `duplicou ${chLabel(f.c)} como ${chLabel(c)}`);
    save();
    emitGroup(g);
    reply(cb, { channel: channelView(g, c, u.id) });
  });

  socket.on('channel:delete', ({ channelId } = {}, cb) => {
    const f = findChannel(channelId);
    if (!f || !f.g.members.includes(u.id) || !canIn(f.g, u.id, f.c, 'manageChannels')) return reply(cb, { error: 'Sem permissão.' });
    if (f.g.channels.length <= 1) return reply(cb, { error: 'O grupo precisa ter pelo menos um canal.' });
    audit(f.g, u, `excluiu o canal ${chLabel(f.c)}`);
    for (const sid of [...(voice.get(channelId)?.keys() || [])]) { io.to(sid).emit('voice:force', { action: 'disconnect', by: 'a exclusão da sala' }); dropVoice(channelId, sid); }
    f.g.channels = f.g.channels.filter(c => c.id !== channelId);
    if (f.g.sys.channel === channelId) f.g.sys.channel = null;
    dropChannelMsgs(channelId);
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
    if (!canIn(g, u.id, c, 'manageChannels')) return reply(cb, { error: 'Você não tem permissão para mover este canal.' });
    const oldCat = c.cat || null;
    g.channels.splice(i, 1);
    if (cat && g.categories.some(x => x.id === cat)) c.cat = cat; else delete c.cat;
    if ((c.cat || null) !== oldCat) audit(g, u, `moveu ${chLabel(c)} para ${g.categories.find(x => x.id === c.cat)?.name || 'sem categoria'}`);
    const j = before ? g.channels.findIndex(x => x.id === before) : -1;
    if (j < 0) g.channels.push(c); else g.channels.splice(j, 0, c);
    save();
    emitGroup(g);
    reply(cb, { ok: true });
  });

  // ---------- Mensagens ----------
  // O que a pessoa pode ler do histórico deste canal
  function visibleHistory(ctx, uid, cid) {
    const all = db.messages[cid] || [];
    if (ctx.dm) return all;
    const P = permsIn(ctx.g, uid, ctx.c);
    if (!P.readHistory) return [];
    if (ctx.c.cfg?.newHistory === false && !P.manageMessages) {
      const since = ctx.g.joined[uid] || 0;
      return all.filter(m => m.ts >= since);
    }
    return all;
  }
  // Sem nada: as 80 mais recentes. before: 60 anteriores a uma mensagem.
  // around: a partir de um pouco antes da mensagem até a mais recente (para "ir até").
  socket.on('channel:history', ({ channelId, before, around } = {}, cb) => {
    const hctx = channelCtx(channelId, u.id);
    if (!hctx) return reply(cb, { error: 'Canal não encontrado.' });
    const all = visibleHistory(hctx, u.id, channelId);
    let start, end = all.length;
    if (around) {
      const i = all.findIndex(m => m.id === around);
      if (i < 0) return reply(cb, { error: 'Essa mensagem não existe mais.' });
      start = Math.max(0, i - 25);
    } else {
      if (before) { const i = all.findIndex(m => m.id === before); if (i >= 0) end = i; }
      start = Math.max(0, end - (before ? 60 : 80));
    }
    reply(cb, { messages: all.slice(start, end), hasMore: start > 0 });
  });

  // ---------- Pesquisa de mensagens ----------
  // Procura só nos lugares onde a pessoa pode ler: canais de texto dos grupos dela e as conversas privadas.
  socket.on('message:search', ({ query, groupId, channelId } = {}, cb) => {
    const q = fold(String(query || '').trim()).slice(0, 100);
    if (q.length < 2) return reply(cb, { error: 'Digite pelo menos 2 letras.' });
    const places = [];
    if (channelId) {
      const ctx = channelCtx(channelId, u.id);
      if (!ctx) return reply(cb, { error: 'Canal não encontrado.' });
      places.push({ cid: channelId, ctx });
    } else {
      for (const g of Object.values(db.groups)) {
        if (!g.members.includes(u.id) || (groupId && groupId !== '@me' && g.id !== groupId)) continue;
        if (groupId === '@me') continue;
        for (const c of g.channels) if (c.type === 'text' && canIn(g, u.id, c, 'view')) places.push({ cid: c.id, ctx: { g, c } });
      }
      if (!groupId || groupId === '@me') {
        for (const other of db.dms[u.id] || []) {
          const cid = dmId(u.id, other);
          const ctx = channelCtx(cid, u.id);
          if (ctx) places.push({ cid, ctx });
        }
      }
    }
    const hits = [];
    for (const { cid, ctx } of places) {
      for (const m of visibleHistory(ctx, u.id, cid)) {
        if (m.sys) continue;
        const who = db.users[m.userId];
        const hay = fold(`${m.text || ''} ${m.att?.name || ''} ${who?.username || m.username} ${who?.display || ''}`);
        if (!hay.includes(q)) continue;
        hits.push({
          channelId: cid, groupId: ctx.g?.id || null, place: ctx.dm ? null : `${ctx.g.name} › #${ctx.c.name}`,
          dmWith: ctx.dm ? ctx.other : null,
          msg: { id: m.id, userId: m.userId, username: m.username, color: m.color, text: (m.text || '').slice(0, 300), att: m.att ? { name: m.att.name, mime: m.att.mime } : null, ts: m.ts },
        });
      }
    }
    hits.sort((a, b) => b.msg.ts - a.msg.ts);
    reply(cb, { results: hits.slice(0, 40), total: hits.length });
  });

  // ---------- "Fulano está digitando…" ----------
  socket.on('typing', ({ channelId } = {}) => {
    const now = Date.now();
    if (now - lastTyping < 2000) return;
    lastTyping = now;
    const ctx = channelCtx(channelId, u.id);
    if (!ctx || (ctx.c && ctx.c.type !== 'text')) return;
    const data = { channelId, userId: u.id };
    if (ctx.dm) io.to('u:' + ctx.other).emit('typing', data);
    else if (canIn(ctx.g, u.id, ctx.c, 'sendMessages')) toChannel(ctx.g, ctx.c, 'typing', data, u.id);
  });

  let lastMsgs = [];
  let lastTyping = 0;
  socket.on('message:send', ({ channelId, text, replyTo, att, nonce } = {}, cb) => {
    if (typeof nonce === 'string' && nonce.length <= 40) {
      const k = u.id + ':' + nonce;
      if (sentNonces.has(k)) return reply(cb, { ok: true, dup: true });
      const _cb = cb;
      cb = r => { if (r && !r.error) { sentNonces.set(k, Date.now()); if (sentNonces.size > 5000) for (const [x, t] of sentNonces) { if (Date.now() - t > 15 * 60e3) sentNonces.delete(x); } } return typeof _cb === 'function' && _cb(r); };
    }
    const ctx = channelCtx(channelId, u.id);
    if (!ctx || (ctx.c && ctx.c.type !== 'text')) return reply(cb, { error: 'Canal não encontrado.' });
    text = String(text || '').trim();
    const file = att && db.files[att.id] ? { id: att.id, ...db.files[att.id] } : null;
    if (att && !file) return reply(cb, { error: 'O arquivo não foi encontrado. Tente enviar de novo.' });
    if (file && file.uid && file.uid !== u.id) return reply(cb, { error: 'Esse arquivo não é seu.' });
    if (file && file.cid && file.cid !== channelId) return reply(cb, { error: 'Esse arquivo já foi enviado em outra conversa.' });
    if (file && file.size > uploadLimit(u.id, channelId)) return reply(cb, { error: `O limite de arquivo aqui é ${fmtMB(uploadLimit(u.id, channelId))}.` });
    if (!text && !file) return reply(cb, { error: 'Mensagem vazia.' });
    const now = Date.now();
    if (ctx.g) {
      // regras do canal (conferidas aqui no servidor: não dá para contornar mexendo no app)
      const P = permsIn(ctx.g, u.id, ctx.c), cfg = ctx.c.cfg || TEXT_CFG;
      if (!P.sendMessages) return reply(cb, { error: 'Você não tem permissão para enviar mensagens neste canal.' });
      if (text.length > cfg.maxLen) return reply(cb, { error: `Este canal aceita no máximo ${cfg.maxLen} caracteres por mensagem.` });
      if (file && !P.attachFiles) return reply(cb, { error: 'Não é permitido enviar arquivos neste canal.' });
      if (!P.embedLinks && /(https?:\/\/|www\.)\S+/i.test(text)) return reply(cb, { error: 'Não é permitido enviar links neste canal.' });
      if (replyTo && cfg.replies === false && !P.manageMessages) return reply(cb, { error: 'Respostas estão desativadas neste canal.' });
      if (cfg.slow && !P.manageMessages && !P.manageChannels) {
        const key = u.id + ':' + ctx.c.id, last = slowLast.get(key) || 0, wait = Math.ceil((last + cfg.slow * 1000 - now) / 1000);
        if (wait > 0) return reply(cb, { error: `Modo lento: espere ${wait} s para mandar outra mensagem.`, slow: wait });
        slowLast.set(key, now);
      }
    }
    text = text.slice(0, 2000);
    lastMsgs = lastMsgs.filter(t => now - t < 5000);
    if (lastMsgs.length >= 8) return reply(cb, { error: 'Calma! Você está enviando rápido demais.' });
    lastMsgs.push(now);
    lastTyping = 0;   // a próxima digitação já avisa na hora
    const arr = (db.messages[channelId] ||= []);
    const msg = { id: newId(), userId: u.id, username: u.username, color: u.color, text, ts: now };
    if (replyTo) {
      const r = arr.find(m => m.id === replyTo);
      if (r) msg.reply = { id: r.id, username: r.username, color: r.color, text: (r.text || '📎 ' + (r.att?.name || 'arquivo')).slice(0, 120) };
    }
    const mentions = findMentions(text, ctx.dm ? ctx.peers : ctx.g.members).filter(x => x !== u.id);
    if (mentions.length) msg.mentions = mentions;
    if (file) {
      db.files[file.id].cid = channelId;                  // agora só quem lê esta conversa abre o arquivo
      if (file.thumb && db.files[file.thumb]) db.files[file.thumb].parent = file.id;
      msg.att = attView(file.id);
      if (!msg.att.w && Number.isFinite(att.w) && Number.isFinite(att.h)) { msg.att.w = Math.round(att.w); msg.att.h = Math.round(att.h); }
    }
    pushMsg(channelId, msg);
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
    if (l.g) {
      const P = permsIn(l.g, u.id, l.ctx.c);
      if (l.ctx.c.cfg?.edit === false && !P.manageMessages) return reply(cb, { error: 'A edição de mensagens está desativada neste canal.' });
      if (!P.sendMessages) return reply(cb, { error: 'Você não pode escrever neste canal.' });
      if (String(text || '').trim().length > (l.ctx.c.cfg?.maxLen || 2000)) return reply(cb, { error: `Este canal aceita no máximo ${l.ctx.c.cfg.maxLen} caracteres.` });
      if (!P.embedLinks && /(https?:\/\/|www\.)\S+/i.test(String(text || ''))) return reply(cb, { error: 'Não é permitido enviar links neste canal.' });
    }
    text = String(text || '').trim().slice(0, 2000);
    if (!text && !l.m.att) return reply(cb, { error: 'Mensagem vazia.' });
    l.m.text = text;
    l.m.edited = true;
    const mentions = findMentions(text, l.ctx.dm ? l.ctx.peers : l.g.members).filter(x => x !== u.id);
    if (mentions.length) l.m.mentions = mentions; else delete l.m.mentions;
    touchMsgs(channelId);
    emitCtx(l.ctx, 'message:edit', { channelId, id, text, mentions: l.m.mentions || [] });
    reply(cb, { ok: true });
  });

  socket.on('message:delete', ({ channelId, id } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    const modDel = l.g && canIn(l.g, u.id, l.ctx.c, 'manageMessages');
    if (l.m.userId !== u.id && !modDel) return reply(cb, { error: 'Sem permissão.' });
    if (l.m.userId === u.id && l.g && l.ctx.c.cfg?.del === false && !modDel) return reply(cb, { error: 'A exclusão de mensagens está desativada neste canal.' });
    if (l.m.userId !== u.id && l.g) audit(l.g, u, `excluiu uma mensagem de ${l.m.username || 'sistema'}`);
    l.arr.splice(l.arr.indexOf(l.m), 1);
    if (l.m.att) delFile(l.m.att.id);
    touchMsgs(channelId);
    emitCtx(l.ctx, 'message:delete', { channelId, id });
    reply(cb, { ok: true });
  });

  socket.on('message:react', ({ channelId, id, emoji } = {}, cb) => {
    const l = locate(channelId, id);
    if (!l) return reply(cb, { error: 'Mensagem não encontrada.' });
    emoji = String(emoji || '').trim();
    if (l.g && !canIn(l.g, u.id, l.ctx.c, 'addReactions')) return reply(cb, { error: 'Você não tem permissão para reagir neste canal.' });
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
    touchMsgs(channelId);
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
    if (r) { r.delete(socket.id); if (!r.size) { voice.delete(cid); setTimeout(() => { if (!voice.get(cid)) roomEmptied(cid); }, 0); } }
    socket.to('v:' + cid).emit('voice:peer-left', { sid: socket.id });
    socket.leave('v:' + cid);
    const pr = dmPeers(cid);
    // se quem estava chamando desistiu, para de tocar do outro lado
    if (pr && !voice.get(cid)) {
      for (const x of pr) io.to('u:' + x).emit('dm:ring-stop', { channelId: cid });
      if (r && !r.declined) {
        if (!r.answered) dmSys(cid, '📞 Ligação não atendida.');
        else {
          const secs = Math.round((Date.now() - (r.startedAt || Date.now())) / 1000);
          const dur = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min`;
          dmSys(cid, `📞 Ligação encerrada · ${dur}`);
        }
      }
    }
    notifyVoice(cid);
  }

  socket.on('voice:join', ({ channelId, dev } = {}, cb) => {
    const pr = dmPeers(channelId);
    let f = null;
    if (pr) {
      if (!pr.includes(u.id)) return reply(cb, { error: 'Conversa não encontrada.' });
      if (!canDm(u.id, pr.find(x => x !== u.id))) return reply(cb, { error: 'Vocês não podem se falar.' });
    } else {
      f = findChannel(channelId);
      if (!f || !f.g.members.includes(u.id) || f.c.type !== 'voice') return reply(cb, { error: 'Sala não encontrada.' });
      const P = permsIn(f.g, u.id, f.c);
      if (!P.view || !P.connect) return reply(cb, { error: 'Você não tem permissão para entrar nesta sala.' });
      const room = voice.get(channelId);
      const already = room && [...room.values()].some(x => x.userId === u.id);
      const boss = P.moveMembers || P.manageChannels;
      if (!already && f.c.cfg?.locked && !boss) return reply(cb, { error: 'Esta sala está fechada para novas pessoas.' });
      const people = room ? new Set([...room.values()].map(x => x.userId)).size : 0;
      if (!already && f.c.cfg?.limit && people >= f.c.cfg.limit && !boss) return reply(cb, { error: `Sala cheia (limite de ${f.c.cfg.limit} pessoas).` });
    }
    leaveVoice();
    const r = voice.get(channelId) || new Map();
    if (r.size >= 12) return reply(cb, { error: 'Sala cheia (máximo 12 pessoas).' });
    voice.set(channelId, r);
    const peers = [...r.entries()].map(([sid, p]) => ({ sid, ...p }));
    const dupe = [...r.values()].some(p => p.userId === u.id);   // mesma conta em outro aparelho
    const me = { userId: u.id, username: u.username, color: u.color, mic: false, cam: false, screen: false, deaf: false, fmute: false, fdeaf: false, dupe,
      dev: String(dev || '').replace(/[<>]/g, '').slice(0, 24) };
    r.set(socket.id, me);
    currentVoice = channelId;
    socket.join('v:' + channelId);
    socket.to('v:' + channelId).emit('voice:peer-joined', { sid: socket.id, ...me });
    const VP = f ? permsIn(f.g, u.id, f.c) : null;
    reply(cb, { peers, sid: socket.id, dupe, perms: VP ? { speak: !!VP.speak, video: !!VP.video, stream: !!VP.stream, useVAD: !!VP.useVAD } : null, cfg: f ? f.c.cfg : null });
    if (pr) {
      const other = pr.find(x => x !== u.id);
      // primeiro a entrar numa conversa privada = está ligando
      const alone = [...r.values()].every(x => x.userId === u.id);
      if (!alone && !r.answered) { r.answered = true; r.startedAt = Date.now(); }
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
    const r = voice.get(channelId);
    if (r) r.declined = true;
    io.to('u:' + u.id).emit('dm:ring-stop', { channelId });
    io.to('u:' + other).emit('dm:declined', { channelId, by: publicUser(u) });
    dmSys(channelId, '📞 Ligação recusada.');
    reply(cb, { ok: true });
  });

  socket.on('voice:leave', leaveVoice);

  socket.on('voice:state', (st = {}) => {
    if (!currentVoice) return;
    const p = voice.get(currentVoice)?.get(socket.id);
    if (!p) return;
    for (const k of ['mic', 'cam', 'screen', 'deaf']) if (typeof st[k] === 'boolean') p[k] = st[k];
    if (p.fmute || p.fdeaf) p.mic = false;
    const fv = dmPeers(currentVoice) ? null : findChannel(currentVoice);
    if (fv) {
      const P = permsIn(fv.g, u.id, fv.c);
      if (!P.speak) p.mic = false;
      if (!P.video) p.cam = false;
      if (!P.stream) p.screen = false;
    }
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
    const need = action === 'move' ? 'moveMembers'
      : action === 'disconnect' ? 'disconnectMembers'
      : (action === 'deafen' || action === 'undeafen') ? 'deafenMembers' : 'muteMembers';
    if (!canIn(g, u.id, f.c, need)) return reply(cb, { error: 'Você não tem permissão para isso nesta sala.' });
    if (p.userId !== u.id && (p.userId === g.ownerId || rank(g, u.id) >= rank(g, p.userId)))
      return reply(cb, { error: 'Essa pessoa está no mesmo nível ou acima do seu.' });
    const who = db.users[p.userId]?.display || p.username;
    // todos os aparelhos dessa pessoa na sala (moderar um só deixaria falar pelo outro)
    const devs = [...voice.get(cid).entries()].filter(([, x]) => x.userId === p.userId);
    if (['mute', 'unmute', 'deafen', 'undeafen'].includes(action)) io.to('v:' + cid).emit('voice:modsound', { action, userId: p.userId });
    if (action === 'mute' || action === 'unmute') {
      for (const [dsid, dp] of devs) {
        dp.fmute = action === 'mute';
        if (dp.fmute) dp.mic = false;
        io.to(dsid).emit('voice:force', { action, by: u.username });
        io.to('v:' + cid).emit('voice:state', { sid: dsid, ...dp });
      }
      audit(g, u, `${p.fmute ? 'silenciou a voz de' : 'tirou o silêncio de'} ${who} na sala ${f.c.name}`);
    } else if (action === 'deafen' || action === 'undeafen') {
      for (const [dsid, dp] of devs) {
        dp.fdeaf = action === 'deafen';
        if (dp.fdeaf) dp.mic = false;
        io.to(dsid).emit('voice:force', { action, by: u.username });
        io.to('v:' + cid).emit('voice:state', { sid: dsid, ...dp });
      }
      audit(g, u, `${p.fdeaf ? 'desativou o áudio de' : 'reativou o áudio de'} ${who} na sala ${f.c.name}`);
    } else if (action === 'disconnect') {
      for (const [dsid] of devs) { io.to(dsid).emit('voice:force', { action, by: u.username }); dropVoice(cid, dsid); }
      audit(g, u, `desconectou ${who} da sala ${f.c.name}`);
    } else if (action === 'move') {
      const dest = g.channels.find(c => c.id === to && c.type === 'voice');
      if (!dest) return reply(cb, { error: 'Sala não encontrada.' });
      if (dest.id === cid) return reply(cb, { ok: true });
      if (!canIn(g, u.id, dest, 'moveMembers')) return reply(cb, { error: 'Você não pode mover pessoas para essa sala.' });
      const TP = permsIn(g, p.userId, dest);
      if (!TP.view || !TP.connect) return reply(cb, { error: 'Essa pessoa não tem acesso a essa sala.' });
      for (const [dsid] of devs) io.to(dsid).emit('voice:force', { action, channelId: dest.id, by: u.username });
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

  // A mesma conta em vários aparelhos: um aparelho pode ligar/desligar
  // o microfone ou o áudio do outro. Só vale entre aparelhos da MESMA conta.
  socket.on('voice:self', ({ sid, action } = {}, cb) => {
    if (!currentVoice) return reply(cb, { error: 'Você não está numa chamada.' });
    const t = voice.get(currentVoice)?.get(sid);
    if (!t || t.userId !== u.id || sid === socket.id) return reply(cb, { error: 'Esse aparelho não está nesta chamada.' });
    if (!['mic-on', 'mic-off', 'deaf-on', 'deaf-off'].includes(action)) return reply(cb, { error: 'Ação inválida.' });
    io.to(sid).emit('voice:self', { action, from: voice.get(currentVoice).get(socket.id)?.dev || 'outro aparelho' });
    reply(cb, { ok: true });
  });

  // Quem quer assistir a transmissão de alguém avisa a pessoa;
  // ela só manda o vídeo da tela para quem está assistindo.
  socket.on('voice:watch', ({ to, on } = {}) => {
    if (!currentVoice || !voice.get(currentVoice)?.has(to)) return;
    io.to(to).emit('voice:watch', { from: socket.id, on: !!on });
  });

  socket.on('signal', ({ to, data } = {}) => {
    if (!currentVoice || !data) return;
    if (!voice.get(currentVoice)?.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    leaveVoice();
    const before = visPresence(u.id);
    awake.get(u.id)?.delete(socket.id);
    const n = (online.get(u.id) || 1) - 1;
    if (n > 0) { online.set(u.id, n); if (visPresence(u.id) !== before) broadcastPresence(u.id); return; }
    online.delete(u.id);
    awake.delete(u.id);
    broadcastPresence(u.id);
  });
});

// ------------------------------------------------------------------
// Retenção: apaga mensagens mais antigas que o limite do canal (de hora em hora)
function pruneRetention() {
  const now = Date.now();
  for (const g of Object.values(db.groups)) for (const c of g.channels) {
    const days = c.cfg?.retention;
    if (!days || c.type !== 'text') continue;
    const arr = db.messages[c.id];
    if (!arr?.length) continue;
    const keep = arr.filter(m => now - m.ts < days * 864e5);
    if (keep.length === arr.length) continue;
    for (const m of arr) if (!keep.includes(m) && m.att) delFile(m.att.id);
    db.messages[c.id] = keep;
    touchMsgs(c.id);
  }
}
setInterval(pruneRetention, 3600e3).unref();

setInterval(() => {
  let n = 0;
  for (const [t, v] of Object.entries(db.tokens)) if (typeof v === 'object' && Date.now() - v.at > SESSION_DAYS * 864e5) { delete db.tokens[t]; n++; }
  if (n) save();
}, 6 * 3600e3).unref();

loadDb().then(async () => {
  db.uploads ||= {};
  await store.init().catch(e => console.error('Armazenamento de arquivos:', e.message));
  console.log(`Arquivos: ${store.mode === 's3' ? 'R2/S3' : store.mode === 'disk' ? 'pasta local' : 'banco de dados (só até 8 MB)'} · limite ${Math.round(store.maxBytes / MBY)} MB`);
  // anexos antigos passam a seguir a permissão da conversa onde foram enviados
  for (const [cid, arr] of Object.entries(db.messages)) for (const m of arr || []) if (m.att?.id && db.files[m.att.id] && !db.files[m.att.id].cid) { db.files[m.att.id].cid = cid; db.files[m.att.id].kind ||= 'att'; }
  setInterval(() => sweepFiles().catch(() => {}), 3600e3).unref();
  Object.values(db.groups).forEach(ensureGroup);
  db.dms ||= {}; db.files ||= {}; db.friends ||= {}; db.freq ||= {}; db.reads ||= {};
  server.listen(PORT, () => {
    const proto = process.env.HTTPS === '1' ? 'https' : 'http';
    console.log(`Nexo rodando em ${proto}://localhost:${PORT}`);
  });
}).catch(e => { console.error('Falha ao iniciar', e); process.exit(1); });

process.on('SIGTERM', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
process.on('SIGINT', async () => { clearTimeout(saveTimer); await flush(); process.exit(0); });
