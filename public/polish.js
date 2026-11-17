// Nexo — conexão mais firme e menos cliques.
// (barra de conexão, mensagens guardadas sem internet, ir direto para uma conversa, atalhos, gestos)

// ---------------------------------------------------------------------
// Barra de conexão: fica na tela enquanto está sem servidor (em vez de um aviso que some)
// ---------------------------------------------------------------------
const connBar = document.createElement('div');
connBar.id = 'conn-bar'; connBar.className = 'conn-bar hidden'; connBar.setAttribute('role', 'status');
document.querySelector('.main-head').after(connBar);
const conn = { down: false, shown: false, timer: null, hide: null };

function connPaint() {
  const off = navigator.onLine === false;
  const n = (typeof S !== 'undefined' && S.outbox || []).filter(o => !o.err).length;
  const what = off ? 'Sem internet.' : call.channelId || call.rejoin ? 'A conexão caiu. Voltando para a chamada…' : 'Reconectando…';
  const extra = n ? ` ${n === 1 ? '1 mensagem sai' : n + ' mensagens saem'} sozinha${n === 1 ? '' : 's'} quando voltar.` : '';
  connBar.className = 'conn-bar ' + (off ? 'off' : 'wait');
  connBar.innerHTML = `<i></i><span>${what}${extra}</span><button type="button" id="conn-now">Tentar agora</button>`;
  connBar.querySelector('#conn-now').onclick = connRetry;
}
function connRetry() {
  if (S.socket && !S.socket.connected) { S.socket.io.reconnectionAttempts?.(Infinity); S.socket.connect(); }
}
window.connState = state => {
  clearTimeout(conn.hide);
  if (state === 'down') {
    if (conn.down) { if (conn.shown) connPaint(); return; }
    conn.down = true;
    // queda de 1 segundo ninguém precisa ver
    conn.timer = setTimeout(() => { if (!conn.down) return; conn.shown = true; connPaint(); }, 1200);
    return;
  }
  clearTimeout(conn.timer);
  const was = conn.shown;
  conn.down = false; conn.shown = false;
  if (!was) { connBar.className = 'conn-bar hidden'; return; }
  connBar.className = 'conn-bar ok';
  connBar.innerHTML = '<i></i><span>Conectado de novo.</span>';
  conn.hide = setTimeout(() => { connBar.className = 'conn-bar hidden'; }, 1800);
};
// a internet voltou ou a pessoa voltou para o app: tenta na hora, sem esperar o próximo ciclo
window.addEventListener('online', () => { connRetry(); if (conn.shown) connPaint(); });
window.addEventListener('offline', () => { if (S.token) window.connState('down'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) connRetry(); });

// ---------------------------------------------------------------------
// Caixa de saída: mensagem escrita sem conexão fica guardada e sai sozinha quando voltar
// ---------------------------------------------------------------------
const OUT_KEY = 'nexo_outbox';
S.outbox = [];
try { S.outbox = (JSON.parse(localStorage.getItem(OUT_KEY) || '[]') || []).filter(o => o && o.cid && o.text && o.nonce && Date.now() - o.ts < 24 * 3600e3).slice(0, 50); } catch {}
const saveOutbox = () => { try { localStorage.setItem(OUT_KEY, JSON.stringify(S.outbox)); } catch {} };
const myOutbox = cid => S.outbox.filter(o => o.cid === cid && (!o.uid || o.uid === S.user?.id));

