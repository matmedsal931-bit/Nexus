'use strict';
/* =====================================================================
   Nexo - configuracoes do grupo
   Perfil, engajamento, emojis, membros, cargos/permissoes, convites,
   banimentos e registro de auditoria.
   ===================================================================== */

const PERM_INFO = [
  ['admin', 'Administrador', 'Tem todas as permissões abaixo. Dê com cuidado.'],
  ['manageGroup', 'Gerenciar grupo', 'Mudar nome, ícone, faixa, descrição, convite e mensagens do sistema.'],
  ['manageChannels', 'Gerenciar canais', 'Criar, editar, mover e excluir canais e categorias.'],
  ['manageRoles', 'Gerenciar cargos', 'Criar, editar e dar cargos que estejam abaixo do cargo mais alto da pessoa.'],
  ['manageEmoji', 'Gerenciar emojis', 'Adicionar e remover os emojis personalizados do grupo.'],
  ['kick', 'Expulsar membros', 'Remover membros. Quem foi expulso pode voltar com um convite.'],
  ['ban', 'Banir membros', 'Remover membros de forma permanente, sem poder voltar.'],
  ['manageMessages', 'Gerenciar mensagens', 'Excluir mensagens de outros membros.'],
  ['viewAudit', 'Ver o registro de auditoria', 'Ver quem fez quais alterações no grupo.'],
  ['muteMembers', 'Silenciar voz no servidor', 'Desligar o microfone de outra pessoa para todo mundo na sala.'],
  ['deafenMembers', 'Desativar áudio no servidor', 'Fazer com que a pessoa não ouça ninguém (e também não fale) na sala.'],
  ['moveMembers', 'Mover membros', 'Arrastar ou mover pessoas de uma sala de voz para outra.'],
  ['disconnectMembers', 'Desconectar membros', 'Tirar alguém da chamada de voz.'],
  ['sendMessages', 'Enviar mensagens', 'Escrever nos canais de texto.'],
  ['addReactions', 'Adicionar reações', 'Reagir às mensagens com emoji.'],
  ['view', 'Ver canais', 'Ver os canais do grupo. Dá para esconder canais específicos nas permissões de cada canal.'],
  ['readHistory', 'Ver mensagens anteriores', 'Ler o histórico dos canais de texto.'],
  ['attachFiles', 'Enviar imagens e arquivos', 'Anexar arquivos nas mensagens.'],
  ['embedLinks', 'Enviar links', 'Mandar mensagens com endereços de sites.'],
  ['connect', 'Conectar', 'Entrar nas salas de voz.'],
  ['speak', 'Falar', 'Usar o microfone nas salas de voz.'],
  ['video', 'Câmera', 'Ligar a câmera nas salas de voz.'],
  ['stream', 'Transmitir a tela', 'Compartilhar a tela nas salas de voz.'],
  ['useVAD', 'Detecção de voz', 'Falar sem segurar uma tecla. Sem isso, só com "pressionar para falar".'],
];
const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a'];
const BANNERS = ['', '#ff2d95', '#e8262d', '#f47b20', '#f2d43d', '#8e44ad', '#1e9bff', '#5ce6d3', '#3f7d0e', '#2b2d31'];
const SET_TABS = [
  { id: 'perfil', label: 'Perfil do grupo', perm: 'manageGroup' },
  { id: 'engajamento', label: 'Engajamento', perm: 'manageGroup' },
  { sec: 'Expressões' },
  { id: 'emoji', label: 'Emoji', perm: 'manageEmoji' },
  { sec: 'Pessoas' },
  { id: 'membros', label: 'Membros' },
  { id: 'cargos', label: 'Cargos', perm: 'manageRoles' },
  { id: 'convites', label: 'Convites', perm: 'manageGroup' },
  { sec: 'Moderação' },
  { id: 'auditoria', label: 'Registro de auditoria', perm: 'viewAudit' },
  { id: 'banimentos', label: 'Banimentos', perm: 'ban' },
  { sec: '' },
  { id: 'excluir', label: 'Excluir grupo', owner: true, danger: true },
];
const SET = { gid: null, tab: null, role: null };

