'use strict';
/* =====================================================================
   Nexo - configurações pessoais
   Minha conta (senha, aparelhos), voz e vídeo, notificações e aparência.
   Usa a mesma tela cheia das configurações do grupo.
   ===================================================================== */

const ACC_TABS = [
  ['conta', 'Minha conta'],
  ['voz', 'Voz e vídeo'],
  ['notif', 'Notificações'],
  ['aparencia', 'Aparência'],
];
const ACC = { tab: 'conta', test: null };
function nsHelp() {
  const iso = (() => { try { return !!navigator.mediaDevices.getSupportedConstraints().voiceIsolation; } catch { return false; } })();
  return prefs.ns === 'off' ? 'Sem filtro: bom para tocar instrumento ou usar microfone profissional.'
    : prefs.ns === 'strong' ? (iso ? 'Corta ventilador, teclado e barulho de fundo com o isolamento de voz do navegador, mais um filtro de graves.' : 'Filtro de graves mais forte. Seu navegador não tem o isolamento de voz; no Chrome/Edge atualizados ele fica ainda melhor.')
    : 'Tira chiado e ruído leve, sem mudar o jeito da sua voz.';
}
function gateHelp() {
  return prefs.gate === 'auto' ? 'O Nexo aprende o barulho do seu ambiente e só envia o som quando você fala. A marca na barra mostra o limite.'
    : prefs.gate === 'manual' ? 'Arraste: o som só é enviado quando passa da marca (barra verde). Fale baixo e veja se ainda fica verde.'
    : 'O microfone envia tudo o tempo todo, inclusive o barulho do ambiente.';
}

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
  ({ conta: accConta, voz: accVoz, notif: accNotif, aparencia: accLook })[ACC.tab](body);
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
async function accVoz(body) {
  if (!hasMedia()) {
    body.innerHTML = `<h2>Voz e vídeo</h2><p class="muted">Este navegador não permite usar microfone e câmera${location.protocol !== 'https:' ? ' (o site precisa abrir com https://)' : ''}.</p>`;
    return;
  }
  const devs = await listDevices();
  const named = devs.some(d => d.label);
  const opts = (kind, cur) => {
    const list = devs.filter(d => d.kind === kind);
    return `<option value="">Padrão do sistema</option>` + list.map((d, i) =>
      `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `${kind === 'videoinput' ? 'Câmera' : kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}`)}</option>`).join('');
  };
  body.innerHTML = `<h2>Voz e vídeo</h2>
    ${named ? '' : `<div class="acc-note">Para mostrar o nome dos seus aparelhos, o navegador precisa de permissão.
      <button class="btn primary sm" id="av-allow">Permitir acesso</button></div>`}
    <div class="dev-grid">
      <label>Microfone<select id="av-mic">${opts('audioinput', prefs.mic)}</select></label>
      ${canPickOutput() ? `<label>Saída de som<select id="av-out">${opts('audiooutput', prefs.out)}</select></label>` : ''}
      <label>Câmera<select id="av-cam">${opts('videoinput', prefs.cam)}</select></label>
    </div>
    <div class="set-block"><div class="pf-h">Sensibilidade do microfone</div>
      <div class="seg" id="av-gate">${[['auto', 'Automática'], ['manual', 'Manual'], ['off', 'Sempre transmitir']].map(([k, v]) => `<button data-g="${k}" class="${prefs.gate === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="mic-test"><button class="btn" id="av-test">Testar</button>
        <div class="meter gate"><i id="av-bar"></i><b id="av-th" style="left:${(prefs.gateDb + 80) / 80 * 100}%"></b>
          <input type="range" id="av-gdb" min="-80" max="-10" step="1" value="${prefs.gateDb}" ${prefs.gate === 'manual' ? '' : 'disabled'} aria-label="Sensibilidade"></div></div>
      <p class="muted small" id="av-gtxt">${gateHelp()}</p></div>
    <div class="set-block"><div class="pf-h">Testar câmera</div>
      <div class="cam-test"><video id="av-video" autoplay playsinline muted></video><button class="btn" id="av-camtest">Ligar a câmera de teste</button></div></div>
    <div class="set-block"><div class="pf-h">Supressão de ruído</div>
      <div class="seg" id="av-ns">${[['off', 'Desligada'], ['std', 'Padrão'], ['strong', 'Forte']].map(([k, v]) => `<button data-ns="${k}" class="${prefs.ns === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <p class="muted small" id="av-nstxt">${nsHelp()}</p></div>
    <label class="perm"><div><b>Cancelamento de eco</b><p>Evita que o som que sai do seu alto-falante volte pelo microfone. Pode desligar se usar fone de ouvido.</p></div>
      <input type="checkbox" class="tg" id="av-echo" ${prefs.echo ? 'checked' : ''}></label>
    <label class="perm"><div><b>Ganho automático</b><p>Ajusta o volume da sua voz sozinho. Desligue se usar um microfone profissional com ganho próprio.</p></div>
      <input type="checkbox" class="tg" id="av-agc" ${prefs.agc ? 'checked' : ''}></label>`;
  const q = s => body.querySelector(s);
  q('#av-allow')?.addEventListener('click', async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(t => t.stop()); }
    catch { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch { return toast('O navegador não deu permissão.'); } }
    renderAccount();
  });
  q('#av-mic').onchange = e => { setPref('mic', e.target.value); toast('Microfone salvo.'); switchMicDevice(); if (ACC.test?.stream) restartMicTest(); };
  q('#av-out')?.addEventListener('change', e => { setPref('out', e.target.value); applySinkAll(); toast('Saída de som salva.'); });
  q('#av-cam').onchange = e => { setPref('cam', e.target.value); toast('Câmera salva.'); if (ACC.test?.cam) startCamTest(); };
  const reMic = () => { if (call.micTrack) switchMicDevice(); if (ACC.test?.stream) restartMicTest(); };
  q('#av-ns').onclick = e => {
    const b = e.target.closest('[data-ns]'); if (!b) return;
    setPref('ns', b.dataset.ns); setPref('nsSet', 1);
    q('#av-ns').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    q('#av-nstxt').textContent = nsHelp();
    reMic();
  };
  q('#av-echo').onchange = e => { setPref('echo', e.target.checked); setPref('nsSet', 1); reMic(); };
  q('#av-agc').onchange = e => { setPref('agc', e.target.checked); reMic(); };
  q('#av-gate').onclick = e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    setPref('gate', b.dataset.g);
    q('#av-gate').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    q('#av-gdb').disabled = prefs.gate !== 'manual';
    q('#av-gtxt').textContent = gateHelp();
    updateGate();
    if (!ACC.test?.stream) restartMicTest();
  };
  q('#av-gdb').oninput = e => {
    setPref('gateDb', Number(e.target.value));
    q('#av-th').style.left = (prefs.gateDb + 80) / 80 * 100 + '%';
    updateGate();
  };

  const restartMicTest = async () => {
    const keepCam = ACC.test?.cam;
    if (ACC.test) { clearInterval(ACC.test.timer); ACC.test.stream?.getTracks().forEach(x => x.stop()); }
    try {
      // o teste passa pelo mesmo tratamento da chamada: a barra fica verde quando a voz seria enviada
      const track = await acquireMic(d => {
        const bar = document.getElementById('av-bar'), th = document.getElementById('av-th');
        if (!bar) return;
        bar.style.width = Math.max(0, Math.min(100, (d.level + 80) / 80 * 100)) + '%';
        bar.classList.toggle('open', !!d.open);
        if (th && prefs.gate === 'auto') th.style.left = Math.max(0, Math.min(100, (d.th + 80) / 80 * 100)) + '%';
      });
      const stream = new MediaStream([track]);
      ACC.test = { ...(ACC.test || {}), stream, track, timer: null, cam: keepCam };
      q('#av-test').textContent = 'Parar teste';
    } catch { toast('Não consegui usar o microfone.'); }
  };
  q('#av-test').onclick = () => {
    if (ACC.test?.stream) {
      clearInterval(ACC.test.timer); ACC.test.stream.getTracks().forEach(x => x.stop());
      ACC.test.stream = null; ACC.test.track = null; q('#av-test').textContent = 'Testar';
      const bar = document.getElementById('av-bar'); if (bar) bar.style.width = '0';
    } else restartMicTest();
  };
  const startCamTest = async () => {
    ACC.test?.cam?.getTracks().forEach(x => x.stop());
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, ...camDeviceConstraint() } });
      ACC.test = { ...(ACC.test || {}), cam };
      q('#av-video').srcObject = cam;
      q('#av-camtest').textContent = 'Desligar a câmera de teste';
    } catch { toast('Não consegui usar a câmera.'); }
  };
  q('#av-camtest').onclick = () => {
    if (ACC.test?.cam) {
      ACC.test.cam.getTracks().forEach(x => x.stop()); ACC.test.cam = null;
      q('#av-video').srcObject = null; q('#av-camtest').textContent = 'Ligar a câmera de teste';
    } else startCamTest();
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
