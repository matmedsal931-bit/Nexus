'use strict';
/* =====================================================================
   Nexo - armazenamento de arquivos grandes (vídeos)
   ---------------------------------------------------------------------
   Três modos, escolhidos sozinhos pelas variáveis de ambiente:

   s3   → Cloudflare R2 (ou qualquer S3). O NAVEGADOR envia as partes direto
          para o R2 com links assinados (o servidor não segura o vídeo na memória)
          e a reprodução também sai direto do R2, com suporte a intervalos (Range).
          Variáveis: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
          (ou S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION)
   disk → pasta data/files no servidor (bom no PC ou num servidor com disco fixo)
   db   → banco PostgreSQL (o que já existia): só arquivos pequenos (até 8 MB),
          porque o banco grátis tem pouco espaço.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AwsClient } = require('aws4fetch');

const MB = 1024 * 1024;
const PART = 5 * 1024 * 1024;   // 5 MiB: o mínimo do S3/R2 — partes menores = retomar perde menos

function createStorage({ dataDir, hasDb }) {
  const env = process.env;
  const endpoint = env.S3_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  const bucket = env.S3_BUCKET || env.R2_BUCKET;
  const keyId = env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secret = env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  const mode = endpoint && bucket && keyId && secret ? 's3' : hasDb ? 'db' : 'disk';
  const want = Number(env.MAX_UPLOAD_MB) || 100;
  // o que cada modo aguenta de verdade
  const maxBytes = mode === 'db' ? 8 * MB : Math.min(Math.max(1, want), 5000) * MB;
  const tmpDir = path.join(dataDir, 'uploads-tmp');
  const filesDir = path.join(dataDir, 'files');
  const s3 = mode === 's3' ? new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: 's3', region: env.S3_REGION || 'auto' }) : null;
  const base = mode === 's3' ? `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(bucket)}` : '';
  const objUrl = key => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // lê um campo do XML do S3 (decodificando &quot; &#34; &amp; …: o ETag vem com aspas codificadas)
  const unxml = v => v.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const tag = (body, t) => [...body.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map(m => unxml(m[1]));

  async function s3req(url, init = {}) {
    const r = await s3.fetch(url, init);
    if (!r.ok && r.status !== 206) { const t = await r.text().catch(() => ''); throw new Error(`S3 ${init.method || 'GET'} ${r.status}: ${t.slice(0, 200)}`); }
    return r;
  }
  // link assinado. Com "hour" o link é o mesmo durante a hora toda (o navegador consegue reaproveitar o cache)
  async function presign(url, method, { expires = 3600, headers, hour } = {}) {
    const u = new URL(url); u.searchParams.set('X-Amz-Expires', String(expires));
    let datetime;
    if (hour) { const d = new Date(); d.setUTCMinutes(0, 0, 0); datetime = d.toISOString().replace(/[:-]|\.\d{3}/g, ''); }
    const signed = await s3.sign(u.toString(), { method, headers, aws: { signQuery: true, datetime, allHeaders: !!headers } });
    return signed.url;
  }

  const api = {
    mode, maxBytes, partSize: PART,
    async init() {
      fs.mkdirSync(tmpDir, { recursive: true });
      if (mode !== 's3') return;
      // a pasta (bucket) precisa existir e aceitar envio direto do navegador (CORS)
      const head = await s3.fetch(base, { method: 'HEAD' });
      if (head.status === 404) await s3req(base, { method: 'PUT' });
      const origins = (env.PUBLIC_URL || '*').split(',').map(s => s.trim()).filter(Boolean);
      const cors = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>${origins.map(o => `<AllowedOrigin>${xml(o)}</AllowedOrigin>`).join('')}<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
      const md5 = crypto.createHash('md5').update(cors).digest('base64');
      try { await s3req(base + '?cors', { method: 'PUT', body: cors, headers: { 'Content-Type': 'application/xml', 'Content-MD5': md5 } }); }
      catch (e) {
        if (/403/.test(e.message)) console.log('CORS: a chave não pode mudar as configurações do bucket (normal) — use a regra CORS do painel do R2.');
        else console.warn('Não consegui configurar o CORS do armazenamento (faça no painel do R2):', e.message);
      }
    },
    // ---- envio em partes ----
    async start(key, mime) {
      if (mode === 's3') {
        const r = await s3req(objUrl(key) + '?uploads', { method: 'POST', headers: { 'Content-Type': mime } });
        return tag(await r.text(), 'UploadId')[0];
      }
      const id = crypto.randomBytes(12).toString('hex');
      fs.mkdirSync(path.join(tmpDir, id), { recursive: true });
      return id;
    },
    async partUrl(key, uploadId, n, size) {
      if (mode !== 's3') return null;
      // o tamanho vai assinado: o navegador não consegue mandar uma parte maior que a combinada
      return presign(`${objUrl(key)}?partNumber=${n}&uploadId=${encodeURIComponent(uploadId)}`, 'PUT', { headers: { 'content-length': String(size) } });
    },
    async writePart(uploadId, n, buf) {               // modos disk/db: a parte passa pelo servidor
      if (!/^[a-f0-9]{24}$/.test(uploadId)) throw new Error('envio inválido');
      fs.writeFileSync(path.join(tmpDir, uploadId, String(n)), buf);
    },
    async listParts(key, uploadId) {
      if (mode === 's3') {
        const out = []; let marker = 0;
        for (;;) {
          const r = await s3req(`${objUrl(key)}?uploadId=${encodeURIComponent(uploadId)}&max-parts=1000&part-number-marker=${marker}`);
          const body = await r.text();
          for (const p of tag(body, 'Part')) out.push({ n: Number(tag(p, 'PartNumber')[0]), size: Number(tag(p, 'Size')[0]), etag: tag(p, 'ETag')[0] });
          if (tag(body, 'IsTruncated')[0] !== 'true') break;
          marker = Number(tag(body, 'NextPartNumberMarker')[0]);
        }
        return out;
      }
      const dir = path.join(tmpDir, uploadId);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => /^\d+$/.test(f)).map(f => ({ n: Number(f), size: fs.statSync(path.join(dir, f)).size }));
    },
    async finish(key, uploadId, parts) {
      if (mode === 's3') {
        const body = `<CompleteMultipartUpload>${parts.sort((a, b) => a.n - b.n).map(p => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xml(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
        const r = await s3req(`${objUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/xml' } });
        const t = await r.text();
        if (/<Error>/.test(t)) throw new Error('S3 complete: ' + t.slice(0, 200));
        return;
      }
      // junta as partes num arquivo só
      fs.mkdirSync(filesDir, { recursive: true });
      const dest = path.join(filesDir, key.replace(/[^a-f0-9]/g, ''));
      const fd = fs.openSync(dest, 'w');
      for (const p of parts.sort((a, b) => a.n - b.n)) fs.writeSync(fd, fs.readFileSync(path.join(tmpDir, uploadId, String(p.n))));
      fs.closeSync(fd);
      fs.rmSync(path.join(tmpDir, uploadId), { recursive: true, force: true });
    },
    async abort(key, uploadId) {
      try {
        if (mode === 's3') await s3.fetch(`${objUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' });
        else if (/^[a-f0-9]{24}$/.test(uploadId)) fs.rmSync(path.join(tmpDir, uploadId), { recursive: true, force: true });
      } catch {}
    },
    // ---- arquivo pronto ----
    async size(key) {
      if (mode === 's3') { const r = await s3.fetch(objUrl(key), { method: 'HEAD' }); return r.ok ? Number(r.headers.get('content-length')) : -1; }
      const f = path.join(filesDir, key.replace(/[^a-f0-9]/g, ''));
      return fs.existsSync(f) ? fs.statSync(f).size : -1;
    },
    async head(key, bytes = 65536) {               // começo do arquivo, para descobrir o tipo real
      if (mode === 's3') { const r = await s3req(objUrl(key), { headers: { Range: `bytes=0-${bytes - 1}` } }); return Buffer.from(await r.arrayBuffer()); }
      const fd = fs.openSync(path.join(filesDir, key.replace(/[^a-f0-9]/g, '')), 'r');
      const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); fs.closeSync(fd);
      return b.subarray(0, n);
    },
    async del(key) {
      try {
        if (mode === 's3') await s3.fetch(objUrl(key), { method: 'DELETE' });
        else fs.unlinkSync(path.join(filesDir, key.replace(/[^a-f0-9]/g, '')));
      } catch {}
    },
    // link de leitura (só S3): curto, assinado e com o tipo/nome forçados na resposta
    async readUrl(key, { mime, inline, name }) {
      const disp = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`;
      return presign(`${objUrl(key)}?response-content-type=${encodeURIComponent(mime)}&response-content-disposition=${encodeURIComponent(disp)}&response-cache-control=${encodeURIComponent('private, max-age=3600')}`, 'GET', { expires: 7200, hour: true });
    },
    localPath: key => path.join(filesDir, key.replace(/[^a-f0-9]/g, '')),
    // limpeza: envios largados no meio (S3 e pasta temporária)
    async sweep(maxAgeMs = 24 * 3600e3) {
      try {
        for (const d of fs.readdirSync(tmpDir)) {
          const p = path.join(tmpDir, d);
          if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) fs.rmSync(p, { recursive: true, force: true });
        }
      } catch {}
      if (mode !== 's3') return;
      try {
        const r = await s3req(base + '?uploads');
        const body = await r.text();
        for (const u of tag(body, 'Upload')) {
          const started = Date.parse(tag(u, 'Initiated')[0]);
          if (Date.now() - started > maxAgeMs) await api.abort(tag(u, 'Key')[0], tag(u, 'UploadId')[0]);
        }
      } catch (e) { console.warn('limpeza de envios:', e.message); }
    },
  };
  return api;
}

// Envia um arquivo pelo modo "disk"/"db" respondendo com suporte a intervalos (Range): o vídeo começa
// a tocar antes de baixar tudo e dá para pular para qualquer ponto.
function sendRange(req, res, { size, open }) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  res.set('Accept-Ranges', 'bytes');
  if (!m) { res.set('Content-Length', String(size)); return open(0, size - 1).pipe(res); }
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  if (m[1] === '' && m[2] === '') { start = 0; end = size - 1; }
  if (start > end || start >= size) { res.status(416).set('Content-Range', `bytes */${size}`); return res.end(); }
  end = Math.min(end, size - 1);
  res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
  return open(start, end).pipe(res);
}

module.exports = { createStorage, sendRange, PART, MB };