function queueOut(item) {
  if (S.outbox.length >= 50) return toast('Tem muitas mensagens esperando conexão. Espere a internet voltar.');
  S.outbox.push({ ...item, uid: S.user?.id });
  saveOutbox();
  if (S.cid === item.cid) renderMessages();
  window.connState('down');
  if (S.socket?.connected) flushOutbox();   // o servidor só demorou a responder: tenta de novo já
}
function outboxHtml(cid) {
  if (!S.user) return '';
  return myOutbox(cid).map(o => `<div class="msg first pending${o.err ? ' failed' : ''}" data-out="${esc(o.nonce)}">${avatar(S.user)}<div class="msg-body">
    <div class="msg-head"><span class="msg-author" style="color:${esc(nameColor(S.user.id, S.user.color))}">${esc(S.user.name || S.user.username)}</span></div>
    <div class="msg-text">${richText(o.text)}</div>
    <div class="out-st">${o.err ? `${I.x}<span>Não enviada: ${esc(o.err)}</span><button type="button" data-out-retry>Tentar de novo</button><button type="button" data-out-del>Apagar</button>`
      : `${I.clock}<span>${o.busy ? 'Enviando…' : 'Sai quando a conexão voltar'}</span><button type="button" data-out-del>Cancelar</button>`}</div></div></div>`).join('');
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !S.socket?.connected || !S.user) return;
  flushing = true;
  try {
    for (const o of [...S.outbox]) {
      if (o.err || (o.uid && o.uid !== S.user.id)) continue;
      if (!S.outbox.includes(o)) continue;
      o.busy = true;
      const r = await emit('message:send', { channelId: o.cid, text: o.text, replyTo: o.replyTo, nonce: o.nonce });
      o.busy = false;
      if (r.error && /Sem conexão|não respondeu/.test(r.error)) break;   // caiu de novo: fica para a próxima
      if (r.error) o.err = r.error;
      else S.outbox = S.outbox.filter(x => x !== o);
      saveOutbox();
      if (S.cid === o.cid) renderMessages(r.error ? 'keep' : undefined);
    }
  } finally { flushing = false; }
}
window.flushOutbox = flushOutbox;
document.getElementById('messages').addEventListener('click', e => {
  const row = e.target.closest('[data-out]'); if (!row) return;
  const o = S.outbox.find(x => x.nonce === row.dataset.out); if (!o) return;
  if (e.target.closest('[data-out-del]')) { S.outbox = S.outbox.filter(x => x !== o); saveOutbox(); renderMessages('keep'); if (conn.shown) connPaint(); }
  else if (e.target.closest('[data-out-retry]')) { delete o.err; saveOutbox(); renderMessages('keep'); flushOutbox(); }
});