const fmtDay = ts => ts ? new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDayTime = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
async function act(ev, data, okMsg) {
  const r = await emit(ev, data);
  if (r.error) { toast(r.error); return null; }
  if (okMsg) toast(okMsg);
  return r;
}
const canOpenSettings = g => ['manageGroup', 'manageRoles', 'manageEmoji', 'kick', 'ban', 'viewAudit'].some(p => can(g, p));
const tabAllowed = (g, t) => t.id && (t.owner ? g.ownerId === S.user.id : !t.perm || can(g, t.perm));
const outranksMe = (g, uid) => uid !== S.user.id && uid !== g.ownerId && rankOf(g, S.user.id) < rankOf(g, uid);
const roleChips = (g, uid) => rolesOf(g, uid).map(r => `<span class="chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`).join('');
const gInitials = g => esc(g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase());
// No perfil do grupo o GIF se mexe; no resto do app ele fica parado.
const gIcon = (g, cls = '', anim = false) => `<div class="g-ic ${cls}">${g.iv
  ? `<img src="/api/gicon/${esc(g.id)}?v=${g.iv}${anim && g.igif ? '&a=1' : ''}" alt="">`
  : gInitials(g)}</div>`;
const gBannerStyle = (g, anim = false) => g.bv
  ? `background:center/cover no-repeat url("/api/gbanner/${esc(g.id)}?v=${g.bv}${anim && g.bgif ? '&a=1' : ''}")`
  : `background:${g.banner ? esc(g.banner) : 'linear-gradient(#f2f3f5, #dcdde1)'}`;

// ---------------------------------------------------------------------
function openSettings(gid, tab) {
  const g = group(gid);
  if (!g || !canOpenSettings(g)) return toast('Você não tem permissão para abrir as configurações.');
  if (typeof CH !== 'undefined' && CH.mode) { if (chDirty()) return nagUnsaved(); CH.mode = null; }
  SET.gid = gid;
  SET.role = null;
  SET.tab = tab && SET_TABS.some(t => t.id === tab && tabAllowed(g, t)) ? tab : SET_TABS.find(t => tabAllowed(g, t)).id;
  closeDrawer();
  $('#settings').classList.remove('hidden');
  renderSettings();
}
function closeSettings() { if (window.beforeSettingsClose && window.beforeSettingsClose() === false) return; window.onSettingsClose?.(); $('#settings').classList.add('hidden'); SET.gid = null; $('#set-body').innerHTML = ''; }
$('#set-close').onclick = closeSettings;

// chamado pelo app quando o grupo muda (para a tela acompanhar em tempo real)
window.onGroupUpdate = g => {
  if (!SET.gid || g.id !== SET.gid) return;
  const el = document.activeElement;
  const typing = el && $('#settings').contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox';
  if (!typing) renderSettings();
};

function renderSettings() {
  const g = group(SET.gid);
  if (!g || !canOpenSettings(g)) return closeSettings();
  if (!SET_TABS.some(t => t.id === SET.tab && tabAllowed(g, t))) { SET.tab = SET_TABS.find(t => tabAllowed(g, t)).id; SET.role = null; }
  // menu lateral (so mostra o que a pessoa pode mexer)
  let nav = `<div class="set-title">${esc(g.name)}</div>`, pendingSec = null;
  for (const t of SET_TABS) {
    if (!t.id) { pendingSec = t.sec; continue; }
    if (!tabAllowed(g, t)) continue;
    if (pendingSec !== null) { nav += `<div class="set-sec">${esc(pendingSec)}</div>`; pendingSec = null; }
    nav += `<button class="set-tab ${t.id === SET.tab ? 'active' : ''} ${t.danger ? 'danger' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`;
  }
  const navEl = $('#set-nav');
  navEl.innerHTML = nav;
  navEl.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { SET.tab = b.dataset.tab; SET.role = null; renderSettings(); });
  const body = $('#set-body');
  const top = body.scrollTop;
  ({ perfil: secPerfil, engajamento: secEngajamento, emoji: secEmoji, membros: secMembros, cargos: secCargos,
    convites: secConvites, auditoria: secAuditoria, banimentos: secBanimentos, excluir: secExcluir })[SET.tab](g, body);
  body.scrollTop = top;
}

