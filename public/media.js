'use strict';
/* =====================================================================
   Nexo - anexos grandes e reprodutor de vídeo
   ---------------------------------------------------------------------
   • Antes de enviar: confere se o vídeo toca no navegador, lê duração e
     tamanho da imagem e tira uma miniatura (do arquivo local, sem enviar nada).
   • Envio em partes de 8 MB, 3 de cada vez, com barra de progresso,
     cancelar, tentar de novo e continuar de onde parou (até após recarregar).
   • Reprodutor no chat: miniatura, play/pause, barra com o que já carregou,
     tempo, volume, velocidade, tela cheia e "abrir maior".
   ===================================================================== */

// ---------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------
const MBYTES = 1024 * 1024;
const upCfg = () => S.upCfg || { maxMB: 8, mode: 'db', partMB: 8 };
// mesmo cálculo do servidor: servidor → grupo → canal (o menor vence)
function uploadLimitFor(cid) {
  let lim = upCfg().maxMB * MBYTES;
  if (!cid || isDmChannel(cid)) return lim;
  const f = findChannel(cid);
  if (f?.g.maxUploadMB) lim = Math.min(lim, f.g.maxUploadMB * MBYTES);
  if (f?.c.cfg?.maxFileMB) lim = Math.min(lim, f.c.cfg.maxFileMB * MBYTES);
  return lim;
}
const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

// ---------------------------------------------------------------------
// Vídeo: dá para tocar? duração, tamanho e miniatura
// ---------------------------------------------------------------------
function probeVideo(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(to); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(r); };
    const to = setTimeout(() => finish({ playable: false, reason: 'demorou' }), 12000);
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onerror = () => finish({ playable: false, reason: 'formato' });
    v.onloadedmetadata = () => {
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      if (!v.videoWidth) return finish({ playable: false, dur, reason: 'sem imagem' });   // codec de vídeo que o navegador não abre
      v.currentTime = Math.min(dur * 0.1, 1.5);
    };
    v.onseeked = () => {
      try {
        const W = Math.min(640, v.videoWidth), H = Math.round(v.videoHeight * W / v.videoWidth);
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        c.getContext('2d').drawImage(v, 0, 0, W, H);
        c.toBlob(b => finish({ playable: true, dur: v.duration, w: v.videoWidth, h: v.videoHeight, thumb: b }), 'image/jpeg', 0.8);
      } catch { finish({ playable: true, dur: v.duration, w: v.videoWidth, h: v.videoHeight }); }
    };
    v.src = url;
  });
}
async function uploadSmall(blob, name, mime, purpose) {
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-token': S.token, 'x-name': encodeURIComponent(name), 'x-mime': mime, 'x-purpose': purpose }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.att) throw new Error(j.error || 'Falha no envio.');
  return j.att;
}

// ---------------------------------------------------------------------
// Envio em partes
// ---------------------------------------------------------------------
const api = (path, opt = {}) => fetch(path, { ...opt, headers: { 'x-token': S.token, ...(opt.body && typeof opt.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || `Erro ${r.status}`); e.status = r.status; e.data = j; throw e; } return j; });
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