// ---------------------------------------------------------------------
// Mensagem nova entra com um movimento leve; botão para voltar ao fim da conversa
// ---------------------------------------------------------------------
const msgBox = document.getElementById('messages');
const jump = document.createElement('button');
jump.type = 'button'; jump.id = 'jump'; jump.className = 'jump hidden';
document.getElementById('chat-view').appendChild(jump);
let jumpNew = 0;
const farFromEnd = () => msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight > 320;
function paintJump() {
  const far = farFromEnd();
  if (!far) jumpNew = 0;
  jump.classList.toggle('hidden', !far);
  jump.classList.toggle('new', far && jumpNew > 0);
  jump.innerHTML = I.down + `<span>${jumpNew ? (jumpNew === 1 ? '1 mensagem nova' : jumpNew + ' mensagens novas') : 'Ir para o fim'}</span>`;
}
jump.onclick = () => { jumpNew = 0; msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
msgBox.addEventListener('scroll', () => requestAnimationFrame(paintJump), { passive: true });
let lastCidRendered = null;
window.afterRenderMessages = mode => {
  if (lastCidRendered !== S.cid) { lastCidRendered = S.cid; jumpNew = 0; }
  if (mode === true) {
    const rows = msgBox.querySelectorAll('.msg:not(.pending), .sysmsg');
    rows[rows.length - 1]?.classList.add('in');
    const last = S.msgs[S.cid]?.at(-1);
    if (last && last.userId !== S.user?.id) requestAnimationFrame(() => { if (farFromEnd()) { jumpNew++; paintJump(); } });
  }
  requestAnimationFrame(paintJump);
};

// botão de enviar "acende" quando tem o que mandar
const composerEl = document.getElementById('composer'), msgInput = document.getElementById('msg-input');
const paintReady = () => composerEl.classList.toggle('ready', !!msgInput.value.trim() || (S.atts || []).some(a => a.att));
msgInput.addEventListener('input', paintReady);
setInterval(paintReady, 500);

// ---------------------------------------------------------------------
// Ir direto para uma conversa (Ctrl+K ou o campo "Ir para…")
// ---------------------------------------------------------------------
const qs = document.createElement('div');
qs.id = 'qs'; qs.className = 'qs hidden';
qs.innerHTML = `<div class="qs-card" role="dialog" aria-label="Ir para uma conversa">
  <div class="qs-in">${I.search}<input id="qs-q" placeholder="Para onde você quer ir?" autocomplete="off" spellcheck="false"></div>
  <div class="qs-list" id="qs-list"></div>
  <div class="qs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></div></div>`;
document.body.appendChild(qs);
const qsFold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let qsItems = [], qsSel = 0;
function qsAll() {
  const out = [];
  const un = id => unreadOf(id);
  for (const d of [...S.dms].sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0)))
    out.push({ k: 'dm', id: d.user.id, name: d.user.name, sub: '@' + d.user.username, user: d.user, n: unreadOf(dmChannelId(d.user.id)), go: () => openDM(d.user.id) });
  for (const u of S.friends.friends) if (!S.dms.some(d => d.user.id === u.id))
    out.push({ k: 'dm', id: u.id, name: u.name, sub: '@' + u.username, user: u, n: 0, go: () => openDM(u.id) });
  for (const g of S.groups) for (const c of g.channels) if (c.type === 'text')
    out.push({ k: 'ch', id: c.id, name: c.name, sub: g.name, n: un(c.id), cur: g.id === S.gid, go: () => openTextChannel(c.id) });
  for (const g of S.groups) out.push({ k: 'g', id: g.id, name: g.name, sub: 'Grupo', n: 0, go: () => selectGroup(g.id) });
  out.push({ k: 'home', id: '@friends', name: 'Amigos', sub: 'Mensagens diretas', n: S.friends.in.length, go: () => openFriends() });
  return out;
}
function qsRender() {
  const q = qsFold(document.getElementById('qs-q').value.trim());
  let items = qsAll();
  if (q) {
    items = items.map(i => { const n = qsFold(i.name), s = qsFold(i.sub); const sc = n.startsWith(q) ? 3 : n.includes(q) ? 2 : s.includes(q) ? 1 : 0; return { ...i, sc }; }).filter(i => i.sc).sort((a, b) => b.sc - a.sc || b.n - a.n);
  } else {
    // sem digitar nada: primeiro o que tem mensagem não lida, depois as conversas e os canais do grupo aberto
    items = [...items.filter(i => i.n), ...items.filter(i => !i.n && (i.k === 'dm' || i.cur))].filter(i => i.id !== S.cid);
  }
  qsItems = items.slice(0, 12);
  qsSel = Math.min(qsSel, Math.max(0, qsItems.length - 1));
  document.getElementById('qs-list').innerHTML = qsItems.length ? qsItems.map((i, n) => `<button type="button" class="qs-it${n === qsSel ? ' sel' : ''}" data-n="${n}">
      <span class="qs-ic">${i.k === 'dm' ? avatar(i.user, 'sm') : i.k === 'ch' ? I.hash : i.k === 'g' ? I.users : I.home}</span>
      <span class="qs-nm">${esc(i.name)}</span><span class="qs-sub">${esc(i.sub)}</span>${i.n ? `<span class="badge">${i.n > 99 ? '99+' : i.n}</span>` : ''}</button>`).join('')
    : `<p class="qs-empty">${q ? 'Nada com esse nome. Confira se escreveu certo.' : 'Você ainda não tem conversas. Adicione um amigo ou entre em um grupo.'}</p>`;
}
function openQuick() {
  if (!S.user) return;
  qsSel = 0;
  qs.classList.remove('hidden');
  const q = document.getElementById('qs-q'); q.value = ''; qsRender();
  closeDrawer();
  setTimeout(() => q.focus(), 0);
}
function closeQuick() { qs.classList.add('hidden'); }
function qsGo(n) { const it = qsItems[n]; if (!it) return; closeQuick(); it.go(); }
document.getElementById('qs-q').addEventListener('input', () => { qsSel = 0; qsRender(); });
qs.addEventListener('mousedown', e => { if (e.target === qs) closeQuick(); });
qs.addEventListener('click', e => { const b = e.target.closest('.qs-it'); if (b) qsGo(+b.dataset.n); });
qs.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qsSel = (qsSel + (e.key === 'ArrowDown' ? 1 : -1) + qsItems.length) % Math.max(1, qsItems.length); qsRender(); qs.querySelector('.qs-it.sel')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); qsGo(qsSel); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuick(); }
});
window.openQuick = openQuick;