// ---------- Perfil do grupo ----------
function secPerfil(g, body) {
  const st = { icon: undefined, banner: g.banner || '', iconImg: null, bannerImg: null, rmBanner: false };
  const on = g.members.filter(m => m.online || m.id === S.user.id).length;
  body.innerHTML = `<h2>Perfil do grupo</h2>
    <p class="muted">Personalize como o grupo aparece para os membros e nos convites.</p>
    <div class="set-cols"><div class="set-form">
      <label>Nome<input id="sp-name" maxlength="40" value="${esc(g.name)}"></label>
      <div class="set-block"><div class="pf-h">Ícone</div><p class="muted small">Use uma imagem quadrada, de pelo menos 512×512.</p>
        <div class="row l"><button class="btn primary" id="sp-pick">Alterar o ícone do grupo</button><button class="btn" id="sp-rm">Remover o ícone</button></div>
        <p class="muted small">Pode ser GIF (até 3 MB): ele se mexe aqui no perfil do grupo e fica parado no resto do app.</p>
        <input type="file" id="sp-file" accept="image/*" hidden></div>
      <div class="set-block"><div class="pf-h">Capa</div>
        <div class="row l"><button class="btn primary" id="sp-bpick">Enviar imagem ou GIF</button><button class="btn" id="sp-brm">Usar só cor</button></div>
        <p class="muted small">Tamanho bom: 960×540. O GIF se mexe aqui no perfil do grupo.</p>
        <input type="file" id="sp-bfile" accept="image/*" hidden>
        <div class="banners" id="sp-banners">${BANNERS.map(c => `<button data-c="${c}" style="background:${c ? `linear-gradient(${c}, ${c}cc)` : 'linear-gradient(#f2f3f5, #dcdde1)'}"></button>`).join('')}</div></div>
      <label>Descrição<textarea id="sp-desc" rows="3" maxlength="300" placeholder="Como o grupo começou? Por que as pessoas devem participar?">${esc(g.desc || '')}</textarea></label>
      <div class="row l"><button class="btn primary" id="sp-save">Salvar alterações</button></div>
    </div>
    <div class="g-card"><div class="g-card-banner" id="sp-cb"></div><div class="g-card-ic" id="sp-ci">${gIcon(g, 'lg', true)}</div>
      <div class="g-card-body"><b id="sp-cn"></b><div class="muted small"><span class="dot"></span> ${on} online &nbsp; <span class="dot off"></span> ${g.members.length} ${g.members.length === 1 ? 'membro' : 'membros'}</div>
      <div class="muted small">Desde ${new Date(g.created).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</div><div class="small" id="sp-cd"></div></div></div></div>`;
  const q = s => body.querySelector(s);
  const preview = () => {
    if (st.bannerImg) q('#sp-cb').style.cssText = `background:center/cover no-repeat url("${st.bannerImg.preview}")`;
    else if (g.bv && !st.rmBanner) q('#sp-cb').style.cssText = gBannerStyle(g, true);
    else q('#sp-cb').style.cssText = `background:${st.banner || 'linear-gradient(#f2f3f5, #dcdde1)'}`;
    q('#sp-cn').textContent = q('#sp-name').value || g.name;
    q('#sp-cd').textContent = q('#sp-desc').value;
    body.querySelectorAll('#sp-banners button').forEach(b => b.classList.toggle('sel', b.dataset.c === st.banner));
    if (st.iconImg) q('#sp-ci').innerHTML = `<div class="g-ic lg"><img src="${st.iconImg.preview}" alt=""></div>`;
    else if (st.icon === null) q('#sp-ci').innerHTML = gIcon({ ...g, iv: 0 }, 'lg');
  };
  q('#sp-name').oninput = preview; q('#sp-desc').oninput = preview;
  q('#sp-banners').onclick = e => { const b = e.target.closest('button'); if (b) { st.banner = b.dataset.c; preview(); } };
  q('#sp-pick').onclick = () => q('#sp-file').click();
  q('#sp-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    q('#sp-save').disabled = true;
    try { st.iconImg = await prepareImage(f, { square: true, max: 256 }); st.icon = undefined; preview(); }
    catch (err) { toast(err.message || 'Não consegui abrir essa imagem.'); }
    q('#sp-save').disabled = false;
  };
  q('#sp-rm').onclick = () => { st.icon = null; st.iconImg = null; preview(); };
  q('#sp-bpick').onclick = () => q('#sp-bfile').click();
  q('#sp-bfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    q('#sp-save').disabled = true;
    try { st.bannerImg = await prepareImage(f, { square: false, max: 960, gifMax: 4 * 1024 * 1024 }); st.rmBanner = false; preview(); }
    catch (err) { toast(err.message || 'Não consegui abrir essa imagem.'); }
    q('#sp-save').disabled = false;
  };
  q('#sp-brm').onclick = () => { st.bannerImg = null; st.rmBanner = true; preview(); };
  q('#sp-save').onclick = async () => {
    q('#sp-save').disabled = true;
    document.activeElement?.blur();
    const ic = st.iconImg ? { iconId: st.iconImg.id, iconStillId: st.iconImg.stillId, iconGif: st.iconImg.gif } : {};
    const bn = st.bannerImg ? { bannerId: st.bannerImg.id, bannerStillId: st.bannerImg.stillId, bannerGif: st.bannerImg.gif }
      : (st.rmBanner ? { bannerImg: null } : {});
    const r = await act('group:edit', { groupId: g.id, name: q('#sp-name').value, desc: q('#sp-desc').value, banner: st.banner,
      icon: st.iconImg ? undefined : st.icon, ...ic, ...bn }, 'Perfil do grupo salvo!');
    if (!r && q('#sp-save')) q('#sp-save').disabled = false;
  };
  preview();
}

