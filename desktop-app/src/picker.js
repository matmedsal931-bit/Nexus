// Seletor de tela/janela (o Windows não tem um seletor pronto para programas como o Nexo)
const list = document.getElementById('list');
const go = document.getElementById('go');
let all = [], kind = 'window', sel = null;

function render() {
  const items = all.filter(s => s.kind === kind);
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = `<div class="empty">${kind === 'window' ? 'Nenhuma janela aberta para mostrar.' : 'Nenhuma tela encontrada.'}</div>`; return; }
  for (const s of items) {
    const b = document.createElement('button');
    b.className = 'src' + (sel === s.id ? ' sel' : '');
    b.title = s.name;
    const th = document.createElement('img'); th.className = 'th'; th.src = s.thumb; th.alt = '';
    const nm = document.createElement('div'); nm.className = 'nm';
    if (s.icon) { const ic = document.createElement('img'); ic.src = s.icon; ic.alt = ''; nm.appendChild(ic); }
    const t = document.createElement('span'); t.textContent = s.name; nm.appendChild(t);
    b.append(th, nm);
    b.onclick = () => { sel = s.id; go.disabled = false; render(); };
    b.ondblclick = () => { sel = s.id; choose(); };
    list.appendChild(b);
  }
}
function choose() { if (sel) window.picker.choose(sel, document.getElementById('audio').checked); }
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  kind = b.dataset.k; render();
});
go.onclick = choose;
document.getElementById('cancel').onclick = () => window.picker.cancel();
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.picker.cancel(); if (e.key === 'Enter') choose(); });
window.picker.onSources((sources, audioOk) => {
  all = sources;
  if (!all.some(s => s.kind === 'window')) document.querySelector('[data-k=screen]').click(); else render();
  if (!audioOk) { document.getElementById('audio').checked = false; document.getElementById('audio-row').style.display = 'none'; }
});
