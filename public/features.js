'use strict';
/* =====================================================================
   Nexo - recursos de conversa
   Preferências pessoais, mensagens antigas, pesquisa, menções (@),
   "digitando…", notificações com som e escolha de microfone/câmera/saída.
   ===================================================================== */

// ---------------------------------------------------------------------
// Preferências deste aparelho
// ---------------------------------------------------------------------
const PREFS_DEFAULT = {
  notify: 'all',        // all | mentions | none
  sound: true,
  muted: [],            // grupos silenciados
  mic: '', cam: '', out: '',
  noise: true,          // (antigo) reduzir ruído e eco
  ns: 'auto',           // supressão de ruído: off | low | med | high | auto
  inVol: 100,           // volume de entrada (%)
  hpf: true,            // filtro de graves
  comp: true,           // compressor
  clickGuard: true,     // cliques de tecla/mouse não abrem o microfone
  followRoomNs: true,   // usar a supressão recomendada pela sala
  echo: true,           // cancelamento de eco
  agc: true,            // ganho automático
  gate: 'auto',         // porta de ruído: off | auto | manual
  gateDb: -50,          // sensibilidade manual (dB)
  sfx: true, sfxVol: 80, // sons do app
  inputMode: 'vad',     // vad | ptt (pressionar para falar)
  pttKey: 'KeyV',
  compact: false,
  fontSize: 15,
};
const prefs = (() => {
  let p;
  try { p = { ...PREFS_DEFAULT, ...JSON.parse(store.get('nexo_prefs') || '{}') }; } catch { p = { ...PREFS_DEFAULT }; }
  // quem tinha desligado "reduzir ruído" na versão antiga continua com ele desligado
  if (p.noise === false && !('nsSet' in p)) { p.ns = 'off'; p.echo = false; p.nsSet = 1; }
  // v21: níveis novos. Quem nunca escolheu vai para o Automático; quem escolheu mantém o equivalente
  if (!p.audioV) { p.ns = p.nsSet ? ({ std: 'low', strong: 'high' }[p.ns] || p.ns) : 'auto'; p.audioV = 21; }
  return p;
})();
function setPref(k, v) {
  prefs[k] = v;
  store.set('nexo_prefs', JSON.stringify(prefs));
  applyLook();
}
function applyLook() {
  document.documentElement.style.setProperty('--fs', prefs.fontSize + 'px');
  document.body.classList.toggle('compact', !!prefs.compact);
}
applyLook();

// ---------------------------------------------------------------------
// Microfone, câmera e saída de som escolhidos nas configurações
// ---------------------------------------------------------------------
function camDeviceConstraint() {
  return prefs.cam && !isMobile() ? { deviceId: { ideal: prefs.cam } } : {};
}
const canPickOutput = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
function applySink(el) {
  if (!prefs.out || !canPickOutput() || !el) return;
  el.setSinkId(prefs.out).catch(() => {});
}
function applySinkAll() {
  for (const p of call.peers.values()) { applySink(p.micAudio); applySink(p.screenAudio); }
  try { if (prefs.out && call.audioCtx?.setSinkId) call.audioCtx.setSinkId(prefs.out).catch(() => {}); } catch {}
}
// Troca o microfone no meio da chamada, sem cair
// Refaz o microfone da chamada (troca de aparelho ou de configuração de áudio)
async function switchMicDevice(quiet) {
  if (!call.channelId || !call.micTrack) return;
  try {
    const t = await acquireMic();
    t.enabled = call.micTrack.enabled;
    const old = call.micTrack;
    call.micTrack = t;
    setTrackForAll(0, t);
    attachMeter('me', t);
    applyPtt?.();
    old.stop();
    if (!quiet) toast('Microfone atualizado.');
  } catch { toast('Não consegui usar esse microfone.'); }
}