// ---------- Engajamento ----------
function secEngajamento(g, body) {
  const text = g.channels.filter(c => c.type === 'text');
  body.innerHTML = `<h2>Engajamento</h2><p class="muted">Configure as mensagens automáticas do sistema.</p>
    <label class="perm"><div><b>Enviar uma mensagem de boas-vindas quando alguém entrar no grupo.</b></div><input type="checkbox" class="tg" id="se-w" ${g.sys.welcome ? 'checked' : ''}></label>
    <div class="set-block"><div class="pf-h">Canal de mensagens do sistema</div><p class="muted small">É o canal onde as mensagens de boas-vindas aparecem.</p>
      <select id="se-c"><option value="">Primeiro canal de texto</option>${text.map(c => `<option value="${c.id}" ${g.sys.channel === c.id ? 'selected' : ''}># ${esc(c.name)}</option>`).join('')}</select></div>`;
  body.querySelector('#se-w').onchange = e => act('group:sys', { groupId: g.id, welcome: e.target.checked });
  body.querySelector('#se-c').onchange = e => { e.target.blur(); act('group:sys', { groupId: g.id, channel: e.target.value || null }, 'Canal atualizado.'); };
}

// ---------- Emoji ----------
function fileToEmoji(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const k = Math.min(96 / img.width, 96 / img.height), w = img.width * k, h = img.height * k;
      c.getContext('2d').drawImage(img, (96 - w) / 2, (96 - h) / 2, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
function secEmoji(g, body) {
  body.innerHTML = `<h2>Emoji</h2>
    <p class="muted">Adicione até 50 emojis personalizados que todos podem usar neste grupo, nas mensagens (digitando <b>:nome:</b>) e nas reações.</p>
    <div class="row l"><button class="btn primary" id="sm-add">Enviar emoji</button><span class="muted small">${g.emojis.length}/50 — pode escolher várias imagens; o nome vem do nome do arquivo.</span></div>
    <input type="file" id="sm-file" accept="image/*" multiple hidden>
    ${g.emojis.length ? `<div class="tbl emo">${g.emojis.map(e => `<div class="tr"><span><img class="cemoji big" src="/api/emoji/${esc(g.id)}/${esc(e.id)}" alt=""></span><span><b>:${esc(e.name)}:</b></span><span class="r"><button class="btn danger sm" data-del="${esc(e.id)}">Remover</button></span></div>`).join('')}</div>`
      : '<div class="set-empty"><b>Sem emojis</b><span>Comece a festa enviando um emoji</span></div>'}`;
  body.querySelector('#sm-add').onclick = () => body.querySelector('#sm-file').click();
  body.querySelector('#sm-file').onchange = async e => {
    for (const f of [...e.target.files].slice(0, 10)) {
      try { if (!await act('emoji:add', { groupId: g.id, name: f.name.replace(/\.[^.]+$/, ''), data: await fileToEmoji(f) })) break; }
      catch { toast(`Não consegui abrir ${f.name}.`); }
    }
  };
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => act('emoji:delete', { groupId: g.id, id: b.dataset.del }));
}

// ---------- Membros ----------
function memberActions(g, uid) {
  const out = [];
  if (can(g, 'manageRoles') && g.roles.length) out.push(`<button class="btn sm" data-m="roles" data-uid="${esc(uid)}">Cargos</button>`);
  if (outranksMe(g, uid)) {
    if (can(g, 'kick')) out.push(`<button class="btn sm" data-m="kick" data-uid="${esc(uid)}">Expulsar</button>`);
    if (can(g, 'ban')) out.push(`<button class="btn danger sm" data-m="ban" data-uid="${esc(uid)}">Banir</button>`);
  }
  return out.join('');
}
function wireMemberActions(root, g, after) {
  root.querySelectorAll('[data-m]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const uid = b.dataset.uid, name = nameOf(uid, '');
    if (b.dataset.m === 'roles') return rolesModal(g, uid);
    const ban = b.dataset.m === 'ban';
    confirmModal(ban ? `Banir ${name}?` : `Expulsar ${name}?`,
      ban ? 'A pessoa sai do grupo e não consegue mais entrar, nem com convite.' : 'A pessoa sai do grupo, mas pode voltar com um novo convite.',
      ban ? 'Banir' : 'Expulsar', async () => { if (await act(ban ? 'member:ban' : 'member:kick', { groupId: g.id, userId: uid }, ban ? `${name} foi banido.` : `${name} foi expulso.`)) after?.(); });
  });
}
function rolesModal(g, uid) {
  const u = userById(uid); if (!u) return;
  const me = rankOf(g, S.user.id), has = new Set(g.memberRoles[uid] || []);
  modal(`<h3>Cargos de ${esc(u.name || u.username)}</h3>
    <div class="role-pick">${g.roles.map((r, i) => `<label class="perm ${i <= me ? 'dis' : ''}"><div><span class="chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span></div>
      <input type="checkbox" class="tg" value="${esc(r.id)}" ${has.has(r.id) ? 'checked' : ''} ${i <= me ? 'disabled' : ''}></label>`).join('')}</div>
    <p class="muted small" style="margin:0">Você só pode dar cargos que estão abaixo do seu.</p>
    <div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rm-save">Salvar</button></div>`, card => {
    card.querySelector('#rm-save').onclick = async () => {
      const roles = [...card.querySelectorAll('input:checked:not(:disabled)')].map(i => i.value);
      if (await act('member:roles', { groupId: g.id, userId: uid, roles }, 'Cargos atualizados.')) closeModal();
    };
  });
}
function secMembros(g, body) {
  const list = [...g.members].sort((a, b) => (g.joined[b.id] || 0) - (g.joined[a.id] || 0));
  body.innerHTML = `<h2>Membros do grupo</h2>
    <div class="tbl-head"><b>${g.members.length} ${g.members.length === 1 ? 'membro' : 'membros'}</b><input id="sm-q" placeholder="Pesquisar pelo nome"></div>
    <div class="tbl mem-t"><div class="tr th"><span>Nome</span><span class="hm">Membro desde</span><span class="hm">Entrou no Nexo</span><span>Cargos</span><span></span></div>
    ${list.map(m => `<div class="tr" data-n="${esc((m.name + " " + m.username).toLowerCase())}"><span class="who" data-uid="${esc(m.id)}">${avatar(m, 'sm')}<b style="color:${esc(nameColor(m.id, m.color, g))}">${esc(m.name)}${m.id === g.ownerId ? `<i class="crown" title="Dono do grupo">${I.crown}</i>` : ''}</b></span>
      <span class="hm">${fmtDay(g.joined[m.id])}</span><span class="hm">${fmtDay(m.created)}</span><span class="chips">${roleChips(g, m.id)}</span><span class="r">${memberActions(g, m.id)}</span></div>`).join('')}</div>
    <p class="muted small">Mostrando ${g.members.length} ${g.members.length === 1 ? 'membro' : 'membros'}</p>`;
  body.querySelector('#sm-q').oninput = e => {
    const v = e.target.value.trim().toLowerCase();
    body.querySelectorAll('.tr[data-n]').forEach(r => r.classList.toggle('hidden', !!v && !r.dataset.n.includes(v)));
  };
  body.querySelectorAll('.who').forEach(w => w.onclick = () => openProfile(w.dataset.uid));
  wireMemberActions(body, g);
}

