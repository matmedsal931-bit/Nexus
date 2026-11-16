'use strict';
/* =====================================================================
   Nexo - configurações pessoais
   Minha conta (senha, aparelhos), voz e vídeo, notificações e aparência.
   Usa a mesma tela cheia das configurações do grupo.
   ===================================================================== */

const ACC_TABS = [
  ['conta', 'Minha conta'],
  ['audio', 'Áudio e Voz'],
  ['video', 'Vídeo'],
  ['notif', 'Notificações'],
  ['aparencia', 'Aparência'],
];
const ACC = { tab: 'conta', test: null };
function openAccount(tab = 'conta') {
  closeCtx();
  closeDrawer();
  SET.gid = null;                       // não é a tela de um grupo
  ACC.tab = tab;
  $('#settings').classList.remove('hidden');
  renderAccount();
}
// Ao fechar: desliga o teste de microfone/câmera
window.onSettingsClose = () => stopDeviceTest();

function renderAccount() {
  const nav = $('#set-nav');
  nav.innerHTML = `<div class="set-title">Configurações</div>`
    + ACC_TABS.map(([k, l]) => `<button class="set-tab ${k === ACC.tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')
    + `<div class="set-sec"></div><button class="set-tab danger" data-t="sair">Sair da conta</button>`;
  nav.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    if (b.dataset.t === 'sair') return confirmModal('Sair da conta?', 'Você poderá entrar de novo quando quiser.', 'Sair', logout);
    stopDeviceTest();
    ACC.tab = b.dataset.t;
    renderAccount();
  });
  const body = $('#set-body');
  body.scrollTop = 0;
  if (ACC.tab === 'voz') ACC.tab = 'audio';
  ({ conta: accConta, audio: accAudio, video: accVideo, notif: accNotif, aparencia: accLook })[ACC.tab](body);
}

// ---------------------------------------------------------------------
// Minha conta
// ---------------------------------------------------------------------
async function accConta(body) {
  const u = S.user;
  body.innerHTML = `<h2>Minha conta</h2>
    <div class="acc-card">
      <div class="acc-banner" style="background:${esc(u.banner || u.color)}"></div>
      <div class="acc-row">${avatar(u, 'xl anim nodot')}
        <div class="col"><b>${esc(u.name)}</b><span>@${esc(u.username)}</span></div>
        <button class="btn primary" id="ac-edit">Editar perfil</button></div>
      <div class="acc-fields">
        <div><span class="pf-h">Nome exibido</span><div>${esc(u.name)}</div></div>
        <div><span class="pf-h">Nome de usuário (login)</span><div>@${esc(u.username)}</div></div>
        <div><span class="pf-h">ID</span><div class="row l"><code>${esc(u.id)}</code><button class="btn sm" id="ac-copy">Copiar</button></div></div>
      </div>
    </div>
    <div class="set-block"><div class="pf-h">Trocar senha</div>
      <form id="ac-pw" class="pw-form" autocomplete="off">
        <input type="password" id="ac-cur" placeholder="Senha atual" autocomplete="current-password" required>
        <input type="password" id="ac-new" placeholder="Senha nova (mínimo 6)" autocomplete="new-password" minlength="6" required>
        <input type="password" id="ac-new2" placeholder="Repita a senha nova" autocomplete="new-password" minlength="6" required>
        <button class="btn primary">Trocar senha</button>
      </form>
      <p class="muted small">Ao trocar a senha, os seus outros aparelhos são desconectados.</p></div>
    <div class="set-block"><div class="pf-h">Aparelhos conectados</div>
      <p id="ac-sess" class="muted">Verificando…</p>
      <div class="row l"><button class="btn" id="ac-others">Sair de todos os outros aparelhos</button></div></div>`;
  const q = s => body.querySelector(s);
  q('#ac-edit').onclick = () => { closeSettings(); editProfile(); };
  q('#ac-copy').onclick = () => navigator.clipboard?.writeText(u.id).then(() => toast('ID copiado!')).catch(() => toast(u.id));
  q('#ac-pw').onsubmit = async e => {
    e.preventDefault();
    if (q('#ac-new').value !== q('#ac-new2').value) return toast('As duas senhas novas não são iguais.');
    const btn = e.submitter || q('#ac-pw button'); btn.disabled = true;
    const r = await emit('account:password', { current: q('#ac-cur').value, next: q('#ac-new').value });
    btn.disabled = false;
    if (r.error) return toast(r.error);
    q('#ac-pw').reset();
    toast('Senha trocada! Os outros aparelhos vão precisar entrar de novo.', 5000);
    showSessions();
  };
  q('#ac-others').onclick = () => confirmModal('Sair dos outros aparelhos?', 'Todos os aparelhos, menos este, vão precisar entrar de novo.', 'Sair dos outros', async () => {
    const r = await emit('account:logout-others');
    if (r.error) return toast(r.error);
    toast('Pronto: só este aparelho continua conectado.');
    showSessions();
  });
  const showSessions = async () => {
    const r = await emit('account:sessions');
    const el = body.querySelector('#ac-sess');
    if (!el) return;
    el.textContent = r.error ? r.error : r.sessions <= 1 ? 'Só este aparelho está conectado.' : `Sua conta está conectada em ${r.sessions} aparelhos (contando este).`;
  };
  showSessions();
}

// ---------------------------------------------------------------------
// Voz e vídeo
// ---------------------------------------------------------------------
async function listDevices() {
  try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; }
}
function stopDeviceTest() {
  const t = ACC.test;
  if (!t) return;
  clearInterval(t.timer);
  t.stream?.getTracks().forEach(x => x.stop());
  t.cam?.getTracks().forEach(x => x.stop());
  ACC.test = null;
}
// ---------------------------------------------------------------------
// Áudio e Voz
// ---------------------------------------------------------------------
const devOpts = (devs, kind, cur) => {
  const list = devs.filter(d => d.kind === kind);
  return `<option value="">Padrão do sistema</option>` + list.map((d, i) =>
    `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `${kind === 'videoinput' ? 'Câmera' : kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}`)}</option>`).join('');
};
const noMediaMsg = t => `<h2>${t}</h2><p class="muted">Este navegador não permite usar microfone e câmera${location.protocol !== 'https:' ? ' (o site precisa abrir com https://)' : ''}.</p>`;
const allowBox = named => named ? '' : `<div class="acc-note">Para mostrar o nome dos seus aparelhos, o navegador precisa de permissão.
  <button class="btn primary sm" id="av-allow">Permitir acesso</button></div>`;
function wireAllow(q) {
  q('#av-allow')?.addEventListener('click', async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(t => t.stop()); }
    catch { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch { return toast('O navegador não deu permissão.'); } }
    renderAccount();
  });
}
const KIND_LABEL = { none: 'sem supressão de IA', rnnoise: 'RNNoise (IA)', gtcrn: 'GTCRN (IA forte)' };
const gateHelp2 = () => prefs.gate === 'auto' ? 'O Nexo aprende o barulho do seu ambiente e só envia o som quando você fala. A marca amarela mostra o limite.'
  : prefs.gate === 'manual' ? 'Arraste a marca: o som só é enviado quando a barra passa dela (fica verde). Fale baixo e veja se ainda fica verde.'
  : 'O microfone envia tudo o tempo todo, inclusive o barulho do ambiente.';
const pctOf = db => Math.max(0, Math.min(100, (db + 80) / 80 * 100));

async function accAudio(body) {
  if (!hasMedia()) { body.innerHTML = noMediaMsg('Áudio e Voz'); return; }
  const devs = await listDevices();
  const named = devs.some(d => d.label);
  const room = call.channelId && call.vcfg?.ns;
  const tg = (id, title, desc, on) => `<label class="perm"><div><b>${title}</b><p>${desc}</p></div><input type="checkbox" class="tg" id="${id}" ${on ? 'checked' : ''}></label>`;
  body.innerHTML = `<h2>Áudio e Voz</h2>
    ${allowBox(named)}
    <section class="aud-sec"><h3>Dispositivo de entrada</h3>
      <label class="fld">Microfone<select class="sel" id="av-mic">${devOpts(devs, 'audioinput', prefs.mic)}</select></label>
      <div class="fld">Volume de entrada<div class="vol">${I.mic}<input type="range" min="0" max="200" step="5" value="${prefs.inVol ?? 100}" id="av-invol"><b id="av-involl">${prefs.inVol ?? 100}%</b></div></div>
      <div class="live-row"><button class="btn" id="av-test">${I.mic}Testar microfone</button>
        <div class="meter gate big"><i id="av-bar"></i><b id="av-th" style="left:${pctOf(prefs.gateDb)}%"></b>
          <input type="range" id="av-gdb" min="-80" max="-10" step="1" value="${prefs.gateDb}" ${prefs.gate === 'manual' ? '' : 'disabled'} aria-label="Limite de ativação"></div></div>
      <p class="muted small" id="av-live">Clique em "Testar microfone" e fale: a barra mostra o volume que sai depois do tratamento.</p>
    </section>
    <section class="aud-sec"><h3>Dispositivo de saída</h3>
      ${canPickOutput() ? `<label class="fld">Alto-falante ou fone<select class="sel" id="av-out">${devOpts(devs, 'audiooutput', prefs.out)}</select></label>` : '<p class="muted small">Este navegador usa sempre a saída padrão do sistema.</p>'}
      <button class="btn sm" id="av-beep">${I.vol}Tocar som de teste</button>
    </section>
    <section class="aud-sec"><h3>Supressão de ruído</h3>
      <div class="ns-grid" id="av-ns">${NS_LEVELS.map(([k, l, d]) => `<button class="ns-card ${normNs(prefs.ns) === k ? 'on' : ''}" data-ns="${k}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>
      ${tg('av-room', 'Usar a recomendação da sala', 'Algumas salas pedem um nível específico. Só vale enquanto você estiver nelas.', prefs.followRoomNs !== false)}
      ${room ? `<p class="muted small">A sala em que você está recomenda: <b>${NS_LABEL[room]}</b>.</p>` : ''}
    </section>
    <section class="aud-sec"><h3>Sensibilidade do microfone</h3>
      <div class="pf-h">Modo de entrada</div>
      <div class="seg" id="av-mode">${[['vad', 'Detecção de voz'], ['ptt', 'Pressionar para falar']].map(([k, v]) => `<button data-m="${k}" class="${(prefs.inputMode || 'vad') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="row l ${prefs.inputMode === 'ptt' ? '' : 'hidden'}" id="av-pttrow" style="margin-top:10px;gap:10px;align-items:center">
        <span>Tecla:</span><button class="btn sm" id="av-key">${esc(keyLabel(prefs.pttKey))}</button><span class="muted small">clique e aperte a tecla</span></div>
      <p class="muted small">Pressionar para falar funciona com o Nexo aberto na frente (o navegador não recebe teclas de outros programas). No celular aparece o botão "Segure para falar".</p>
      <div class="pf-h">Detecção de voz</div>
      <div class="seg" id="av-gate">${[['auto', 'Automática'], ['manual', 'Limite manual'], ['off', 'Sempre transmitir']].map(([k, v]) => `<button data-g="${k}" class="${prefs.gate === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <p class="muted small" id="av-gtxt">${gateHelp2()}</p>
    </section>
    <section class="aud-sec"><h3>Processamento de voz</h3>
      ${tg('av-echo', 'Cancelamento de eco', 'Não deixa o som do seu alto-falante voltar pelo microfone. Com fone de ouvido, pode desligar.', prefs.echo !== false)}
      ${tg('av-agc', 'Normalização de volume', 'Deixa sua voz sempre no mesmo volume, falando baixo ou alto (ajuste lento, sem "bombear").', prefs.agc !== false)}
      ${tg('av-comp', 'Compressor', 'Segura gritos e risadas altas para não estourar no ouvido dos outros.', prefs.comp !== false)}
      ${tg('av-hpf', 'Filtro de graves', 'Corta ronco grave: vento, batida na mesa, ar-condicionado.', prefs.hpf !== false)}
      ${tg('av-click', 'Proteção contra cliques', 'Teclas e cliques de mouse sozinhos não abrem o seu microfone.', prefs.clickGuard !== false)}
    </section>
    <section class="aud-sec"><h3>Teste de gravação</h3>
      <p class="muted small">Grave 5 segundos falando com o barulho de sempre (ventilador, teclado…). Depois compare o mesmo trecho original e com cada nível de supressão.</p>
      <div class="rec-row"><button class="btn primary" id="ar-rec">${I.mic}Gravar 5 segundos</button><div class="meter big"><i id="ar-bar"></i></div><span class="muted small" id="ar-t"></span></div>
      <div id="ar-out" class="hidden">
        <div class="seg" id="ar-lvl">${NS_LEVELS.map(([k, l]) => `<button data-l="${k}" class="${normNs(prefs.ns) === k ? 'on' : ''}" ${k === 'low' ? 'disabled title="O Baixo usa o filtro do navegador, que só funciona ao vivo. Use Testar microfone para ouvir o efeito."' : ''}>${l}</button>`).join('')}</div>
        <div class="ab">
          <div class="ab-col"><div class="ab-h"><b>Original</b><button class="btn sm" id="ar-pa">${I.vol}Ouvir</button></div><canvas id="ar-wa" width="600" height="70"></canvas></div>
          <div class="ab-col"><div class="ab-h"><b id="ar-lb">Com supressão</b><button class="btn sm primary" id="ar-pb">${I.vol}Ouvir</button></div><canvas id="ar-wb" width="600" height="70"></canvas></div>
        </div>
        <p class="muted small" id="ar-info"></p>
      </div>
    </section>`;
  const q = s => body.querySelector(s);
  wireAllow(q);
  const reMic = () => { if (call.micTrack) switchMicDevice(true); if (ACC.test?.stream) restartMicTest(); };
  q('#av-mic').onchange = e => { setPref('mic', e.target.value); toast('Microfone salvo.'); reMic(); };
  q('#av-invol').oninput = e => { setPref('inVol', Number(e.target.value)); q('#av-involl').textContent = e.target.value + '%'; updateGate(); };
  q('#av-out')?.addEventListener('change', e => { setPref('out', e.target.value); applySinkAll(); toast('Saída de som salva.'); });
  q('#av-beep').onclick = () => playTestTone();
  q('#av-ns').onclick = e => {
    const b = e.target.closest('[data-ns]'); if (!b) return;
    setPref('ns', b.dataset.ns); setPref('nsSet', 1);
    q('#av-ns').querySelectorAll('.ns-card').forEach(x => x.classList.toggle('on', x === b));
    reMic();
    if (ACC.clip) { setLvl(b.dataset.ns); }
  };
  q('#av-room').onchange = e => { setPref('followRoomNs', e.target.checked); reMic(); };
  const live = (id, key) => q(id).onchange = e => { setPref(key, e.target.checked); updateGate(); };
  q('#av-echo').onchange = e => { setPref('echo', e.target.checked); setPref('nsSet', 1); reMic(); };
  q('#av-hpf').onchange = e => { setPref('hpf', e.target.checked); reMic(); };
  live('#av-agc', 'agc'); live('#av-comp', 'comp'); live('#av-click', 'clickGuard');
  q('#av-mode').onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    setPref('inputMode', b.dataset.m);
    q('#av-mode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    q('#av-pttrow').classList.toggle('hidden', b.dataset.m !== 'ptt');
    applyPtt(); if (call.channelId) renderControls();
  };
  q('#av-key').onclick = () => {
    const b = q('#av-key');
    b.textContent = 'Aperte uma tecla…';
    const grab = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.code !== 'Escape') setPref('pttKey', e.code);
      b.textContent = keyLabel(prefs.pttKey);
      document.removeEventListener('keydown', grab, true);
    };
    document.addEventListener('keydown', grab, true);
  };
  q('#av-gate').onclick = e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    setPref('gate', b.dataset.g);
    q('#av-gate').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    q('#av-gdb').disabled = prefs.gate !== 'manual';
    q('#av-gtxt').textContent = gateHelp2();
    updateGate();
    if (!ACC.test?.stream) restartMicTest();
  };
  q('#av-gdb').oninput = e => { setPref('gateDb', Number(e.target.value)); q('#av-th').style.left = pctOf(prefs.gateDb) + '%'; updateGate(); };

  // ---- teste ao vivo (o mesmo tratamento da chamada) ----
  const restartMicTest = async () => {
    if (ACC.test?.stream) ACC.test.stream.getTracks().forEach(x => x.stop());
    try {
      const track = await acquireMic(d => {
        const bar = document.getElementById('av-bar'), th = document.getElementById('av-th'), txt = document.getElementById('av-live');
        if (!bar) return;
        bar.style.width = pctOf(d.level) + '%';
        bar.classList.toggle('open', !!d.open);
        if (th && prefs.gate === 'auto') th.style.left = pctOf(d.th) + '%';
        if (txt) txt.innerHTML = `${d.open ? '<b class="ok">Enviando sua voz</b>' : 'Microfone fechado (não está ouvindo voz)'} · ruído do ambiente: ${Math.round(d.rawFloor)} dB${d.imp >= 0.4 ? ` · cliques/teclas: ${d.imp.toFixed(1)} por segundo` : ''} · supressor agora: <b>${KIND_LABEL[d.kind] || '—'}</b>${normNs(effectiveNs()) === 'low' ? ' + filtro do navegador' : ''}`;
      });
      ACC.test = { ...(ACC.test || {}), stream: new MediaStream([track]), track };
      q('#av-test').innerHTML = `${I.micOff}Parar teste`;
    } catch { toast('Não consegui usar o microfone.'); }
  };
  q('#av-test').onclick = () => {
    if (ACC.test?.stream) {
      ACC.test.stream.getTracks().forEach(x => x.stop());
      ACC.test.stream = null; ACC.test.track = null; q('#av-test').innerHTML = `${I.mic}Testar microfone`;
      const bar = document.getElementById('av-bar'); if (bar) bar.style.width = '0';
    } else restartMicTest();
  };

  // ---- gravação para comparar ----
  const draw = (cv, y) => {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = getComputedStyle(document.body).getPropertyValue('--acc') || '#7b61ff';
    const step = Math.max(1, Math.floor(y.length / W));
    for (let x = 0; x < W; x++) {
      let m = 0; for (let i = x * step; i < (x + 1) * step && i < y.length; i++) { const v = Math.abs(y[i]); if (v > m) m = v; }
      const h = Math.max(1, Math.min(1, m * 1.4) * H);
      c.fillRect(x, (H - h) / 2, 1, h);
    }
  };
  let playing = null;
  const play = y => {
    try { playing?.stop(); } catch {}
    ensureAudioCtx();
    const ctx = call.audioCtx, b = ctx.createBuffer(1, y.length, ACC.clip.sr); b.copyToChannel(y, 0);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); playing = s;
  };
  const setLvl = async lvl => {
    if (!ACC.clip || lvl === 'low') return;
    q('#ar-lvl').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.l === lvl));
    q('#ar-lb').textContent = 'Processando…';
    const r = await renderClip(ACC.clip, lvl);
    ACC.proc = r.y;
    draw(q('#ar-wb'), r.y);
    q('#ar-lb').textContent = `Com supressão: ${NS_LABEL[lvl]}`;
    const peak = a => { let m = 0; for (const v of a) { const x = Math.abs(v); if (x > m) m = x; } return m; };
    q('#ar-info').textContent = (lvl === 'auto' ? `O automático escolheu: ${KIND_LABEL[r.autoKind]}. ` : '')
      + 'Os dois tocam o mesmo trecho gravado.' + (peak(ACC.clip.raw) < 0.01 ? ' A gravação ficou muito baixa: confira o microfone escolhido.' : '');
  };
  q('#ar-lvl').onclick = e => { const b = e.target.closest('[data-l]'); if (b) setLvl(b.dataset.l); };
  q('#ar-pa').onclick = () => ACC.clip && play(ACC.clip.raw);
  q('#ar-pb').onclick = () => ACC.proc && play(ACC.proc);
  q('#ar-rec').onclick = async () => {
    const btn = q('#ar-rec'); btn.disabled = true;
    try {
      ACC.clip = await recordRaw(5, (db, t) => {
        const bar = document.getElementById('ar-bar'); if (bar) bar.style.width = pctOf(db) + '%';
        const tt = document.getElementById('ar-t'); if (tt) tt.textContent = `Gravando… ${Math.max(0, 5 - t).toFixed(1)} s`;
      });
      q('#ar-t').textContent = 'Pronto. Compare abaixo.';
      q('#ar-out').classList.remove('hidden');
      draw(q('#ar-wa'), ACC.clip.raw);
      await setLvl(normNs(prefs.ns) === 'low' ? 'off' : normNs(prefs.ns));
    } catch (e) { console.warn(e); toast('Não consegui gravar o microfone.'); }
    btn.disabled = false; btn.innerHTML = `${I.mic}Gravar de novo`;
    const bar = document.getElementById('ar-bar'); if (bar) bar.style.width = '0';
  };
}
// Som de teste na saída escolhida
async function playTestTone() {
  const sr = 48000, n = sr * 0.9, ctx = new OfflineAudioContext(1, n, sr);
  [[660, 0], [880, 0.18], [1320, 0.36]].forEach(([f, t]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.45);
  });
  const y = (await ctx.startRendering()).getChannelData(0);
  const i16 = new Int16Array(y.length); for (let i = 0; i < y.length; i++) i16[i] = y[i] * 32767;
  const h = new DataView(new ArrayBuffer(44)); const w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + i16.byteLength, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, i16.byteLength, true);
  const a = new Audio(URL.createObjectURL(new Blob([h.buffer, i16.buffer], { type: 'audio/wav' })));
  try { if (prefs.out && a.setSinkId) await a.setSinkId(prefs.out); } catch {}
  a.play().catch(() => toast('O navegador bloqueou o som. Clique de novo.'));
}

