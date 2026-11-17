// Nexo — links que abrem dentro do chat: YouTube, imagem, vídeo e cartão de prévia das páginas.

const EMB = { cache: new Map(), asked: new Set(), timer: null };
const ytOf = url => {
  try {
    const u = new URL(url), h = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname); if (m) id = m[2]; }
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { id, start, short: /^\/shorts\//.test(u.pathname) };
  } catch { return null; }
};
const urlsOf = text => [...new Set((String(text || '').match(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g) || []))].slice(0, 3);
const extOf = url => { try { return (/\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname) || [])[1]?.toLowerCase() || ''; } catch { return ''; } };
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function askPreview(url) {
  if (EMB.asked.has(url)) return;
  EMB.asked.add(url);
  fetch('/api/unfurl?url=' + encodeURIComponent(url), { headers: { 'x-token': S.token } })
    .then(r => r.ok ? r.json() : { preview: null }).catch(() => ({ preview: null }))
    .then(j => {
      EMB.cache.set(url, j.preview || null);
      if (!j.preview) return;
      // junta as respostas que chegam perto uma da outra num redesenho só
      clearTimeout(EMB.timer);
      EMB.timer = setTimeout(() => { if (S.view === 'chat' && S.cid) renderMessages('keep'); }, 120);
    });
}

function embedsHtml(m) {
  if (!m || m.sys || !m.text || String(m.id).startsWith('out_')) return '';
  let out = '';
  urlsOf(m.text).forEach((url, i) => {
    const key = `${m.id}:${i}`, safe = esc(url), https = url.startsWith('https://');
    const yt = ytOf(url);
    if (yt) {
      const p = EMB.cache.get(url); if (p === undefined) askPreview(url);
      out += `<div class="emb yt${yt.short ? ' short' : ''}" data-key="yt:${esc(key)}" data-yt="${esc(yt.id)}" data-start="${yt.start}">
        <button type="button" class="yt-face" aria-label="Assistir no Nexo">
          <img src="https://i.ytimg.com/vi/${esc(yt.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="yt-play">${I.play}</span>
          <span class="yt-cap"><b>${esc(p?.title || 'Vídeo do YouTube')}</b><small>${esc(p?.desc ? p.desc + ' · YouTube' : 'YouTube')}</small></span>
        </button></div>`;
      return;
    }
    const ext = extOf(url);
    if (https && /^(png|jpe?g|gif|webp|avif)$/.test(ext)) { out += `<img class="att-img emb-img" src="${safe}" alt="" data-img="${safe}" data-name="${esc(url.split('/').pop().split('?')[0])}" loading="lazy" referrerpolicy="no-referrer">`; return; }
    if (https && /^(mp4|webm|mov|m4v)$/.test(ext)) { out += `<video class="emb-video" src="${safe}" controls playsinline preload="metadata" data-key="ev:${esc(key)}"></video>`; return; }
    if (https && /^(mp3|ogg|wav|m4a|opus)$/.test(ext)) { out += `<audio class="emb-audio" src="${safe}" controls preload="none"></audio>`; return; }
    const p = EMB.cache.get(url);
    if (p === undefined) return askPreview(url);
    if (!p) return;
    out += `<a class="emb card${p.image ? ' has-img' : ''}" href="${safe}" target="_blank" rel="noopener noreferrer">
      <span class="emb-txt"><small>${esc(p.site || hostOf(url))}</small><b>${esc(p.title)}</b>${p.desc ? `<span>${esc(p.desc)}</span>` : ''}</span>
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</a>`;
  });
  return out;
}

// clicar na capa: o vídeo do YouTube toca ali mesmo
document.getElementById('messages').addEventListener('click', e => {
  const face = e.target.closest('.emb.yt .yt-face'); if (!face) return;
  const box = face.closest('.emb.yt');
  const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0' });
  if (+box.dataset.start) q.set('start', box.dataset.start);
  box.dataset.live = box.dataset.key;
  box.classList.add('on');
  box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(box.dataset.yt)}?${q}" title="Vídeo do YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <div class="yt-bar"><a href="https://www.youtube.com/watch?v=${encodeURIComponent(box.dataset.yt)}" target="_blank" rel="noopener noreferrer">Abrir no YouTube</a><button type="button" class="yt-close">Fechar vídeo</button></div>`;
});
document.getElementById('messages').addEventListener('click', e => {
  if (!e.target.closest('.yt-close')) return;
  const box = e.target.closest('.emb.yt'); delete box.dataset.live;
  renderMessages('keep');
});
// vídeo de link direto tocando também não pode ser interrompido
document.getElementById('messages').addEventListener('play', e => { if (e.target.matches?.('.emb-video')) e.target.dataset.live = e.target.dataset.key; }, true);

// ---------------------------------------------------------------------
// O que está tocando continua tocando quando a conversa é redesenhada
// (chegou mensagem, alguém reagiu…). Antes, o vídeo parava.
// ---------------------------------------------------------------------
const liveHold = document.createElement('div');
liveHold.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:360px;overflow:hidden;pointer-events:none;opacity:0';
liveHold.setAttribute('aria-hidden', 'true');
document.body.appendChild(liveHold);
const moveKeep = (parent, node, before) => { try { if (parent.moveBefore) return parent.moveBefore(node, before); } catch {} parent.insertBefore(node, before); };
window.liveKeep = box => {
  const nodes = [...box.querySelectorAll('[data-live]')];
  // mudou de conversa: o que estava tocando na outra para
  if (EMB.cid !== S.cid) { EMB.cid = S.cid; return []; }
  for (const n of nodes) {
    const v = n.matches('video') ? n : n.querySelector('video');
    n._wasPlaying = !!v && !v.paused && !v.ended;
    n._cid = S.cid;
    moveKeep(liveHold, n, null);
  }
  return nodes;
};
window.liveRestore = (box, nodes) => {
  for (const n of nodes || []) {
    const slot = [...box.querySelectorAll('[data-key]')].find(x => x.dataset.key === n.dataset.live);
    if (!slot) { n.remove(); continue; }   // a mensagem saiu da tela (outro canal, apagada): o vídeo para
    moveKeep(slot.parentNode, n, slot);
    slot.remove();
    const v = n.matches('video') ? n : n.querySelector('video');
    if (v && n._wasPlaying && v.paused) v.play().catch(() => {});
  }
};

// saiu do chat (amigos, chamada em tela cheia…): nada fica tocando escondido
const _setView = setView;
setView = function (v) {
  if (v !== 'chat' && document.querySelector('#messages [data-live]')) { document.getElementById('messages').innerHTML = ''; EMB.cid = null; }
  return _setView(v);
};