// ---------- Cargos ----------
function secCargos(g, body) {
  if (SET.role && (SET.role === '@everyone' || g.roles.some(r => r.id === SET.role))) return roleEditor(g, body);
  SET.role = null;
  const me = rankOf(g, S.user.id);
  const count = id => Object.values(g.memberRoles).filter(a => a.includes(id)).length;
  body.innerHTML = `<h2>Cargos</h2><p class="muted">Use cargos para agrupar os membros do grupo e dar permissões.</p>
    <button class="set-card" id="sr-every"><div><b>Permissões padrão</b><div class="muted small">@everyone · vale para todos os membros do grupo</div></div><span>›</span></button>
    <div class="row l" style="justify-content:space-between"><span class="muted small">Os membros usam a cor do cargo mais alto que possuem. Use as setas para reordenar.</span><button class="btn primary" id="sr-new">Criar cargo</button></div>
    <div class="tbl roles"><div class="tr th"><span>Cargos — ${g.roles.length}</span><span>Membros</span><span></span></div>
    ${g.roles.map((r, i) => {
      const ok = i > me;
      return `<div class="tr"><span><span class="chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span></span><span>${count(r.id)} 👤</span>
        <span class="r">${ok ? `<button class="btn sm" data-mv="up" data-id="${esc(r.id)}" ${i - 1 <= me ? 'disabled' : ''} title="Subir">↑</button><button class="btn sm" data-mv="down" data-id="${esc(r.id)}" ${i === g.roles.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
        <button class="btn sm" data-ed="${esc(r.id)}">Editar</button><button class="btn danger sm" data-rm="${esc(r.id)}">Excluir</button>` : '<span class="muted small">acima do seu</span>'}</span></div>`;
    }).join('') || '<div class="set-empty"><b>Nenhum cargo ainda</b><span>Crie um cargo para dar cor e permissões aos membros</span></div>'}</div>`;
  body.querySelector('#sr-every').onclick = () => { SET.role = '@everyone'; renderSettings(); };
  body.querySelector('#sr-new').onclick = async () => { const r = await act('role:create', { groupId: g.id }); if (r) { SET.role = r.role.id; renderSettings(); } };
  body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { SET.role = b.dataset.ed; renderSettings(); });
  body.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => act('role:move', { groupId: g.id, id: b.dataset.id, dir: b.dataset.mv }));
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const r = g.roles.find(x => x.id === b.dataset.rm);
    confirmModal(`Excluir o cargo "${r.name}"?`, 'Os membros perdem esse cargo e as permissões dele.', 'Excluir', () => act('role:delete', { groupId: g.id, id: r.id }));
  });
}

