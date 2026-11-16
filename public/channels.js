'use strict';
/* =====================================================================
   Nexo - canais e categorias
   Criar canal (com prévia), configurações de canal de texto e de voz,
   permissões por canal (permitir / herdar / negar), categorias,
   menu do botão direito e "pressionar para falar".
   O servidor confere todas as regras de novo: aqui é só a interface.
   ===================================================================== */

// ---------------------------------------------------------------------
// Permissões que podem ser trocadas por canal
// ---------------------------------------------------------------------
const CH_PERM_INFO = {
  view: ['Ver canal', 'Ver o canal na lista e entrar nele. Negado: o canal fica escondido.'],
  manageChannels: ['Gerenciar canal', 'Editar o nome, as configurações e excluir o canal.'],
  sendMessages: ['Enviar mensagens', 'Escrever no canal. Negado para @everyone = canal somente leitura.'],
  readHistory: ['Ver mensagens anteriores', 'Ler o que foi enviado antes de abrir o canal.'],
  attachFiles: ['Enviar imagens e arquivos', 'Anexar fotos, vídeos e outros arquivos.'],
  embedLinks: ['Enviar links', 'Mandar mensagens com endereços de sites.'],
  addReactions: ['Adicionar reações', 'Reagir às mensagens com emoji.'],
  manageMessages: ['Gerenciar mensagens', 'Excluir mensagens dos outros e ignorar o modo lento.'],
  connect: ['Entrar na sala', 'Conectar nesta sala de voz.'],
  speak: ['Falar', 'Usar o microfone na sala.'],
  video: ['Câmera', 'Ligar a câmera na sala.'],
  stream: ['Transmitir a tela', 'Compartilhar a tela na sala.'],
  useVAD: ['Detecção de voz', 'Falar sem segurar uma tecla. Negado: só com "pressionar para falar".'],
  muteMembers: ['Silenciar membros', 'Desligar o microfone de outras pessoas na sala.'],
  deafenMembers: ['Desativar áudio de membros', 'Fazer outra pessoa parar de ouvir a sala.'],
  moveMembers: ['Mover membros', 'Arrastar pessoas desta sala para outra.'],
  disconnectMembers: ['Desconectar membros', 'Tirar pessoas da sala.'],
};
const TEXT_PERMS = ['view', 'sendMessages', 'readHistory', 'attachFiles', 'embedLinks', 'addReactions', 'manageMessages', 'manageChannels'];
const VOICE_PERMS = ['view', 'connect', 'speak', 'video', 'stream', 'useVAD', 'muteMembers', 'deafenMembers', 'moveMembers', 'disconnectMembers', 'manageChannels'];
const ALL_CH_PERMS = [...new Set([...TEXT_PERMS, ...VOICE_PERMS])];
const TEXT_DEF = { maxLen: 2000, slow: 0, edit: true, del: true, replies: true, maxFileMB: 25, newHistory: true, retention: 0 };
const VOICE_DEF = { limit: 0, locked: false, temp: false, bitrate: 64, ns: '', screenAudio: true };
const SLOW_OPTS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
const clone = o => JSON.parse(JSON.stringify(o ?? {}));