// ---------------------------------------------------------------------
// Atalhos do teclado (PC)
// ---------------------------------------------------------------------
const overlayOpen = () => !qs.classList.contains('hidden') || ['#modal', '#settings', '#lightbox', '#ctx'].some(x => !document.querySelector(x).classList.contains('hidden'));
document.addEventListener('keydown', e => {
  // Ctrl+K: ir para uma conversa
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    if (!S.user || ['#modal', '#settings', '#lightbox'].some(x => !document.querySelector(x).classList.contains('hidden'))) return;
    e.preventDefault();
    qs.classList.contains('hidden') ? openQuick() : closeQuick();
    return;
  }
  if (overlayOpen() || S.view !== 'chat') return;
  const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  // seta para cima com a caixa vazia: editar a minha última mensagem
  if (e.key === 'ArrowUp' && a === msgInput && !msgInput.value && !S.editing && !e.shiftKey) {
    const m = [...(S.msgs[S.cid] || [])].reverse().find(x => x.userId === S.user.id && !x.sys && x.text);
    if (m) { e.preventDefault(); startEdit(m); }
    return;
  }
  // começou a digitar com o foco fora da caixa: o texto vai para a mensagem
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && e.key !== ' ' && !msgInput.disabled && !isMobile()) msgInput.focus();
});
// dois cliques na mensagem: responder
msgBox.addEventListener('dblclick', e => {
  if (isMobile() || e.target.closest('a,button,video,img,.vp,.att-file,.reacts')) return;
  const row = e.target.closest('.msg[data-id]'); if (!row || !row.querySelector('[data-t=reply]')) return;
  const m = (S.msgs[S.cid] || []).find(x => x.id === row.dataset.id); if (!m) return;
  getSelection()?.removeAllRanges();
  startReply(m);
});

// ---------------------------------------------------------------------
// Celular: arrastar da borda esquerda abre o menu; arrastar para a esquerda fecha
// ---------------------------------------------------------------------
(() => {
  let sx = 0, sy = 0, mode = null;
  const appEl = document.getElementById('app');
  document.addEventListener('touchstart', e => {
    mode = null;
    if (!isMobile() || e.touches.length !== 1 || overlayOpen() || document.body.classList.contains('cinema')) return;
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
    if (appEl.classList.contains('drawer')) mode = 'close';
    else if (sx < 28 && !appEl.classList.contains('show-members')) mode = 'open';
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!mode) return;
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { mode = null; return; }
    if (mode === 'open' && dx > 56) { mode = null; openDrawer(); }
    else if (mode === 'close' && dx < -56) { mode = null; closeDrawer(); }
  }, { passive: true });
  document.addEventListener('touchend', () => { mode = null; }, { passive: true });
})();

// se já tinha mensagem guardada de antes (fechou o app sem internet), manda agora
setTimeout(() => flushOutbox(), 3000);