function roleEditor(g, body) {
  const every = SET.role === '@everyone';
  const r = every ? { id: '@everyone', name: '@everyone', color: '', perms: g.everyone } : g.roles.find(x => x.id === SET.role);
  const mine = permsOf(g, S.user.id);
  const locked = !every && rankOf(g, S.user.id) >= g.roles.indexOf(r);
  const st = { color: r.color || '' };
  const holders = every ? [] : g.members.filter(m => (g.memberRoles[m.id] || []).includes(r.id));
  const others = every ? [] : g.members.filter(m => !(g.memberRoles[m.id] || []).includes(r.id));
  body.innerHTML = `<button class="btn sm" id="sr-back">← Voltar</button>
    <h2>Editar cargo — ${esc(r.name)}</h2>
    ${locked ? '<p class="muted">Este cargo está no mesmo nível ou acima do seu; você não pode alterá-lo.</p>' : ''}
    ${every ? '<p class="muted">Estas permissões valem para todos os membros, mesmo sem nenhum cargo.</p>' : `
    <label>Nome do cargo<input id="sr-name" maxlength="32" value="${esc(r.name)}" ${locked ? 'disabled' : ''}></label>
    <div class="set-block"><div class="pf-h">Cor do cargo</div><p class="muted small">Os membros usam a cor do cargo mais alto que possuem.</p>
      <div class="swatches" id="sr-colors"><button type="button" class="swatch none" data-c="" title="Sem cor"></button>${ROLE_COLORS.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}"></button>`).join('')}
      <input type="color" id="sr-color" value="${esc(st.color || '#99aab5')}" title="Outra cor"></div></div>`}
    <div class="set-block"><div class="pf-h">Permissões</div>
    ${PERM_INFO.filter(([k]) => !(every && k === 'admin')).map(([k, label, desc]) => `<label class="perm ${mine[k] && !locked ? '' : 'dis'}"><div><b>${label}</b><p>${desc}</p></div>
      <input type="checkbox" class="tg" data-p="${k}" ${r.perms[k] ? 'checked' : ''} ${mine[k] && !locked ? '' : 'disabled'}></label>`).join('')}</div>
    ${locked ? '' : '<div class="row l"><button class="btn primary" id="sr-save">Salvar alterações</button></div>'}
    ${every || locked ? '' : `<div class="set-block"><div class="pf-h">Membros com este cargo — ${holders.length}</div>
      <div class="chips big">${holders.map(m => `<span class="chip">${esc(m.name)}<button data-take="${esc(m.id)}" title="Remover">✕</button></span>`).join('') || '<span class="muted small">Ninguém ainda.</span>'}</div>
      ${others.length ? `<select id="sr-give"><option value="">Adicionar membro…</option>${others.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>` : ''}</div>`}`;
  const q = s => body.querySelector(s);
  q('#sr-back').onclick = () => { SET.role = null; renderSettings(); };
  if (!every && !locked) {
    const paint = () => body.querySelectorAll('#sr-colors .swatch').forEach(b => b.classList.toggle('sel', b.dataset.c.toLowerCase() === st.color.toLowerCase()));
    q('#sr-colors').onclick = e => { const b = e.target.closest('.swatch'); if (b) { st.color = b.dataset.c; if (st.color) q('#sr-color').value = st.color; paint(); } };
    q('#sr-color').oninput = e => { st.color = e.target.value; paint(); };
    paint();
    const setRoles = (uid, add) => {
      const cur = new Set(g.memberRoles[uid] || []);
      if (add) cur.add(r.id); else cur.delete(r.id);
      return act('member:roles', { groupId: g.id, userId: uid, roles: [...cur] });
    };
    body.querySelectorAll('[data-take]').forEach(b => b.onclick = () => setRoles(b.dataset.take, false));
    q('#sr-give')?.addEventListener('change', e => { const v = e.target.value; e.target.blur(); if (v) setRoles(v, true); });
  }
  q('#sr-save')?.addEventListener('click', async () => {
    const perms = {};
    body.querySelectorAll('[data-p]').forEach(i => { perms[i.dataset.p] = i.checked; });
    document.activeElement?.blur();
    await act('role:edit', { groupId: g.id, id: r.id, name: q('#sr-name')?.value, color: every ? undefined : st.color, perms }, 'Cargo salvo!');
  });
}