// ---------------------------------------------------------------------
// Criar canal (com prévia)
// ---------------------------------------------------------------------
function channelModal(g, type = 'text', cat = '') {
  const roles = g.roles || [];
  modal(`<h3>Criar canal</h3>
    <form id="m-ch" class="chform">
      <div class="seg wide" id="nc-type">
        <button type="button" data-t="text" class="${type === 'text' ? 'on' : ''}">${I.hash}Texto</button>
        <button type="button" data-t="voice" class="${type === 'voice' ? 'on' : ''}">${I.speaker}Voz e vídeo</button>
      </div>
      <label>Nome<input id="nc-name" maxlength="32" autocomplete="off" required></label>
      <label>Descrição<input id="nc-topic" maxlength="300" placeholder="Opcional: do que se trata este canal?"></label>
      <label>Categoria<select id="nc-cat"><option value="">Sem categoria</option>${(g.categories || []).map(k => `<option value="${k.id}" ${k.id === cat ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
      <label class="perm"><div><b>Canal privado</b><p>Só você, administradores e os cargos escolhidos abaixo vão ver este canal.</p></div>
        <input type="checkbox" class="tg" id="nc-priv"></label>
      <div id="nc-roles" class="hidden">${roles.length ? `<div class="pf-h">Quem mais pode ver</div><div class="role-pick">${roles.map(r => `<label class="chip pick"><input type="checkbox" value="${r.id}"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</label>`).join('')}</div>` : '<p class="muted small">Ainda não há cargos. Depois você pode liberar pessoas em Permissões.</p>'}</div>
      <div class="pf-h">Prévia</div>
      <div class="nc-prev" id="nc-prev"></div>
      <div class="acts"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Criar canal</button></div>
    </form>`, card => {
    let t = type;
    const q = sel => card.querySelector(sel);
    const prev = () => {
      let n = q('#nc-name').value.trim() || (t === 'voice' ? 'nova-sala' : 'novo-canal');
      if (t === 'text') n = n.toLowerCase().replace(/\s+/g, '-');
      const k = (g.categories || []).find(x => x.id === q('#nc-cat').value);
      q('#nc-prev').innerHTML = `<div class="sec cat">${I.chev}<span>${esc(k?.name || (t === 'voice' ? 'Salas de voz' : 'Canais de texto'))}</span></div>
        <div class="ch active">${t === 'voice' ? I.speaker : I.hash}<span class="label">${esc(n)}</span>${q('#nc-priv').checked ? `<span class="ch-ic">${I.lockI}</span>` : ''}</div>
        ${q('#nc-topic').value.trim() ? `<p class="muted small">${esc(q('#nc-topic').value.trim())}</p>` : ''}`;
      q('#nc-name').placeholder = t === 'voice' ? 'Ex.: Jogando' : 'Ex.: memes';
    };
    q('#nc-type').onclick = e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      t = b.dataset.t;
      q('#nc-type').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      prev();
    };
    q('#nc-priv').onchange = () => { q('#nc-roles').classList.toggle('hidden', !q('#nc-priv').checked); prev(); };
    ['#nc-name', '#nc-topic', '#nc-cat'].forEach(s => q(s).addEventListener('input', prev));
    prev();
    q('#m-ch').onsubmit = async e => {
      e.preventDefault();
      const priv = q('#nc-priv').checked;
      const r = await emit('channel:create', {
        groupId: g.id, type: t, name: q('#nc-name').value, topic: q('#nc-topic').value, cat: q('#nc-cat').value || '',
        priv, roles: priv ? [...card.querySelectorAll('#nc-roles input:checked')].map(x => x.value) : [],
      });
      if (r.error) return toast(r.error);
      closeModal();
      toast(`Canal ${t === 'voice' ? r.channel.name : '#' + r.channel.name} criado.`);
      if (t === 'text') setTimeout(() => openTextChannel(r.channel.id), 60);
    };
  });
}

// Mover canal de categoria (menu ou arrastar) e oferecer sincronizar as permissões
async function moveChannelTo(g, cid, cat, before) {
  const old = findChannel(cid)?.c;
  const r = await emit('channel:move', { groupId: g.id, channelId: cid, cat, before });
  if (r.error) return toast(r.error);
  if (!old || (old.cat || null) === (cat || null) || !cat) return;
  const k = (g.categories || []).find(x => x.id === cat);
  const canPerm = can(g, 'manageRoles') || g.ownerId === S.user.id;
  if (!k || !canPerm) return;
  const own = Object.keys(old.ow || {}).length;
  confirmModal(`Sincronizar com "${k.name}"?`,
    own ? `O canal tem permissões próprias. Sincronizar apaga essas permissões e ele passa a seguir as da categoria "${k.name}".`
      : `O canal vai seguir as permissões da categoria "${k.name}".`,
    'Sincronizar', async () => {
      const s = await emit('channel:sync', { channelId: cid });
      if (s.error) toast(s.error); else toast('Permissões sincronizadas com a categoria.');
    }, 'Manter como está');
}

// ---------------------------------------------------------------------
// Menu da categoria (botão direito)
// ---------------------------------------------------------------------
function openCategoryMenu(g, catId, x, y) {
  const k = (g.categories || []).find(c => c.id === catId);
  if (!k) return;
  const man = can(g, 'manageChannels');
  const col = new Set(JSON.parse(store.get('nexo_col_' + g.id) || '[]'));
  const i = g.categories.indexOf(k);
  ctx.innerHTML = `<div class="vol-h ic">${I.folder} ${esc(k.name)}</div>
    <button class="item" data-a="col">${col.has(k.id) ? I.down : I.up}${col.has(k.id) ? 'Expandir categoria' : 'Recolher categoria'}</button>
    ${man ? `<button class="item" data-a="edit">${I.gear}Editar categoria</button>
      ${can(g, 'manageRoles') || g.ownerId === S.user.id ? `<button class="item" data-a="perms">${I.shield}Permissões da categoria</button>
      <button class="item" data-a="sync">${I.dup}Sincronizar os canais com a categoria</button>` : ''}
      <button class="item" data-a="new">${I.plus}Criar canal aqui</button>
      ${i > 0 ? `<button class="item" data-a="upc">${I.up}Mover para cima</button>` : ''}
      ${i < g.categories.length - 1 ? `<button class="item" data-a="downc">${I.down}Mover para baixo</button>` : ''}
      <div class="sep"></div><button class="item danger" data-a="del">${I.trash}Excluir categoria</button>` : ''}
    <button class="item" data-a="id">${I.idI}Copiar ID da categoria</button>`;
  ctx.onclick = async e => {
    const it = e.target.closest('[data-a]'); if (!it) return;
    closeCtx();
    const a = it.dataset.a;
    if (a === 'col') { col.has(k.id) ? col.delete(k.id) : col.add(k.id); store.set('nexo_col_' + g.id, JSON.stringify([...col])); renderChannels(); }
    if (a === 'edit') openCategorySettings(g.id, k.id);
    if (a === 'perms') openCategorySettings(g.id, k.id, 'perms');
    if (a === 'new') channelModal(g, 'text', k.id);
    if (a === 'upc' || a === 'downc') { const r = await emit('category:move', { groupId: g.id, id: k.id, dir: a === 'upc' ? 'up' : 'down' }); if (r.error) toast(r.error); }
    if (a === 'id') navigator.clipboard?.writeText(k.id).then(() => toast('ID copiado.')).catch(() => toast(k.id, 8000));
    if (a === 'sync') confirmModal(`Sincronizar os canais de "${k.name}"?`, 'Todos os canais desta categoria perdem as permissões próprias e passam a seguir as da categoria.', 'Sincronizar', async () => {
      const r = await emit('category:sync', { groupId: g.id, id: k.id });
      if (r.error) toast(r.error); else toast('Canais sincronizados.');
    });
    if (a === 'del') confirmModal(`Excluir a categoria "${k.name}"?`, 'Os canais dela continuam existindo, só ficam sem categoria.', 'Excluir', async () => {
      const r = await emit('category:delete', { groupId: g.id, id: k.id });
      if (r.error) toast(r.error);
    });
  };
  placeCtx(x, y);
}

// ---------------------------------------------------------------------
// Configurações do canal / da categoria
// ---------------------------------------------------------------------
const CH = { mode: null, gid: null, id: null, tab: null, draft: null, orig: '', target: 'everyone' };
const chDirty = () => CH.mode && JSON.stringify(CH.draft) !== CH.orig;
// fechar com alterações não salvas: avisa e não fecha
window.beforeSettingsClose = () => {
  if (!CH.mode) return true;
  if (chDirty()) { nagUnsaved(); return false; }
  CH.mode = null;
  return true;
};
function nagUnsaved() {
  const bar = document.getElementById('ch-save');
  bar?.classList.remove('shake'); void bar?.offsetWidth; bar?.classList.add('shake');
  toast('Você tem alterações não salvas: salve ou desfaça antes de sair.');
}

function curEntity() {
  const g = group(CH.gid);
  if (!g) return {};
  if (CH.mode === 'cat') return { g, k: g.categories.find(x => x.id === CH.id) };
  return { g, c: g.channels.find(x => x.id === CH.id) };
}

function openChannelSettings(cid, tab) {
  const f = findChannel(cid);
  if (!f) return;
  if (!canCh(f.c, 'manageChannels')) return toast('Você não tem permissão para editar este canal.');
  if (CH.mode && chDirty() && CH.id !== cid) return nagUnsaved();
  Object.assign(CH, { mode: 'ch', gid: f.g.id, id: cid, tab: tab || 'geral', target: 'everyone' });
  loadDraft();
  $('#settings').classList.remove('hidden');
  renderChSettings();
}
function openCategorySettings(gid, catId, tab) {
  const g = group(gid);
  if (!g || !can(g, 'manageChannels')) return toast('Você não tem permissão para editar categorias.');
  Object.assign(CH, { mode: 'cat', gid, id: catId, tab: tab || 'geral', target: 'everyone' });
  loadDraft();
  $('#settings').classList.remove('hidden');
  renderChSettings();
}
function loadDraft() {
  const { c, k } = curEntity();
  if (CH.mode === 'cat') CH.draft = { name: k?.name || '', ow: clone(k?.ow) };
  else CH.draft = { name: c.name, topic: c.topic || '', cat: c.cat || '', cfg: { ...(c.type === 'voice' ? VOICE_DEF : TEXT_DEF), ...clone(c.cfg) }, ow: clone(c.ow) };
  CH.orig = JSON.stringify(CH.draft);
}
// Chegou atualização do grupo: se não tem nada por salvar, recarrega os valores
window.onGroupUpdate = (prev => g => {
  prev?.(g);
  if (!CH.mode || g.id !== CH.gid || $('#settings').classList.contains('hidden')) return;
  const { c, k } = curEntity();
  if (!(c || k)) { CH.mode = null; $('#settings').classList.add('hidden'); return toast('Este canal não existe mais ou você perdeu o acesso.'); }
  if (CH.mode === 'ch' && !canCh(c, 'manageChannels')) { CH.mode = null; $('#settings').classList.add('hidden'); return toast('Você não pode mais editar este canal.'); }
  if (!chDirty()) { loadDraft(); renderChSettings(); }
})(window.onGroupUpdate);

function renderChSettings() {
  const { g, c, k } = curEntity();
  if (!g || !(c || k)) return;
  const isCat = CH.mode === 'cat', voice = c?.type === 'voice';
  const canPerm = can(g, 'manageRoles') || g.ownerId === S.user.id;
  const tabs = isCat
    ? [['geral', 'Visão geral'], ['perms', 'Permissões']]
    : voice ? [['geral', 'Visão geral'], ['audio', 'Áudio e vídeo'], ['part', 'Participantes'], ['perms', 'Permissões']]
      : [['geral', 'Visão geral'], ['msgs', 'Mensagens'], ['hist', 'Histórico'], ['perms', 'Permissões']];
  const title = isCat ? k.name : c.name;
  $('#set-nav').innerHTML = `<div class="set-sec">${isCat ? 'Categoria' : voice ? 'Sala de voz' : 'Canal de texto'}</div>
    <div class="set-title">${isCat ? I.folder : voice ? I.speaker : I.hash}<span>${esc(title)}</span></div>
    ${tabs.map(([id, l]) => `<button class="set-tab ${CH.tab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}
    <div class="set-sep"></div>
    <button class="set-tab danger" data-tab="del">${isCat ? 'Excluir categoria' : voice ? 'Excluir sala' : 'Excluir canal'}</button>`;
  $('#set-nav').onclick = e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'del') {
      if (chDirty()) return nagUnsaved();
      if (isCat) return confirmModal(`Excluir a categoria "${k.name}"?`, 'Os canais dela continuam existindo, só ficam sem categoria.', 'Excluir', async () => {
        const r = await emit('category:delete', { groupId: g.id, id: k.id });
        if (r.error) return toast(r.error);
        CH.mode = null; closeSettings();
      });
      return confirmModal(`Excluir "${c.name}"?`, voice ? 'Quem estiver na sala será desconectado.' : 'Todas as mensagens deste canal serão apagadas. Isso não pode ser desfeito.', 'Excluir', async () => {
        if (call.channelId === c.id) leaveCall();
        const r = await emit('channel:delete', { channelId: c.id });
        if (r.error) return toast(r.error);
        CH.mode = null; closeSettings(); toast('Canal excluído.');
      });
    }
    CH.tab = b.dataset.tab; renderChSettings();
  };
  const body = $('#set-body');
  const sc = body.scrollTop;
  body.innerHTML = `<div class="ch-set">${tabBody(g, c, k)}</div>
    <div class="save-bar ${chDirty() ? 'show' : ''}" id="ch-save"><span>Cuidado: você tem alterações não salvas.</span>
      <button class="btn" id="ch-undo">Desfazer</button><button class="btn primary" id="ch-ok">Salvar alterações</button></div>`;
  body.scrollTop = sc;
  wireTab(g, c, k, body, canPerm);
  body.querySelector('#ch-undo').onclick = () => { loadDraft(); renderChSettings(); };
  body.querySelector('#ch-ok').onclick = () => saveChSettings(g, c, k);
}
// a barra de salvar aparece/some sem redesenhar o que está sendo digitado
function updSaveBar() { document.getElementById('ch-save')?.classList.toggle('show', chDirty()); }

// ---- Valores de @everyone usados pelos interruptores simples ----
// Interruptor ligado = @everyone pode. Se o valor for igual ao herdado, não cria regra.
function inheritedEveryone(g, c, perm) {
  if (CH.mode === 'ch' && c?.cat) {
    const k = g.categories.find(x => x.id === c.cat);
    const o = k?.ow?.everyone;
    if (o?.a?.[perm]) return true;
    if (o?.d?.[perm]) return false;
  }
  return !!(g.everyone || {})[perm];
}
function evOn(g, c, perm) {
  const o = CH.draft.ow.everyone;
  if (o?.d?.[perm]) return false;
  if (o?.a?.[perm]) return true;
  return inheritedEveryone(g, c, perm);
}
function setOw(key, perm, state) {   // state: 'a' | 'd' | null (herdar)
  const ow = CH.draft.ow;
  const o = ow[key] || { a: {}, d: {} };
  delete o.a[perm]; delete o.d[perm];
  if (state) o[state][perm] = 1;
  if (!Object.keys(o.a).length && !Object.keys(o.d).length && key !== 'everyone' && CH.keepTargets?.has(key)) ow[key] = o;
  else if (!Object.keys(o.a).length && !Object.keys(o.d).length) delete ow[key];
  else ow[key] = o;
}
function setEv(g, c, perm, on) { setOw('everyone', perm, on === inheritedEveryone(g, c, perm) ? null : on ? 'a' : 'd'); }

const tgRow = (id, title, desc, on, dis, disWhy) => `<label class="perm ${dis ? 'dis' : ''}" ${dis && disWhy ? `title="${esc(disWhy)}"` : ''}><div><b>${title}</b><p>${desc}</p></div>
  <input type="checkbox" class="tg" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}></label>`;
const selRow = (id, title, desc, opts, val) => `<div class="perm"><div><b>${title}</b><p>${desc}</p></div>
  <select class="sel" id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
const permNote = '<p class="muted small note">Para mudar este item você precisa da permissão "Gerenciar cargos".</p>';

function tabBody(g, c, k) {
  const d = CH.draft, isCat = CH.mode === 'cat', voice = c?.type === 'voice';
  const canPerm = can(g, 'manageRoles') || g.ownerId === S.user.id;
  const np = !canPerm;
  if (CH.tab === 'perms') return permsBody(g, c, k);
  if (isCat) return `<h2>Visão geral</h2>
    <label class="fld">Nome da categoria<input id="cs-name" maxlength="32" value="${esc(d.name)}"></label>
    <p class="muted small">Canais dentro da categoria podem herdar as permissões dela. Ajuste em <b>Permissões</b>.</p>
    <div class="pf-h">Canais nesta categoria</div>
    <div class="cat-list">${g.channels.filter(x => x.cat === k.id).map(x => `<div class="ch">${x.type === 'voice' ? I.speaker : I.hash}<span class="label">${esc(x.name)}</span><span class="muted small">${x.synced ? 'sincronizado' : 'permissões próprias'}</span></div>`).join('') || '<p class="muted small">Nenhum canal ainda.</p>'}</div>`;
  if (CH.tab === 'geral') {
    const cats = g.categories || [];
    return `<h2>Visão geral</h2>
      <label class="fld">${voice ? 'Nome da sala' : 'Nome do canal'}<input id="cs-name" maxlength="32" value="${esc(d.name)}"></label>
      <label class="fld">${voice ? 'Descrição' : 'Descrição / tópico'}<textarea id="cs-topic" maxlength="300" rows="3" placeholder="Aparece no topo do canal e ao passar o mouse.">${esc(d.topic)}</textarea></label>
      <label class="fld">Categoria<select class="sel" id="cs-cat"><option value="">Sem categoria</option>${cats.map(x => `<option value="${x.id}" ${x.id === d.cat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${tgRow('cs-priv', voice ? 'Sala privada' : 'Canal privado', 'Só quem for liberado em Permissões consegue ver. Administradores sempre veem.', !evOn(g, c, 'view'), np)}
      ${voice ? `
        ${selRow('cs-limit', 'Limite de participantes', 'Quantas pessoas podem estar na sala ao mesmo tempo. Quem pode mover membros passa do limite.', [[0, 'Sem limite (máx. 12)'], ...[2, 3, 4, 5, 6, 8, 10, 12].map(n => [n, n + ' pessoas'])], d.cfg.limit)}
        ${tgRow('cs-locked', 'Fechar para novas pessoas', 'Quem já está continua; ninguém novo entra (só quem pode mover membros).', d.cfg.locked)}
        ${tgRow('cs-temp', 'Sala temporária', 'A sala é apagada sozinha quando a última pessoa sair.', d.cfg.temp)}`
      : `
        ${tgRow('cs-ro', 'Somente leitura', 'Ninguém escreve, só quem for liberado em Permissões (e administradores).', !evOn(g, c, 'sendMessages'), np)}
        ${selRow('cs-maxlen', 'Limite de caracteres', 'Tamanho máximo de cada mensagem.', [[2000, '2000 (padrão)'], [1000, '1000'], [500, '500'], [280, '280'], [100, '100']], d.cfg.maxLen)}
        ${tgRow('cs-files', 'Imagens e arquivos', 'Permitir anexar fotos, vídeos e outros arquivos.', evOn(g, c, 'attachFiles'), np)}
        ${tgRow('cs-links', 'Links', 'Permitir mensagens com endereços de sites.', evOn(g, c, 'embedLinks'), np)}`}
      ${np ? permNote : ''}`;
  }
  if (CH.tab === 'msgs') return `<h2>Mensagens</h2>
    ${tgRow('cs-send', 'Enviar mensagens', 'Desligado = canal somente leitura para @everyone.', evOn(g, c, 'sendMessages'), np)}
    ${tgRow('cs-edit', 'Editar mensagens', 'As pessoas podem corrigir o que mandaram.', d.cfg.edit)}
    ${tgRow('cs-del', 'Excluir as próprias mensagens', 'Quem tem "Gerenciar mensagens" sempre pode excluir.', d.cfg.del)}
    ${tgRow('cs-replies', 'Respostas', 'Responder a uma mensagem específica.', d.cfg.replies)}
    ${tgRow('cs-react', 'Reações', 'Reagir às mensagens com emoji.', evOn(g, c, 'addReactions'), np)}
    ${selRow('cs-slow', 'Modo lento', 'Tempo mínimo entre duas mensagens da mesma pessoa. Moderadores não são afetados.', SLOW_OPTS.map(n => [n, n ? fmtSecs(n) : 'Desligado']), d.cfg.slow)}
    ${selRow('cs-maxmb', 'Tamanho máximo de anexo', 'Cada mensagem leva um arquivo; este é o tamanho máximo dele.', [[25, '25 MB (padrão)'], [10, '10 MB'], [5, '5 MB'], [1, '1 MB']], d.cfg.maxFileMB)}
    ${np ? permNote : ''}`;
  if (CH.tab === 'hist') return `<h2>Histórico</h2>
    ${tgRow('cs-hist', 'Ver mensagens anteriores', 'Desligado: as pessoas só veem o que chegar enquanto estiverem com o canal aberto.', evOn(g, c, 'readHistory'), np)}
    ${tgRow('cs-newhist', 'Novos membros veem o histórico', 'Desligado: quem entrar no grupo só vê as mensagens enviadas depois da entrada.', d.cfg.newHistory)}
    ${selRow('cs-ret', 'Apagar mensagens antigas', 'As mensagens mais antigas que isso são apagadas sozinhas (verificado de hora em hora).', [[0, 'Nunca'], [1, 'Depois de 1 dia'], [7, 'Depois de 7 dias'], [30, 'Depois de 30 dias'], [90, 'Depois de 90 dias'], [365, 'Depois de 1 ano']], d.cfg.retention)}
    ${np ? permNote : ''}`;
  if (CH.tab === 'audio') return `<h2>Áudio e vídeo</h2>
    ${selRow('cs-br', 'Qualidade do áudio', 'Mais qualidade usa mais internet de quem está na sala.', [[32, '32 kbps (economia)'], [64, '64 kbps (padrão)'], [96, '96 kbps (alta)'], [128, '128 kbps (máxima)']], d.cfg.bitrate)}
    ${selRow('cs-nsrec', 'Supressão de ruído recomendada', 'Quem estiver com "usar a recomendação da sala" ligado passa a usar este nível aqui. Cada um pode desligar isso nas próprias configurações.', [['', 'Nenhuma (cada um usa a sua)'], ['off', 'Desativado'], ['low', 'Baixo'], ['med', 'Médio'], ['high', 'Alto'], ['auto', 'Automático']], d.cfg.ns || '')}
    ${tgRow('cs-sa', 'Som na transmissão de tela', 'Desligado: quem transmitir a tela aqui envia só a imagem.', d.cfg.screenAudio !== false)}
    ${tgRow('cs-cam', 'Câmera', 'Permitir ligar a câmera nesta sala.', evOn(g, c, 'video'), np)}
    ${tgRow('cs-stream', 'Transmitir a tela', 'Permitir compartilhar a tela nesta sala.', evOn(g, c, 'stream'), np)}
    ${tgRow('cs-vad', 'Detecção de voz', 'Desligado: todo mundo precisa usar "pressionar para falar".', evOn(g, c, 'useVAD'), np)}
    ${tgRow('cs-speak2', 'Usar o microfone', 'Desligado: as pessoas só ouvem.', evOn(g, c, 'speak'), np)}
    ${np ? permNote : ''}`;
  if (CH.tab === 'part') return `<h2>Participantes</h2>
    ${tgRow('cs-connect', 'Entrar na sala', 'Desligado: ninguém entra, só quem for liberado em Permissões.', evOn(g, c, 'connect'), np)}
    ${tgRow('cs-speak', 'Usar o microfone', 'Desligado: as pessoas só ouvem (ótimo para palco ou aula).', evOn(g, c, 'speak'), np)}
    ${tgRow('cs-cam2', 'Usar a câmera', 'Ligar a câmera na sala.', evOn(g, c, 'video'), np)}
    ${tgRow('cs-stream2', 'Compartilhar a tela', 'Transmitir a tela na sala.', evOn(g, c, 'stream'), np)}
    ${tgRow('cs-move', 'Membros podem mover outros', 'Qualquer pessoa pode arrastar outra desta sala para outra.', evOn(g, c, 'moveMembers'), np)}
    ${tgRow('cs-mute', 'Membros podem silenciar outros', 'Qualquer pessoa pode desligar o microfone de outra para todos.', evOn(g, c, 'muteMembers'), np)}
    ${np ? permNote : ''}`;
  return '';
}

function wireTab(g, c, k, body, canPerm) {
  const d = CH.draft, q = s => body.querySelector(s);
  const on = (sel, ev, fn) => { const el = q(sel); if (el) el.addEventListener(ev, () => { fn(el); updSaveBar(); }); };
  on('#cs-name', 'input', el => { d.name = el.value; });
  on('#cs-topic', 'input', el => { d.topic = el.value; });
  on('#cs-cat', 'change', el => { d.cat = el.value; });
  on('#cs-priv', 'change', el => {
    setEv(g, c, 'view', !el.checked);
    // ao deixar privado, quem está editando continua vendo
    if (el.checked && !can(g, 'admin')) setOw('m:' + S.user.id, 'view', 'a');
  });
  const ev = (sel, perm, inv) => on(sel, 'change', el => setEv(g, c, perm, inv ? !el.checked : el.checked));
  ev('#cs-ro', 'sendMessages', true); ev('#cs-send', 'sendMessages');
  ev('#cs-files', 'attachFiles'); ev('#cs-links', 'embedLinks'); ev('#cs-react', 'addReactions');
  ev('#cs-hist', 'readHistory');
  ev('#cs-cam', 'video'); ev('#cs-cam2', 'video'); ev('#cs-stream', 'stream'); ev('#cs-stream2', 'stream'); ev('#cs-vad', 'useVAD');
  ev('#cs-connect', 'connect'); ev('#cs-speak', 'speak'); ev('#cs-move', 'moveMembers'); ev('#cs-mute', 'muteMembers');
  const cfgB = (sel, key) => on(sel, 'change', el => { d.cfg[key] = el.checked; });
  const cfgN = (sel, key) => on(sel, 'change', el => { d.cfg[key] = Number(el.value); });
  cfgB('#cs-edit', 'edit'); cfgB('#cs-del', 'del'); cfgB('#cs-replies', 'replies'); cfgB('#cs-newhist', 'newHistory');
  cfgB('#cs-locked', 'locked'); cfgB('#cs-temp', 'temp'); cfgB('#cs-sa', 'screenAudio');
  on('#cs-nsrec', 'change', el => { d.cfg.ns = el.value; });
  ev('#cs-speak2', 'speak');
  cfgN('#cs-maxlen', 'maxLen'); cfgN('#cs-slow', 'slow'); cfgN('#cs-maxmb', 'maxFileMB'); cfgN('#cs-ret', 'retention');
  cfgN('#cs-limit', 'limit'); cfgN('#cs-br', 'bitrate');
  // interruptores que mexem no @everyone: redesenha para refletir pares (ex.: somente leitura ↔ enviar)
  body.querySelectorAll('.tg').forEach(t => t.addEventListener('change', () => { if (['cs-ro', 'cs-send', 'cs-cam', 'cs-cam2', 'cs-stream', 'cs-stream2'].includes(t.id)) renderChSettings(); }));
  if (CH.tab === 'perms') wirePerms(g, c, k, body);
}

// ---------------------------------------------------------------------
// Permissões: permitir / herdar / negar para @everyone, cargos e pessoas
// ---------------------------------------------------------------------
function targetName(g, key) {
  if (key === 'everyone') return '@everyone';
  if (key.startsWith('r:')) return g.roles.find(r => 'r:' + r.id === key)?.name || 'cargo removido';
  const u = userById(key.slice(2));
  return u ? u.name : 'pessoa';
}
function targetIcon(g, key) {
  if (key === 'everyone') return `<span class="tdot" style="background:#99aab5"></span>`;
  if (key.startsWith('r:')) return `<span class="tdot" style="background:${esc(g.roles.find(r => 'r:' + r.id === key)?.color || '#99aab5')}"></span>`;
  const u = userById(key.slice(2));
  return u ? avatar(u, 'xs nodot') : '';
}
function permsBody(g, c, k) {
  const isCat = CH.mode === 'cat', voice = c?.type === 'voice';
  const canPerm = can(g, 'manageRoles') || g.ownerId === S.user.id;
  const list = isCat ? ALL_CH_PERMS : voice ? VOICE_PERMS : TEXT_PERMS;
  const keys = ['everyone', ...Object.keys(CH.draft.ow).filter(x => x !== 'everyone').sort((a, b) => a[0].localeCompare(b[0]))];
  if (!keys.includes(CH.target)) CH.target = 'everyone';
  const o = CH.draft.ow[CH.target] || { a: {}, d: {} };
  const cat = !isCat && c.cat && g.categories.find(x => x.id === c.cat);
  const catOw = cat?.ow?.[CH.target];
  const synced = !isCat && !Object.keys(CH.draft.ow).length;
  return `<h2>Permissões</h2>
    ${cat ? `<div class="sync-box ${synced ? 'ok' : ''}">${synced ? `${I.dup}<span>Sincronizado com a categoria <b>${esc(cat.name)}</b>: tudo em "herdar".</span>`
      : `${I.shield}<span>Este canal tem permissões próprias. O que estiver em "herdar" vem da categoria <b>${esc(cat.name)}</b>.</span><button class="btn sm" id="ps-sync" ${canPerm ? '' : 'disabled'}>Sincronizar agora</button>`}</div>` : ''}
    <p class="muted small">Administradores e o dono do grupo sempre têm tudo, aqui não muda nada para eles.
      Ordem: permissões do cargo → @everyone daqui → cargos daqui → a pessoa (a mais específica vence).</p>
    <div class="pe">
      <div class="pe-left">
        <div class="pe-h"><span>Cargos e pessoas</span>${canPerm ? `<button class="icon-btn" id="pe-add" title="Adicionar cargo ou pessoa">${I.plus}</button>` : ''}</div>
        ${keys.map(key => `<button class="pe-t ${key === CH.target ? 'on' : ''}" data-tk="${esc(key)}">${targetIcon(g, key)}<span>${esc(targetName(g, key))}</span>${key !== 'everyone' && canPerm ? `<span class="icon-btn x" data-rm="${esc(key)}" title="Remover">${I.x}</span>` : ''}</button>`).join('')}
      </div>
      <div class="pe-right">
        <div class="pe-h"><span>${esc(targetName(g, CH.target))}</span>${canPerm ? `<button class="btn sm" id="pe-clear">Tudo em herdar</button>` : ''}</div>
        ${list.map(p => {
          const st = o.a?.[p] ? 'a' : o.d?.[p] ? 'd' : 'i';
          const inh = catOw?.a?.[p] ? 'permitido na categoria' : catOw?.d?.[p] ? 'negado na categoria' : '';
          return `<div class="pe-row"><div><b>${CH_PERM_INFO[p][0]}</b><p>${CH_PERM_INFO[p][1]}${st === 'i' && inh ? ` <span class="inh">(herdando: ${inh})</span>` : ''}</p></div>
            <div class="tri ${canPerm ? '' : 'dis'}" data-p="${p}" role="radiogroup" aria-label="${CH_PERM_INFO[p][0]}">
              <button class="no ${st === 'd' ? 'on' : ''}" data-s="d" title="Negar" aria-label="Negar">${I.x}</button>
              <button class="mid ${st === 'i' ? 'on' : ''}" data-s="i" title="Herdar" aria-label="Herdar">/</button>
              <button class="yes ${st === 'a' ? 'on' : ''}" data-s="a" title="Permitir" aria-label="Permitir">${I.check || '✓'}</button>
            </div></div>`;
        }).join('')}
        ${canPerm ? '' : permNote}
      </div>
    </div>`;
}
function wirePerms(g, c, k, body) {
  const canPerm = can(g, 'manageRoles') || g.ownerId === S.user.id;
  body.querySelectorAll('[data-tk]').forEach(b => b.onclick = e => {
    if (e.target.closest('[data-rm]')) return;
    CH.target = b.dataset.tk; renderChSettings();
  });
  if (!canPerm) return;
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    delete CH.draft.ow[b.dataset.rm];
    CH.keepTargets?.delete(b.dataset.rm);
    if (CH.target === b.dataset.rm) CH.target = 'everyone';
    renderChSettings();
  });
  body.querySelectorAll('.tri').forEach(t => t.onclick = e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    CH.keepTargets ||= new Set(); CH.keepTargets.add(CH.target);
    setOw(CH.target, t.dataset.p, b.dataset.s === 'i' ? null : b.dataset.s);
    renderChSettings();
  });
  body.querySelector('#pe-clear')?.addEventListener('click', () => {
    if (CH.target === 'everyone') delete CH.draft.ow.everyone;
    else CH.draft.ow[CH.target] = { a: {}, d: {} };
    renderChSettings();
  });
  body.querySelector('#ps-sync')?.addEventListener('click', () => {
    confirmModal('Sincronizar com a categoria?', 'Todas as permissões próprias deste canal serão apagadas. Ele passa a seguir a categoria.', 'Sincronizar', () => {
      CH.draft.ow = {}; CH.keepTargets = new Set(); renderChSettings(); updSaveBar();
    });
  });
  body.querySelector('#pe-add')?.addEventListener('click', e => {
    const have = new Set(Object.keys(CH.draft.ow));
    const roles = g.roles.filter(r => !have.has('r:' + r.id));
    const people = g.members.filter(m => !have.has('m:' + m.id));
    ctx.innerHTML = `<div class="vol-h">Cargos</div>${roles.map(r => `<button class="item" data-k="r:${r.id}"><span class="tdot" style="background:${esc(r.color || '#99aab5')}"></span>${esc(r.name)}</button>`).join('') || '<div class="muted small" style="padding:6px 10px">Nenhum cargo para adicionar.</div>'}
      <div class="vol-h">Pessoas</div><input class="ctx-search" id="pe-q" placeholder="Procurar membro">
      <div id="pe-ppl">${people.map(m => `<button class="item" data-k="m:${m.id}" data-n="${esc((m.name + ' ' + m.username).toLowerCase())}">${avatar(m, 'xs nodot')}${esc(m.name)}</button>`).join('')}</div>`;
    ctx.onclick = ev => {
      const it = ev.target.closest('[data-k]'); if (!it) return;
      closeCtx();
      CH.keepTargets ||= new Set(); CH.keepTargets.add(it.dataset.k);
      CH.draft.ow[it.dataset.k] = { a: {}, d: {} };
      CH.target = it.dataset.k;
      renderChSettings();
    };
    ctx.oninput = () => {
      const v = ctx.querySelector('#pe-q').value.trim().toLowerCase();
      ctx.querySelectorAll('#pe-ppl [data-n]').forEach(b => b.classList.toggle('hidden', !!v && !b.dataset.n.includes(v)));
    };
    const r = e.currentTarget.getBoundingClientRect();
    placeCtx(r.left, r.bottom + 4);
  });
}