// ---------------------------------------------------------------------
// Vídeo
// ---------------------------------------------------------------------
async function accVideo(body) {
  if (!hasMedia()) { body.innerHTML = noMediaMsg('Vídeo'); return; }
  const devs = await listDevices();
  body.innerHTML = `<h2>Vídeo</h2>${allowBox(devs.some(d => d.label))}
    <label class="fld">Câmera<select class="sel" id="av-cam">${devOpts(devs, 'videoinput', prefs.cam)}</select></label>
    <div class="set-block"><div class="pf-h">Testar câmera</div>
      <div class="cam-test"><video id="av-video" autoplay playsinline muted></video><button class="btn" id="av-camtest">Ligar a câmera de teste</button></div></div>`;
  const q = s => body.querySelector(s);
  wireAllow(q);
  const startCamTest = async () => {
    ACC.test?.cam?.getTracks().forEach(x => x.stop());
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, ...camDeviceConstraint() } });
      ACC.test = { ...(ACC.test || {}), cam };
      q('#av-video').srcObject = cam;
      q('#av-camtest').textContent = 'Desligar a câmera de teste';
    } catch { toast('Não consegui usar a câmera.'); }
  };
  q('#av-cam').onchange = e => { setPref('cam', e.target.value); toast('Câmera salva.'); if (ACC.test?.cam) startCamTest(); };
  q('#av-camtest').onclick = () => {
    if (ACC.test?.cam) { ACC.test.cam.getTracks().forEach(x => x.stop()); ACC.test.cam = null; q('#av-video').srcObject = null; q('#av-camtest').textContent = 'Ligar a câmera de teste'; }
    else startCamTest();
  };
}