// ---------- Convites ----------
function secConvites(g, body) {
  const link = `${location.origin}/?convite=${g.invite}`;
  body.innerHTML = `<h2>Convites</h2><p class="muted">Quem abrir este link cria uma conta (ou entra na sua) e já cai no grupo.</p>
    <div class="copybox"><input readonly value="${esc(link)}"><button class="btn primary" id="sc-copy">Copiar</button></div>
    <p class="muted">Código: <b style="color:var(--txt)">${esc(g.invite)}</b></p>
    <div class="set-block"><div class="pf-h">Gerar novo convite</div><p class="muted small">O link atual para de funcionar. Use se o convite vazou para quem não devia.</p>
      <div class="row l"><button class="btn danger" id="sc-new">Gerar novo convite</button></div></div>`;
  body.querySelector('#sc-copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { toast('Copie o link manualmente.'); } };
  body.querySelector('#sc-new').onclick = () => confirmModal('Gerar novo convite?', 'O link antigo deixa de funcionar na hora.', 'Gerar novo', () => act('invite:reset', { groupId: g.id }, 'Novo convite gerado.'));
}

// ---------- Auditoria ----------
async function secAuditoria(g, body) {
  body.innerHTML = `<h2>Registro de auditoria</h2><p class="muted">As últimas alterações feitas no grupo e quem fez cada uma.</p><p class="muted">Carregando…</p>`;
  const r = await emit('group:audit', { groupId: g.id });
  if (SET.tab !== 'auditoria' || SET.gid !== g.id) return;
  if (r.error) { body.lastElementChild.textContent = r.error; return; }
  body.lastElementChild.outerHTML = r.audit.length
    ? `<div class="tbl aud">${r.audit.map(a => `<div class="tr"><span><b>${esc(a.by)}</b> ${esc(a.text)}</span><span class="muted small r">${fmtDayTime(a.ts)}</span></div>`).join('')}</div>`
    : '<div class="set-empty"><b>Nada por aqui ainda</b><span>As alterações do grupo vão aparecer nesta lista</span></div>';
}

// ---------- Banimentos ----------
async function secBanimentos(g, body) {
  body.innerHTML = `<h2>Banimentos</h2><p class="muted">Pessoas banidas não conseguem entrar no grupo, nem com convite.</p><p class="muted">Carregando…</p>`;
  const r = await emit('group:bans', { groupId: g.id });
  if (SET.tab !== 'banimentos' || SET.gid !== g.id) return;
  if (r.error) { body.lastElementChild.textContent = r.error; return; }
  const draw = bans => {
    body.lastElementChild.outerHTML = bans.length
      ? `<div class="tbl aud">${bans.map(b => `<div class="tr"><span><b>${esc(b.username)}</b><div class="muted small">Banido por ${esc(b.by)} em ${fmtDay(b.ts)}</div></span><span class="r"><button class="btn sm" data-unban="${esc(b.id)}">Remover banimento</button></span></div>`).join('')}</div>`
      : '<div class="set-empty"><b>Ninguém foi banido</b><span>Ainda bem!</span></div>';
    body.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => { const x = await act('ban:remove', { groupId: g.id, userId: b.dataset.unban }, 'Banimento removido.'); if (x) draw(x.bans); });
  };
  draw(r.bans);
}