// alvos sem nenhuma regra não vão para o servidor
const cleanDraftOw = ow => Object.fromEntries(Object.entries(ow).filter(([, v]) => Object.keys(v.a || {}).length || Object.keys(v.d || {}).length));

async function saveChSettings(g, c, k) {
  const d = CH.draft, orig = JSON.parse(CH.orig);
  const owChanged = JSON.stringify(cleanDraftOw(d.ow)) !== JSON.stringify(cleanDraftOw(orig.ow));
  let r;
  if (CH.mode === 'cat') {
    r = await emit('category:edit', { groupId: g.id, id: k.id, name: d.name, ...(owChanged ? { ow: cleanDraftOw(d.ow) } : {}) });
  } else {
    const payload = { channelId: c.id };
    if (d.name !== orig.name) payload.name = d.name;
    if (d.topic !== orig.topic) payload.topic = d.topic;
    if (d.cat !== orig.cat) payload.cat = d.cat || null;
    if (JSON.stringify(d.cfg) !== JSON.stringify(orig.cfg)) payload.cfg = d.cfg;
    if (owChanged) payload.ow = cleanDraftOw(d.ow);
    r = await emit('channel:update', payload);
    if (!r.error && payload.cat) {
      CH.keepTargets = new Set();
      loadDraft();
      renderChSettings();
      toast('Alterações salvas.');
      const k2 = g.categories.find(x => x.id === payload.cat);
      if (k2 && (can(g, 'manageRoles') || g.ownerId === S.user.id)) confirmModal(`Sincronizar com "${k2.name}"?`, 'O canal mudou de categoria. Quer que ele passe a seguir as permissões da nova categoria? As permissões próprias dele serão apagadas.', 'Sincronizar', async () => {
        const s = await emit('channel:sync', { channelId: c.id });
        if (s.error) toast(s.error); else toast('Permissões sincronizadas.');
      }, 'Manter como está');
      return;
    }
  }
  if (r.error) return toast(r.error);
  CH.keepTargets = new Set();
  // o grupo atualizado chega pelo servidor; recarrega a partir dele
  setTimeout(() => { if (CH.mode) { loadDraft(); renderChSettings(); } }, 150);
  CH.orig = JSON.stringify(CH.draft);
  updSaveBar();
  toast('Alterações salvas.');
}