// ---------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------
function accNotif(body) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permTxt = { granted: '✅ Ativadas neste aparelho.', denied: '🚫 Bloqueadas pelo navegador. Libere nas configurações do site (ícone de cadeado na barra de endereço).',
    default: 'Ainda não ativadas neste aparelho.', unsupported: 'Este navegador não mostra notificações.' }[perm];
  body.innerHTML = `<h2>Notificações</h2>
    <div class="set-block" style="border:0;padding-top:0"><div class="pf-h">Avisos do sistema</div>
      <p class="muted">${permTxt}</p>
      ${perm === 'default' ? '<div class="row l"><button class="btn primary" id="an-ask">Ativar notificações</button></div>' : ''}</div>
    <div class="set-block"><div class="pf-h">Quando avisar</div>
      ${[['all', 'Todas as mensagens', 'Grupos (menos os silenciados) e conversas privadas.'],
         ['mentions', 'Só menções e conversas privadas', 'Grupos só avisam quando alguém escrever @' + esc(S.user.username) + '.'],
         ['none', 'Nunca', 'Nenhum aviso nem som.']].map(([k, t, d]) =>
        `<label class="radio-row"><input type="radio" name="an-lvl" value="${k}" ${prefs.notify === k ? 'checked' : ''}><div><b>${t}</b><p>${d}</p></div></label>`).join('')}</div>
    <label class="perm"><div><b>Tocar som</b><p>Um bipe curto quando chega mensagem que avisa.</p></div>
      <input type="checkbox" class="tg" id="an-sound" ${prefs.sound ? 'checked' : ''}></label>
    <label class="perm"><div><b>Sons da chamada</b><p>Entrar, sair, mutar, desmutar, transmissão e o toque de ligação.</p></div>
      <input type="checkbox" class="tg" id="an-sfx" ${prefs.sfx !== false ? 'checked' : ''}></label>
    <div class="set-block"><div class="pf-h">Volume dos sons</div>
      <div class="vol">${I.vol}<input type="range" min="0" max="100" step="5" value="${prefs.sfxVol ?? 80}" id="an-vol"><b id="an-voll">${prefs.sfxVol ?? 80}%</b></div>
      <div class="row l snd-test">${[['ring', 'Toque de ligação'], ['join', 'Entrar'], ['leave', 'Sair'], ['mute', 'Mutar'], ['unmute', 'Desmutar'], ['deafen', 'Desativar áudio'], ['modMute', 'Moderador silenciou'], ['live', 'Transmissão']].map(([k, v]) => `<button class="btn sm" data-snd="${k}">${v}</button>`).join('')}</div>
      <p class="muted small">No status <b>Não perturbar</b>, nada avisa e a ligação aparece sem tocar.</p></div>
    <div class="set-block"><div class="pf-h">Grupos silenciados</div>
      ${prefs.muted.filter(id => group(id)).length
        ? prefs.muted.filter(id => group(id)).map(id => `<div class="row l mute-row"><span>${esc(group(id).name)}</span><button class="btn sm" data-un="${esc(id)}">Voltar a avisar</button></div>`).join('')
        : '<p class="muted">Nenhum. Para silenciar, clique no nome do grupo e em "Silenciar grupo".</p>'}</div>`;
  const q = s => body.querySelector(s);
  q('#an-ask')?.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch {} renderAccount(); });
  body.querySelectorAll('[name=an-lvl]').forEach(r => r.onchange = () => { setPref('notify', r.value); toast('Salvo.'); });
  q('#an-sound').onchange = e => { setPref('sound', e.target.checked); if (e.target.checked) { lastSound = 0; playNotifySound(); } };
  q('#an-sfx').onchange = e => setPref('sfx', e.target.checked);
  q('#an-vol').oninput = e => { setPref('sfxVol', Number(e.target.value)); q('#an-voll').textContent = e.target.value + '%'; };
  q('#an-vol').onchange = () => SFX.play('unmute');
  body.querySelectorAll('[data-snd]').forEach(b => b.onclick = () => {
    if (b.dataset.snd === 'ring') {
      if (SFX.ringing) { SFX.stop('ring'); b.textContent = 'Toque de ligação'; return; }
      SFX.ring(); b.textContent = 'Parar toque';
      setTimeout(() => { if (SFX.ringing && !ring.channelId) { SFX.stop('ring'); b.textContent = 'Toque de ligação'; } }, 7000);
    } else SFX.play(b.dataset.snd);
  });
  body.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { toggleGroupMute(b.dataset.un); renderAccount(); });
}