// ---------- Excluir ----------
function secExcluir(g, body) {
  body.innerHTML = `<h2>Excluir grupo</h2><p class="muted">O grupo, os canais, os cargos e todas as mensagens são apagados para todo mundo. Isso não pode ser desfeito.</p>
    <div class="row l"><button class="btn danger" id="sx-del">Excluir "${esc(g.name)}"</button></div>`;
  body.querySelector('#sx-del').onclick = () => leaveGroupModal(g);
}

// ---------------------------------------------------------------------
// Menu do grupo (clique no nome do grupo)
// ---------------------------------------------------------------------
function openGroupMenu(g, anchor) {
  const owner = g.ownerId === S.user.id, canCh = can(g, 'manageChannels');
  ctx.innerHTML = `<button class="item" data-a="invite">${I.invite}Convidar para o grupo</button>
    ${canOpenSettings(g) ? `<button class="item" data-a="settings">${I.gear}Configurações do grupo</button>` : ''}
    ${canCh ? `<button class="item" data-a="newch">${I.plus}Criar canal</button><button class="item" data-a="newcat">${I.folder}Criar categoria</button>` : ''}
    <div class="sep"></div>
    <button class="item" data-a="mute">${prefs.muted.includes(g.id) ? I.bell + 'Voltar a avisar' : I.bellOff + 'Silenciar grupo'}</button>
    <button class="item" data-a="copyid">${I.copy}Copiar código do convite</button>
    <button class="item danger" data-a="leave">${owner ? I.trash : I.leave}${owner ? 'Excluir grupo' : 'Sair do grupo'}</button>`;
  ctx.onclick = e => {
    const it = e.target.closest('[data-a]'); if (!it) return;
    closeCtx();
    const a = it.dataset.a;
    if (a === 'invite') inviteModal(g);
    if (a === 'settings') openSettings(g.id);
    if (a === 'newch') channelModal(g, 'text');
    if (a === 'newcat') categoryModal(g);
    if (a === 'mute') toggleGroupMute(g.id);
    if (a === 'copyid') navigator.clipboard?.writeText(g.invite).then(() => toast('Código copiado!')).catch(() => toast(g.invite));
    if (a === 'leave') leaveGroupModal(g);
  };
  const r = anchor.getBoundingClientRect();
  placeCtx(r.left + 8, r.bottom + 4);
}
function categoryModal(g) {
  modal(`<h3>Criar categoria</h3>
    <form id="m-cat-f" style="display:flex;flex-direction:column;gap:12px">
      <label>Nome da categoria<input id="m-catname" maxlength="32" placeholder="Ex.: Jogos" required></label>
      <div class="acts"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Criar categoria</button></div>
    </form>`, card => {
    card.querySelector('#m-cat-f').onsubmit = async e => {
      e.preventDefault();
      if (await act('category:create', { groupId: g.id, name: card.querySelector('#m-catname').value })) closeModal();
    };
  });
}

// ---------------------------------------------------------------------
// Extras no cartao de perfil: cargos e moderacao
// ---------------------------------------------------------------------
function profileExtras(uid) {
  const g = curGroup();
  if (!g || !g.members.some(m => m.id === uid)) return '';
  const chips = roleChips(g, uid), acts = memberActions(g, uid);
  return (chips ? `<div class="chips">${chips}</div>` : '') + (acts ? `<div class="row l pf-mod">${acts}</div>` : '');
}
function wireProfileExtras(card) {
  const g = curGroup();
  if (g) wireMemberActions(card, g, closeModal);
}