// ---------------------------------------------------------------------
// Voz: permissões da sala e "pressionar para falar"
// ---------------------------------------------------------------------
function applyVoicePerms(perms, cfg, joining) {
  call.vperms = perms || { speak: true, video: true, stream: true, useVAD: true };
  call.vcfg = cfg || null;
  if (!call.vperms.speak && call.micOn) {
    call.micOn = false; if (call.micTrack) call.micTrack.enabled = false;
    if (!joining) toast('Você não pode mais falar nesta sala.');
    else toast('Nesta sala você só pode ouvir.');
  }
  if (!call.vperms.video && call.camTrack) { toggleCam(); toast('A câmera foi desligada: não é permitida nesta sala.'); }
  if (!call.vperms.stream && call.screenTrack) { stopScreen(); toast('A transmissão foi encerrada: não é permitida nesta sala.'); }
  if (!call.vperms.useVAD && !joining && prefs.inputMode !== 'ptt') toast(`Esta sala usa "pressionar para falar": segure ${keyLabel(prefs.pttKey)} para falar.`, 6000);
  if (!call.vperms.useVAD && joining) toast(`Nesta sala é preciso segurar ${keyLabel(prefs.pttKey)} para falar.`, 6000);
  applyPtt();
  if (typeof maybeApplyRoomNs === 'function') maybeApplyRoomNs();
  call.peers.forEach(tunePeerSenders);
  sendState?.(); renderControls(); renderCallbar?.(); renderLocalTiles?.();
}
const ptt = { down: false };
const pttMode = () => !!call.channelId && (prefs.inputMode === 'ptt' || call.vperms?.useVAD === false);
const keyLabel = code => !code ? 'a tecla' : code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : ({ Space: 'Espaço', Backquote: '`', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', CapsLock: 'Caps Lock', Tab: 'Tab' }[code] || code);
// No "pressionar para falar" o som só passa enquanto a tecla está apertada
function applyPtt() {
  const t = call.micTrack;
  if (!t) return;
  const open = !pttMode() || ptt.down;
  if (t._pttGain) t._pttGain.gain.setTargetAtTime(open ? 1 : 0, t._pttGain.context.currentTime, 0.01);
  else if (pttMode()) t.enabled = call.micOn && open;
  document.body.classList.toggle('ptt-on', pttMode() && ptt.down);
}
const typingInField = e => { const el = e.target; return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
document.addEventListener('keydown', e => {
  if (!pttMode() || e.code !== (prefs.pttKey || 'KeyV') || e.repeat || typingInField(e)) return;
  ptt.down = true; applyPtt();
});
document.addEventListener('keyup', e => {
  if (e.code !== (prefs.pttKey || 'KeyV') || !ptt.down) return;
  ptt.down = false; applyPtt();
});
window.addEventListener('blur', () => { if (ptt.down) { ptt.down = false; applyPtt(); } });
// botão "segure para falar" (celular)
document.addEventListener('pointerdown', e => { if (e.target.closest('#ptt-btn')) { e.preventDefault(); ptt.down = true; applyPtt(); } });
['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => { if (ptt.down && document.querySelector('#ptt-btn')) { ptt.down = false; applyPtt(); } }));