// ---------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------
function accLook(body) {
  body.innerHTML = `<h2>Aparência</h2>
    <div class="set-block" style="border:0;padding-top:0"><div class="pf-h">Tamanho do texto</div>
      <div class="row l"><input type="range" id="al-fs" min="13" max="19" step="1" value="${prefs.fontSize}"><b id="al-fsv">${prefs.fontSize}px</b></div></div>
    <label class="perm"><div><b>Mensagens compactas</b><p>Menos espaço entre as mensagens, para ver mais de uma vez.</p></div>
      <input type="checkbox" class="tg" id="al-cp" ${prefs.compact ? 'checked' : ''}></label>
    <div class="set-block"><div class="pf-h">Prévia</div>
      <div class="look-prev">${msgHtml({ id: 'prev1', userId: S.user.id, username: S.user.username, color: S.user.color, text: 'Assim ficam as mensagens 👋', ts: Date.now() }, false)}
      ${msgHtml({ id: 'prev2', userId: S.user.id, username: S.user.username, color: S.user.color, text: 'Uma segunda mensagem, logo depois.', ts: Date.now() }, true)}</div></div>`;
  const q = s => body.querySelector(s);
  q('#al-fs').oninput = e => { setPref('fontSize', +e.target.value); q('#al-fsv').textContent = e.target.value + 'px'; };
  q('#al-cp').onchange = e => setPref('compact', e.target.checked);
}