class Upload {
  constructor(it) { this.it = it; this.xhrs = new Set(); this.sent = {}; this.cancelled = false; }
  get file() { return this.it.blob || this.it.file; }
  progress() {
    const total = this.file.size;
    const done = Object.values(this.sent).reduce((a, b) => a + b, 0);
    this.it.pct = Math.min(100, Math.floor(done / total * 100));
    renderAttProgress(this.it);
  }
  // uma parte (com até 4 tentativas)
  async part(n, url) {
    const ps = this.info.partSize, f = this.file;
    const blob = f.slice((n - 1) * ps, Math.min(f.size, n * ps));
    for (let tryN = 1; ; tryN++) {
      if (this.cancelled) throw Object.assign(new Error('cancelado'), { cancel: true });
      try {
        await new Promise((ok, bad) => {
          const x = new XMLHttpRequest();
          this.xhrs.add(x);
          x.open('PUT', url || `/api/up/${this.info.id}/part/${n}`);
          if (!url) { x.setRequestHeader('x-token', S.token); x.setRequestHeader('content-type', 'application/octet-stream'); }
          x.upload.onprogress = e => { this.sent[n] = e.loaded; this.progress(); };
          x.onload = () => { this.xhrs.delete(x); x.status >= 200 && x.status < 300 ? ok() : bad(Object.assign(new Error('parte ' + n + ': ' + x.status), { status: x.status })); };
          x.onerror = () => { this.xhrs.delete(x); bad(new Error('sem conexão')); };
          x.onabort = () => { this.xhrs.delete(x); bad(Object.assign(new Error('cancelado'), { cancel: true })); };
          x.send(blob);
        });
        this.sent[n] = blob.size; this.progress();
        return;
      } catch (e) {
        if (e.cancel || tryN >= 4) throw e;
        this.sent[n] = 0;
        await sleepMs(800 * tryN * tryN);   // espera um pouco e tenta de novo
      }
    }
  }
  async run() {
    const f = this.file, it = this.it;
    // começa — ou continua o mesmo arquivo que tinha parado
    this.info = await api('/api/up', { method: 'POST', body: JSON.stringify({
      channelId: it.cid, name: it.name, size: f.size, mime: it.mime, fkey: it.fkey,
      meta: { dur: it.meta?.dur, w: it.meta?.w, h: it.meta?.h, playable: it.meta?.playable, thumb: it.thumbId },
    }) });
    it.upId = this.info.id;
    const done = new Set(this.info.done);
    for (const n of done) this.sent[n] = n < this.info.parts ? this.info.partSize : f.size - this.info.partSize * (this.info.parts - 1);
    if (done.size) { it.resumed = true; this.progress(); }
    const todo = []; for (let n = 1; n <= this.info.parts; n++) if (!done.has(n)) todo.push(n);
    const urls = {};
    const need = async ns => { if (this.info.mode !== 's3') return; const r = await api(`/api/up/${this.info.id}/urls`, { method: 'POST', body: JSON.stringify({ parts: ns }) }); Object.assign(urls, r.urls); };
    // 2 partes ao mesmo tempo (terminam mais cedo — se cair, perde menos)
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const n = queue.shift();
        if (this.info.mode === 's3' && !urls[n]) await need([n, ...queue.slice(0, 9)].filter(x => !urls[x]));
        await this.part(n, urls[n]);
      }
    };
    await Promise.all([worker(), worker()]);
    // confere e libera
    for (let i = 0; i < 3; i++) {
      try { return (await api(`/api/up/${this.info.id}/done`, { method: 'POST' })).att; }
      catch (e) { if (e.status === 409 && e.data?.missing) { for (const n of e.data.missing) await this.part(n, (await need([n]), urls[n])); continue; } throw e; }
    }
    throw new Error('Não consegui terminar o envio.');
  }
  cancel() {
    this.cancelled = true;
    this.xhrs.forEach(x => x.abort());
    if (this.it.upId) api(`/api/up/${this.it.upId}`, { method: 'DELETE' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------
// Anexos na caixa de mensagem
// ---------------------------------------------------------------------
const fkeyOf = f => `${f.name}|${f.size}|${f.lastModified || 0}`;
async function addAttachments(files) {
  const cid = S.cid;
  if (!cid) return;
  const lim = uploadLimitFor(cid);
  for (const f of [...files].slice(0, 5)) {
    if (S.atts.length >= 5) return toast('No máximo 5 arquivos por mensagem.');
    if (!f.size) { toast(`"${f.name}" está vazio.`); continue; }
    if (S.atts.some(a => a.fkey === fkeyOf(f))) { toast(`"${f.name}" já está na lista.`); continue; }
    if (f.size > lim) {
      toast(`"${f.name}" tem ${fmtSize(f.size)}. O limite aqui é ${fmtSize(lim)}.${upCfg().mode === 'db' && f.size > 8 * MBYTES ? ' (o servidor está sem armazenamento para arquivos grandes)' : ''}`, 7000);
      continue;
    }
    const it = { name: f.name || 'arquivo', mime: f.type || 'application/octet-stream', size: f.size, file: f, fkey: fkeyOf(f), cid, up: true, pct: 0, stage: 'preparando' };
    if (f.type.startsWith('image/')) it.preview = URL.createObjectURL(f);
    S.atts.push(it);
    renderAtts();
    startAttUpload(it);
  }
}
async function startAttUpload(it) {
  it.err = null; it.up = true; renderAtts();
  try {
    const f = it.file;
    if (!it.prepared) {
      if (f.type.startsWith('image/')) {
        const small = await shrinkImage(f);
        if (small) { it.blob = small; it.mime = 'image/jpeg'; }
        it.meta = await imageSize(it.blob || f);
      } else if (f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name)) {
        it.stage = 'analisando o vídeo'; renderAtts();
        const p = await probeVideo(f);
        it.meta = { dur: p.dur, w: p.w, h: p.h, playable: p.playable };
        if (!p.playable) {
          const ok = await askYesNo('Este vídeo não toca no navegador',
            `"${it.name}" usa um formato que este navegador não consegue reproduzir (comum em vídeos H.265/HEVC de celular ou MKV). Ele pode ir como arquivo para baixar — o original não é alterado. Para tocar no chat, converta para MP4 (H.264) antes.`,
            'Enviar como arquivo', 'Cancelar');
          if (!ok) { removeAtt(it); return; }
        }
        if (p.thumb) { it.thumbUrl = URL.createObjectURL(p.thumb); it.thumbId = (await uploadSmall(p.thumb, 'miniatura.jpg', 'image/jpeg', 'thumb')).id; }
      }
      it.prepared = true;
    }
    it.stage = null; renderAtts();
    it.job = new Upload(it);
    const att = await it.job.run();
    Object.assign(it, { att: { ...att, ...(att.w ? {} : { w: it.meta?.w, h: it.meta?.h }) }, up: false, pct: 100, job: null });
  } catch (e) {
    if (e.cancel) return;
    it.up = false; it.job = null;
    it.err = e.status === 413 || e.status === 403 || e.status === 507 || e.status === 429 ? e.message : `${e.message || 'Falha no envio'}. As partes já enviadas ficam guardadas.`;
    if ([413, 403, 507].includes(e.status)) it.fatal = true;
  }
  renderAtts();
}
function removeAtt(it) {
  it.job?.cancel();
  if (it.preview) URL.revokeObjectURL(it.preview);
  if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  S.atts = S.atts.filter(x => x !== it);
  renderAtts();
}
function renderAtts() {
  const bar = $('#att-bar');
  bar.classList.toggle('hidden', !S.atts.length);
  const lim = uploadLimitFor(S.cid);
  bar.innerHTML = S.atts.map((a, i) => `<div class="att-chip ${a.up ? 'up' : ''} ${a.err ? 'err' : ''}" data-k="${i}">
    ${a.preview || a.thumbUrl ? `<img src="${a.preview || a.thumbUrl}" alt="">` : `<span class="i">${a.mime.startsWith('video/') ? I.cam : I.file}</span>`}
    <span class="col"><b title="${esc(a.name)}">${esc(a.name)}</b>
      <span class="st">${a.err ? esc(a.err) : a.stage ? a.stage + '…' : a.up ? `${fmtSize(a.size)} · <b class="pct">${a.pct || 0}%</b>${a.resumed ? ' · continuando' : ''}` : `${fmtSize(a.size)}${a.meta?.dur ? ' · ' + fmtDur(a.meta.dur) : ''} · pronto`}</span>
      ${a.up ? `<span class="prog"><i style="width:${a.pct || 0}%"></i></span>` : ''}</span>
    ${a.err && !a.fatal ? `<button type="button" class="retry" data-r="${i}" title="Tentar novamente">${I.flip || '↻'}</button>` : ''}
    <button type="button" data-i="${i}" title="${a.up ? 'Cancelar o envio' : 'Remover'}">✕</button></div>`).join('')
    + `<div class="att-lim">Limite aqui: ${fmtSize(lim)} por arquivo</div>`;
  bar.querySelectorAll('[data-i]').forEach(b => b.onclick = () => removeAtt(S.atts[+b.dataset.i]));
  bar.querySelectorAll('[data-r]').forEach(b => b.onclick = () => startAttUpload(S.atts[+b.dataset.r]));
}
// atualiza só a barra (sem redesenhar tudo a cada pedacinho enviado)
function renderAttProgress(it) {
  const el = document.querySelector(`#att-bar [data-k="${S.atts.indexOf(it)}"]`);
  if (!el) return;
  const i = el.querySelector('.prog i'), p = el.querySelector('.pct');
  if (i) i.style.width = it.pct + '%';
  if (p) p.textContent = it.pct + '%';
}
function clearAtts() { S.atts.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview); if (a.thumbUrl) URL.revokeObjectURL(a.thumbUrl); }); S.atts = []; renderAtts(); }
function askYesNo(title, text, yes, no) {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${esc(text)}</p>
      <div class="acts"><button class="btn" id="yn-no">${esc(no)}</button><button class="btn primary" id="yn-yes">${esc(yes)}</button></div>`, card => {
      card.querySelector('#yn-yes').onclick = () => { closeModal(); res(true); };
      card.querySelector('#yn-no').onclick = () => { closeModal(); res(false); };
    });
    const m = $('#modal'); const prev = m.onclick;
    m.onclick = e => { if (e.target === m) { closeModal(); res(false); } };
  });
}

// ---------------------------------------------------------------------
// Vídeo na mensagem
// ---------------------------------------------------------------------
function videoAttHtml(a) {
  const url = `/api/file/${esc(a.id)}`;
  const ratio = a.w && a.h ? a.w / a.h : 16 / 9;
  // não deixa vídeo enorme/em pé ocupar a tela: no máx. 520 de largura e 400 de altura
  const W = Math.round(Math.min(520, 400 * ratio));
  const poster = a.thumb ? `/api/file/${esc(a.thumb)}` : '';
  const info = [a.dur ? fmtDur(a.dur) : '', fmtSize(a.size || 0)].filter(Boolean).join(' · ');
  if (a.playable === false) {
    return `<div class="vp-file">${poster ? `<img src="${poster}" alt="" loading="lazy">` : `<span class="i">${I.cam}</span>`}
      <span class="col"><b>${esc(a.name)}</b><span>${info} · este formato não toca no navegador</span></span>
      <a class="btn sm" href="${url}" download="${esc(a.name)}">Baixar</a></div>`;
  }
  return `<div class="vp" data-key="vp:${url}" data-src="${url}" data-name="${esc(a.name)}" data-dur="${a.dur || ''}" style="width:min(100%, ${W}px);aspect-ratio:${ratio}" tabindex="0">
    ${poster ? `<img class="vp-poster" src="${poster}" alt="" loading="lazy">` : '<div class="vp-poster blank"></div>'}
    <button class="vp-big" title="Assistir" aria-label="Assistir">${I.play || '▶'}</button>
    <div class="vp-badge">${info}</div>
    <div class="vp-title" title="${esc(a.name)}">${esc(a.name)}</div>
  </div>`;
}

const VP = { vol: Number(store.get('nexo_vvol') ?? 1), muted: store.get('nexo_vmute') === '1' };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function mountPlayer(box, autoplay = true) {
  if (box._v) return box._v;
  const src = box.dataset.src;
  box.dataset.live = 'vp:' + src;   // tocando: não é destruído quando a conversa é redesenhada
  box.classList.add('on');
  box.insertAdjacentHTML('beforeend', `
    <video playsinline preload="metadata" src="${src}"></video>
    <div class="vp-ui">
      <div class="vp-seek"><div class="vp-buf"></div><div class="vp-cur"></div><input type="range" min="0" max="1000" step="1" value="0" aria-label="Posição"></div>
      <div class="vp-row">
        <button class="vp-b vp-play" title="Reproduzir/pausar (espaço)">${I.play || '▶'}</button>
        <span class="vp-time">0:00 / ${fmtDur(box.dataset.dur)}</span>
        <span class="vp-sp"></span>
        <div class="vp-vol"><button class="vp-b vp-mute" title="Volume (M)">${I.vol}</button><input type="range" min="0" max="1" step="0.05" value="${VP.vol}" aria-label="Volume"></div>
        <button class="vp-b vp-speed" title="Velocidade">1x</button>
        <button class="vp-b vp-big2" title="Abrir maior">${I.expand}</button>
        <button class="vp-exitfs" title="Sair da tela cheia (Esc)">${I.x}</button>
        <button class="vp-b vp-fs" title="Tela cheia (F)">${I.screen}</button>
      </div>
    </div>
    <div class="vp-msg hidden"></div>`);
  const v = box.querySelector('video'), q = s => box.querySelector(s);
  box._v = v;
  v.volume = VP.vol; v.muted = VP.muted;
  const ico = () => {
    q('.vp-play').innerHTML = v.paused ? (I.play || '▶') : (I.pause || '❚❚');
    q('.vp-mute').innerHTML = v.muted || v.volume === 0 ? I.volX : I.vol;
    box.classList.toggle('paused', v.paused);
  };
  const time = () => {
    const d = Number.isFinite(v.duration) ? v.duration : Number(box.dataset.dur) || 0;
    q('.vp-time').textContent = `${fmtDur(v.currentTime)} / ${fmtDur(d)}`;
    if (!box._seeking) q('.vp-seek input').value = d ? Math.round(v.currentTime / d * 1000) : 0;
    q('.vp-cur').style.width = (d ? v.currentTime / d * 100 : 0) + '%';
  };
  const buf = () => {
    const d = v.duration; if (!d || !v.buffered.length) return;
    let end = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) end = Math.max(end, v.buffered.end(i));
    q('.vp-buf').style.width = (end / d * 100) + '%';
  };
  const toggle = () => { if (v.paused) { v.play().catch(err => showErr(err)); } else v.pause(); };
  const showErr = () => {
    const m = q('.vp-msg');
    m.innerHTML = `Não foi possível reproduzir este vídeo aqui. <a href="${src}" download="${esc(box.dataset.name)}">Baixar</a>`;
    m.classList.remove('hidden');
  };
  v.addEventListener('play', () => { document.querySelectorAll('.vp video').forEach(o => { if (o !== v && !o.paused) o.pause(); }); ico(); wake(); });
  v.addEventListener('pause', () => { ico(); box.classList.remove('idle'); });
  v.addEventListener('timeupdate', time);
  v.addEventListener('loadedmetadata', time);
  v.addEventListener('progress', buf);
  v.addEventListener('waiting', () => box.classList.add('loading'));
  v.addEventListener('playing', () => box.classList.remove('loading'));
  v.addEventListener('canplay', () => box.classList.remove('loading'));
  v.addEventListener('ended', () => { box.classList.remove('idle'); ico(); });
  v.addEventListener('volumechange', () => { VP.vol = v.volume; VP.muted = v.muted; store.set('nexo_vvol', String(v.volume)); store.set('nexo_vmute', v.muted ? '1' : '0'); q('.vp-vol input').value = v.muted ? 0 : v.volume; ico(); });
  v.addEventListener('error', showErr);
  v.addEventListener('click', toggle);
  v.addEventListener('dblclick', () => fs());
  q('.vp-play').onclick = toggle;
  q('.vp-mute').onclick = () => { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.6; };
  q('.vp-vol input').oninput = e => { v.volume = Number(e.target.value); v.muted = v.volume === 0; };
  q('.vp-speed').onclick = e => {
    ctx.innerHTML = `<div class="vol-h">Velocidade</div>${SPEEDS.map(s => `<button class="item" data-s="${s}">${s === 1 ? 'Normal' : s + 'x'}${v.playbackRate === s ? '<span class="sub">✓</span>' : ''}</button>`).join('')}`;
    ctx.onclick = ev => { const b = ev.target.closest('[data-s]'); if (!b) return; v.playbackRate = Number(b.dataset.s); q('.vp-speed').textContent = v.playbackRate + 'x'; closeCtx(); };
    const r = e.currentTarget.getBoundingClientRect(); placeCtx(r.left, r.top - 230);
  };
  const seek = q('.vp-seek input');
  seek.addEventListener('input', () => { box._seeking = true; const d = v.duration || Number(box.dataset.dur); q('.vp-cur').style.width = seek.value / 10 + '%'; q('.vp-time').textContent = `${fmtDur(seek.value / 1000 * d)} / ${fmtDur(d)}`; });
  seek.addEventListener('change', () => { const d = v.duration || Number(box.dataset.dur); if (d) v.currentTime = seek.value / 1000 * d; box._seeking = false; });
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fs = () => {
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
    else (box.requestFullscreen?.() || box.webkitRequestFullscreen?.() || v.webkitEnterFullscreen?.())?.catch?.(() => {});
  };
  const fsIco = () => { const on = fsEl() === box; box.classList.toggle('fs', on); q('.vp-fs').title = on ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)'; };
  document.addEventListener('fullscreenchange', fsIco); document.addEventListener('webkitfullscreenchange', fsIco);
  q('.vp-fs').onclick = fs;
  q('.vp-exitfs').onclick = fs;
  // setas: abre maior — e, se já estiver grande, volta para o chat (não abre de novo por cima)
  q('.vp-big2').onclick = () => box.classList.contains('big') ? box._closeBig?.() : openVideoBig(box);
  // controles somem com o mouse parado enquanto toca
  let t = null;
  const wake = () => { box.classList.remove('idle'); clearTimeout(t); if (!v.paused) t = setTimeout(() => box.classList.add('idle'), 2200); };
  box.addEventListener('mousemove', wake);
  box.addEventListener('touchstart', wake, { passive: true });
  box.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'f') fs();
    else if (e.key === 'm') v.muted = !v.muted;
    else if (e.key === 'ArrowRight') v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
    else if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5);
  });
  ico();
  if (autoplay) v.play().catch(() => {});
  return v;
}
// "Abrir maior": o MESMO vídeo vai para uma camada por cima do chat (continua de onde estava)
function openVideoBig(box) {
  if (box.classList.contains('big')) return box._closeBig?.();
  const lb = $('#lightbox');
  // mover o vídeo de lugar faz o navegador pausar: lembra se estava tocando e continua
  const v = box._v, wasPlaying = v && !v.paused;
  const resume = () => { if (wasPlaying) v.play().catch(() => {}); };
  const ph = document.createElement('div');
  ph.className = 'vp-ph'; ph.style.cssText = `width:${box.offsetWidth}px;height:${box.offsetHeight}px`;
  box.replaceWith(ph);
  lb.innerHTML = '';
  lb.appendChild(box);
  box.classList.add('big');
  lb.insertAdjacentHTML('beforeend', `<button class="vp-close" title="Fechar (Esc)">${I.x}</button>`);
  lb.classList.remove('hidden');
  resume();
  const close = () => {
    if (!box._closeBig) return;
    box._closeBig = null;
    const playing = v && !v.paused;
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
    box.classList.remove('big');
    if (ph.isConnected) ph.replaceWith(box);
    lb.classList.add('hidden'); lb.innerHTML = '';
    if (playing) v.play().catch(() => {});
    document.removeEventListener('keydown', esc1, true);
    box.querySelector('.vp-big2')?.setAttribute('title', 'Abrir maior');
  };
  box._closeBig = close;
  box.querySelector('.vp-big2')?.setAttribute('title', 'Voltar para o chat');
  const esc1 = e => { if (e.key === 'Escape' && !document.fullscreenElement) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esc1, true);
  lb.onclick = e => { if (e.target === lb || e.target.closest('.vp-close')) close(); };
}
// clique na miniatura: começa a tocar ali mesmo
document.addEventListener('click', e => {
  const box = e.target.closest('.vp');
  if (!box || box._v) return;
  e.preventDefault();
  mountPlayer(box, true);
});
document.addEventListener('keydown', e => {
  const box = e.target.closest?.('.vp');
  if (box && !box._v && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); mountPlayer(box, true); }
});