// ---------------------------------------------------------------------
// Mensagens antigas (rolar para cima carrega mais)
// ---------------------------------------------------------------------
S.more = {};
async function loadOlder() {
  const cid = S.cid, arr = S.msgs[cid];
  if (!arr || !S.more[cid] || S.loadingOlder) return;
  S.loadingOlder = true;
  const box = $('#messages');
  const lo = box.querySelector('.older');
  if (lo) lo.innerHTML = '<span class="spin"></span> Carregando mensagens antigas…';
  const h0 = box.scrollHeight, t0 = box.scrollTop;
  const r = await emit('channel:history', { channelId: cid, before: arr[0]?.id });
  S.loadingOlder = false;
  if (r.error || cid !== S.cid || S.msgs[cid] !== arr) return;
  S.msgs[cid] = [...r.messages, ...arr];
  S.more[cid] = r.hasMore;
  renderMessages('keep');
  box.scrollTop = box.scrollHeight - h0 + t0;
}
$('#messages').addEventListener('scroll', () => { if ($('#messages').scrollTop < 200) loadOlder(); }, { passive: true });
$('#messages').addEventListener('click', e => { if (e.target.closest('#load-older')) loadOlder(); });

// ---------------------------------------------------------------------
// Ir até uma mensagem (usado pela pesquisa)
// ---------------------------------------------------------------------
async function jumpTo(r) {
  closeModal();
  const cid = r.channelId;
  const has = () => (S.msgs[cid] || []).some(m => m.id === r.msg.id);
  const loadAround = async () => {
    const x = await emit('channel:history', { channelId: cid, around: r.msg.id });
    if (x.error) { toast(x.error); return false; }
    S.msgs[cid] = x.messages; S.more[cid] = x.hasMore;
    return true;
  };
  if (r.dmWith) {
    await openDM(r.dmWith);
    if (!has() && !(await loadAround())) return;
    renderMessages();
  } else {
    if (!has() && !(await loadAround())) return;
    S.gid = r.groupId;
    openTextChannel(cid);
  }
  requestAnimationFrame(() => {
    const el = $('#messages').querySelector(`.msg[data-id="${CSS.escape(r.msg.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
}

// ---------------------------------------------------------------------
// Pesquisa de mensagens
// ---------------------------------------------------------------------
function openSearch() {
  const inDm = S.gid === '@me';
  const g = curGroup();
  const scopes = inDm
    ? [['channel', 'Nesta conversa'], ['@me', 'Todas as conversas privadas'], ['all', 'Em tudo']]
    : [['channel', `Em #${findChannel(S.cid)?.c.name || 'canal'}`], ['group', `Em ${g?.name || 'grupo'}`], ['all', 'Em tudo']];
  modal(`<h3>Pesquisar mensagens</h3>
    <form id="sr-form" class="search-row">
      <input id="sr-q" placeholder="Palavra, frase ou nome de quem enviou" autocomplete="off">
      <select id="sr-scope">${scopes.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
    </form>
    <div class="search-res" id="sr-res"><p class="muted" style="margin:0">Digite pelo menos 2 letras.</p></div>
    <div class="acts"><button class="btn" data-close>Fechar</button></div>`, card => {
    const q = card.querySelector('#sr-q'), sc = card.querySelector('#sr-scope'), out = card.querySelector('#sr-res');
    let timer = null, seq = 0;
    const run = async () => {
      const text = q.value.trim();
      if (text.length < 2) { out.innerHTML = '<p class="muted" style="margin:0">Digite pelo menos 2 letras.</p>'; return; }
      const scope = sc.value;
      const args = { query: text };
      if (scope === 'channel') args.channelId = S.cid;
      else if (scope === 'group') args.groupId = S.gid;
      else if (scope === '@me') args.groupId = '@me';
      const my = ++seq;
      out.innerHTML = '<p class="muted" style="margin:0"><span class="spin"></span> Procurando…</p>';
      const r = await emit('message:search', args);
      if (my !== seq || !card.isConnected) return;
      if (r.error) { out.innerHTML = `<p class="muted" style="margin:0">${esc(r.error)}</p>`; return; }
      if (!r.results.length) { out.innerHTML = '<p class="muted" style="margin:0">Nenhuma mensagem encontrada.</p>'; return; }
      const re = new RegExp('(' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      const mark = t => esc(t).replace(re, '<mark>$1</mark>');
      out.innerHTML = `<p class="muted small" style="margin:0 0 4px">${r.total > r.results.length ? `Mostrando as ${r.results.length} mais recentes de ${r.total}` : `${r.total} resultado${r.total > 1 ? 's' : ''}`}</p>`
        + r.results.map((x, i) => {
          const where = x.dmWith ? `Conversa com ${esc(nameOf(x.dmWith, ''))}` : esc(x.place);
          const body = x.msg.text ? mark(x.msg.text) : (x.msg.att ? '📎 ' + esc(x.msg.att.name) : '');
          return `<button class="sr-item" data-i="${i}">${avatar(x.msg, 'sm nodot')}<span class="col">
            <span class="sr-top"><b style="color:${esc(nameColor(x.msg.userId, x.msg.color))}">${esc(nameOf(x.msg.userId, x.msg.username))}</b><span>${where} · ${fmtDate(x.msg.ts)}</span></span>
            <span class="sr-text">${body}</span></span></button>`;
        }).join('');
      out.querySelectorAll('[data-i]').forEach(b => b.onclick = () => jumpTo(r.results[+b.dataset.i]));
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 280); };
    sc.onchange = run;
    card.querySelector('#sr-form').onsubmit = e => { e.preventDefault(); clearTimeout(timer); run(); };
    setTimeout(() => q.focus(), 30);
  });
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && S.cid && S.view === 'chat' && $('#modal').classList.contains('hidden')) {
    e.preventDefault(); openSearch();
  }
});

// ---------------------------------------------------------------------
// Menções (@nome)
// ---------------------------------------------------------------------
// Quem pode ser mencionado aqui: membros do grupo ou a pessoa da conversa
function mentionCandidates() {
  if (S.gid === '@me') { const u = S.dmPeer && userById(S.dmPeer); return u ? [u] : []; }
  return (curGroup()?.members || []).filter(m => m.id !== S.user?.id);
}
// Destaca @nome no texto (só quando vem depois de espaço ou no começo, para não mexer em links)
function mentionHtml(html) {
  return html.replace(/(^|\s)@([a-zA-Z0-9_.\-]{2,24})/g, (all, pre, name) => {
    const low = name.toLowerCase();
    const u = low === S.user?.username.toLowerCase() ? S.user
      : Object.values(S.users).find(x => x.username?.toLowerCase() === low)
        || S.groups.flatMap(g => g.members).find(x => x.username?.toLowerCase() === low);
    if (!u) return all;
    return `${pre}<span class="mention${u.id === S.user?.id ? ' me' : ''}" data-uid="${esc(u.id)}">@${esc(u.name || u.username)}</span>`;
  });
}
const mentionsMe = m => !!m?.mentions?.includes(S.user?.id);

// Lista que aparece ao digitar @
const pop = document.createElement('div');
pop.className = 'mention-pop hidden';
document.querySelector('.composer').before(pop);
let popItems = [], popSel = 0, popStart = -1;
function closePop() { pop.classList.add('hidden'); popItems = []; popStart = -1; }
function updatePop() {
  const v = input.value, pos = input.selectionStart;
  const m = /(^|\s)@([a-zA-Z0-9_.\-]{0,24})$/.exec(v.slice(0, pos));
  if (!m) return closePop();
  const q = fold(m[2]);
  popItems = mentionCandidates().filter(u => fold(u.username).startsWith(q) || fold(u.name || '').includes(q)).slice(0, 8);
  if (!popItems.length) return closePop();
  popStart = pos - m[2].length - 1;
  popSel = Math.min(popSel, popItems.length - 1);
  pop.innerHTML = '<div class="pop-h">Mencionar</div>' + popItems.map((u, i) =>
    `<button type="button" class="pop-it ${i === popSel ? 'sel' : ''}" data-i="${i}">${avatar(u, 'sm')}<b>${esc(u.name)}</b><span>@${esc(u.username)}</span></button>`).join('');
  pop.classList.remove('hidden');
}
function pickMention(i) {
  const u = popItems[i];
  if (!u || popStart < 0) return;
  const v = input.value, pos = input.selectionStart;
  input.value = v.slice(0, popStart) + '@' + u.username + ' ' + v.slice(pos);
  const c = popStart + u.username.length + 2;
  input.setSelectionRange(c, c);
  closePop();
  autosize();
  input.focus();
}
const fold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
pop.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pickMention(+b.dataset.i); } });
input.addEventListener('input', () => { popSel = 0; updatePop(); sendTyping(); });
input.addEventListener('click', updatePop);
input.addEventListener('blur', () => setTimeout(closePop, 120));
input.addEventListener('keydown', e => {
  if (pop.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopImmediatePropagation();
    popSel = (popSel + (e.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length;
    updatePop();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault(); e.stopImmediatePropagation(); pickMention(popSel);
  } else if (e.key === 'Escape') { e.stopImmediatePropagation(); closePop(); }
}, true);

// ---------------------------------------------------------------------
// "Fulano está digitando…"
// ---------------------------------------------------------------------
const typing = new Map();   // channelId -> Map(userId -> expira)
let lastTypingSent = 0;
function sendTyping() {
  if (!S.cid || !input.value.trim() || input.disabled) return;
  const now = Date.now();
  if (now - lastTypingSent < 2500) return;
  lastTypingSent = now;
  S.socket?.emit('typing', { channelId: S.cid });
}
function renderTyping() {
  const el = $('#typing');
  if (!el) return;
  const m = typing.get(S.cid), now = Date.now();
  const who = m ? [...m.entries()].filter(([, t]) => t > now).map(([id]) => nameOf(id, '')) .filter(Boolean) : [];
  if (!who.length || S.view !== 'chat') { el.innerHTML = ''; el.classList.remove('on'); return; }
  const txt = who.length === 1 ? `<b>${esc(who[0])}</b> está digitando` : who.length === 2
    ? `<b>${esc(who[0])}</b> e <b>${esc(who[1])}</b> estão digitando` : 'Várias pessoas estão digitando';
  el.innerHTML = `<span class="dots3"><i></i><i></i><i></i></span>${txt}…`;
  el.classList.add('on');
}
function onTyping({ channelId, userId }) {
  if (userId === S.user?.id) return;
  if (!typing.has(channelId)) typing.set(channelId, new Map());
  typing.get(channelId).set(userId, Date.now() + 6000);
  if (channelId === S.cid) renderTyping();
}
function stopTypingOf(channelId, userId) {
  typing.get(channelId)?.delete(userId);
  if (channelId === S.cid) renderTyping();
}
setInterval(renderTyping, 1500);

// ---------------------------------------------------------------------
// Notificações: quando avisar, som e contador na aba
// ---------------------------------------------------------------------
function shouldNotify(msg, groupId, dm) {
  if (prefs.notify === 'none' || msg.sys || msg.userId === S.user?.id) return false;
  if (S.user?.presence === 'dnd') return false;      // não perturbar: nada de aviso
  if (dm) return true;
  const mention = mentionsMe(msg);
  if (prefs.muted.includes(groupId)) return mention;
  if (prefs.notify === 'mentions') return mention;
  return true;
}
let lastSound = 0;
function playNotifySound() {
  if (!prefs.sound || S.user?.presence === 'dnd') return;
  const now = Date.now();
  if (now - lastSound < 1200) return;
  lastSound = now;
  try {
    ensureAudioCtx();
    const ctx = call.audioCtx; if (!ctx) return;
    const vol = (prefs.sfxVol ?? 80) / 100;
    [[880, 0], [1320, 0.09]].forEach(([f, off]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + off;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.1 * vol), t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.25);
    });
  } catch {}
}
function updateTitle() {
  // conta as mensagens (grupos silenciados só contam menções)
  let n = 0;
  for (const [cid, u] of S.unread) {
    const g = !isDmChannel(cid) && findChannel(cid)?.g;
    n += g && prefs.muted.includes(g.id) ? u.m : u.n;
  }
  document.title = n ? `(${n > 99 ? '99+' : n}) Nexo` : 'Nexo';
  // número no ícone do app (app instalado no PC/celular)
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch {}
}
// Silenciar um grupo (só no seu aparelho)
function toggleGroupMute(gid) {
  const muted = prefs.muted.includes(gid);
  setPref('muted', muted ? prefs.muted.filter(x => x !== gid) : [...prefs.muted, gid]);
  toast(muted ? 'Notificações do grupo ativadas.' : 'Grupo silenciado. Você ainda é avisado quando alguém te mencionar.');
  renderRail();
}
