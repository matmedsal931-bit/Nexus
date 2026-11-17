// Nexo para Windows — abre o Nexo numa janela própria, fica na bandeja e se atualiza sozinho.
// O conteúdo (chat, chamadas, telas) vem do servidor: toda versão nova do site já aparece aqui
// sem reinstalar. O programa em si só precisa atualizar quando muda esta parte de "casca".
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, desktopCapturer, shell, Notification, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const SERVER = (arg('server') || process.env.NEXO_URL || 'https://nexus-3h1x.onrender.com').replace(/\/+$/, '');
const ORIGIN = new URL(SERVER).origin;
const START_HIDDEN = process.argv.includes('--hidden');
const ICON = path.join(__dirname, 'icon.png');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.nexo.app');
// toques de ligação e sons tocam mesmo sem clicar antes; chamada não "dorme" minimizada
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ---------- preferências (ficam em %APPDATA%\Nexo\nexo-desktop.json) ----------
const CFG_FILE = path.join(app.getPath('userData'), 'nexo-desktop.json');
let cfg = { closeToTray: true, trayTipShown: false, bounds: null };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) }; } catch {}
const saveCfg = () => { try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); } catch {} };

let win = null, tray = null, quitting = false, unread = 0;
const upd = { ready: null, status: '', updater: null };
const isOurs = u => { try { return new URL(u).origin === ORIGIN; } catch { return false; } };
const isFile = u => typeof u === 'string' && u.startsWith('file:');

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus(); win.flashFrame(false);
}

// ---------- espera o servidor acordar (Render grátis dorme) ----------
async function serverUp() {
  try {
    const r = await Promise.race([net.fetch(SERVER + '/health', { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    return r.ok;
  } catch { return false; }
}
let loading = false;
async function loadApp() {
  if (loading || !win) return;
  loading = true;
  await win.loadFile(path.join(__dirname, 'splash.html')).catch(() => {});
  const t0 = Date.now(); let warned = false;
  while (!(await serverUp())) {
    if (!win) return;
    if (!warned && Date.now() - t0 > 75000) { warned = true; win.webContents.executeJavaScript("postMessage('offline','*')").catch(() => {}); }
    await new Promise(r => setTimeout(r, 2500));
  }
  loading = false;
  win?.loadURL(SERVER + '/').catch(() => {});
}

// ---------- janela principal ----------
function createWindow() {
  const b = cfg.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 800, x: b.x, y: b.y,
    minWidth: 940, minHeight: 560,
    backgroundColor: '#10131b', title: 'Nexo', icon: ICON,
    show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: true,
    },
  });
  Menu.setApplicationMenu(null);
  if (b.max) win.maximize();
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });

  const remember = () => { if (!win || win.isMinimized()) return; cfg.bounds = { ...(win.isMaximized() ? cfg.bounds : win.getBounds()), max: win.isMaximized() }; saveCfg(); };
  win.on('resize', remember); win.on('move', remember);
  win.on('focus', () => win.flashFrame(false));

  // o X minimiza para a bandeja (como o Discord), a não ser que a pessoa desligue isso
  win.on('close', e => {
    if (quitting || !cfg.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!cfg.trayTipShown && process.platform === 'win32' && tray) {
      cfg.trayTipShown = true; saveCfg();
      tray.displayBalloon({ title: 'O Nexo continua aberto', content: 'Ele fica aqui na bandeja recebendo mensagens e ligações. Para sair de vez: botão direito no ícone → Sair.', iconType: 'info' });
    }
  });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // links de fora abrem no navegador; dentro do Nexo, ficam no programa
  wc.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, backgroundColor: '#10131b' } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isOurs(url) || isFile(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // servidor caiu/reiniciou no meio: volta para a tela de "conectando"
  wc.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (isMain && isOurs(url) && code !== -3) loadApp();
  });
  // título "(3) Nexo" → bolinha vermelha na barra de tarefas e pisca se chegou coisa nova
  win.on('page-title-updated', (_e, title) => {
    const n = Number(/^\((\d+)\)/.exec(title)?.[1] || 0);
    if (n > unread && !win.isFocused()) win.flashFrame(true);
    unread = n;
    win.setOverlayIcon(n ? nativeImage.createFromPath(path.join(__dirname, 'badge.png')) : null, n ? `${n} não lidas` : '');
    tray?.setToolTip(n ? `Nexo — ${n} não lidas` : 'Nexo');
  });
  // atalhos: F5/Ctrl+R recarrega, Ctrl+Shift+I ferramentas, Ctrl +/−/0 zoom, F11 tela cheia
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key.toLowerCase(), ctrl = i.control || i.meta;
    if (k === 'f5' || (ctrl && k === 'r')) { e.preventDefault(); isFile(wc.getURL()) ? loadApp() : wc.reload(); }
    else if (ctrl && i.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }
    else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 3)); }
    else if (ctrl && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); }
    else if (ctrl && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
    else if (k === 'f11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
  // botão direito em texto/link (o resto o próprio Nexo já tem menu)
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      p.dictionarySuggestions.slice(0, 5).forEach(s => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
      if (p.dictionarySuggestions.length) items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ label: 'Recortar', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copiar', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Colar', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Selecionar tudo', role: 'selectAll' });
    else if (p.selectionText) items.push({ label: 'Copiar', role: 'copy' });
    if (p.linkURL && /^https?:/i.test(p.linkURL)) items.push({ label: 'Copiar link', click: () => clipboard.writeText(p.linkURL) }, { label: 'Abrir no navegador', click: () => shell.openExternal(p.linkURL) });
    if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(p.x, p.y) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  loadApp();
}

// ---------- permissões: só o servidor do Nexo pode pedir microfone, câmera, tela e avisos ----------
const ALLOWED = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'display-capture', 'speaker-selection', 'idle-detection', 'keyboardLock', 'pointerLock']);
function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ALLOWED.has(perm) && isOurs(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => ALLOWED.has(perm) && (isOurs(origin) || isOurs(wc?.getURL() || '')));
  try { ses.setSpellCheckerLanguages(['pt-BR', 'en-US']); } catch {}

  // compartilhar tela: o nosso seletor de janelas/telas
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isOurs(request.securityOrigin || request.frame?.url || '')) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
      const mine = new Set(BrowserWindow.getAllWindows().map(w => w.getMediaSourceId()));
      const list = sources.filter(s => !mine.has(s.id) && s.name !== 'Compartilhar tela');
      const choice = await pickSource(list, process.platform === 'win32' && request.audioRequested);
      if (!choice) return callback({});
      const src = list.find(s => s.id === choice.id);
      if (!src) return callback({});
      // no Windows o som vem do computador (o Windows não deixa pegar o som de uma janela só);
      // o Nexo pede para tirar as vozes da chamada (restrictOwnAudio)
      callback(choice.audio ? { video: src, audio: 'loopback' } : { video: src });
    } catch (e) { console.error('compartilhar tela:', e); callback({}); }
  }, { useSystemPicker: false });
}

function pickSource(list, audioOk) {
  return new Promise(resolve => {
    const pk = new BrowserWindow({
      parent: win || undefined, modal: !!win, width: 760, height: 560, minWidth: 520, minHeight: 400,
      title: 'Compartilhar tela', backgroundColor: '#161a24', icon: ICON, autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = v => { if (done) return; done = true; ipcMain.removeListener('picker:choose', onChoose); if (!pk.isDestroyed()) pk.close(); resolve(v); };
    const onChoose = (e, id, audio) => { if (e.sender === pk.webContents) finish(id ? { id, audio } : null); };
    ipcMain.on('picker:choose', onChoose);
    pk.on('closed', () => finish(null));
    pk.loadFile(path.join(__dirname, 'picker.html')).then(() => {
      const screens = list.filter(s => s.id.startsWith('screen:'));
      pk.webContents.send('picker:sources', list.map(s => ({
        id: s.id, kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        name: s.id.startsWith('screen:') ? (screens.length > 1 ? `Tela ${screens.indexOf(s) + 1}` : 'Tela inteira') : s.name,
        thumb: s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      })), audioOk);
      pk.show();
    });
  });
}

// ---------- bandeja ----------
function trayMenu() {
  if (!tray) return;
  const boot = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Nexo', click: showWin },
    { type: 'separator' },
    ...(upd.ready ? [{ label: `Reiniciar e atualizar (versão ${upd.ready})`, click: installUpdate }] : [{ label: 'Procurar atualização', click: () => checkUpdate(true) }]),
    { label: 'Abrir junto com o Windows', type: 'checkbox', checked: boot, click: m => setBoot(m.checked) },
    { type: 'separator' },
    { label: 'Sair do Nexo', click: () => { quitting = true; app.quit(); } },
  ]));
}
function setBoot(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  trayMenu();
}

// ---------- atualização do programa ----------
function setupUpdater() {
  let au;
  try {
    const { autoUpdater, NsisUpdater } = require('electron-updater');
    const feed = { provider: 'generic', url: SERVER + '/desktop/' };
    if (app.isPackaged) { au = autoUpdater; au.setFeedURL(feed); }
    else if (process.env.NEXO_UPDATE_TEST) { au = new NsisUpdater(feed); au.forceDevUpdateConfig = true; }
    else return;
  } catch (e) { console.error('atualizador:', e); return; }
  upd.updater = au;
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.logger = { info: m => console.log('[atualização]', m), warn: m => console.warn('[atualização]', m), error: m => console.error('[atualização]', m), debug: () => {} };
  au.on('checking-for-update', () => { upd.status = 'Procurando atualização…'; });
  au.on('update-not-available', () => { upd.status = 'Você já está na versão mais nova.'; });
  au.on('update-available', i => { upd.status = `Baixando a versão ${i.version}…`; });
  au.on('download-progress', p => { upd.status = `Baixando a atualização… ${Math.round(p.percent)}%`; });
  au.on('error', e => { upd.status = /404|Cannot find|latest\.yml/i.test(String(e?.message)) ? 'Você já está na versão mais nova.' : 'Não consegui procurar atualização agora.'; console.error('[atualização]', e?.message); });
  au.on('update-downloaded', i => {
    upd.ready = i.version; upd.status = `A versão ${i.version} foi baixada.`;
    win?.webContents.send('nexo:update-ready', i.version);
    trayMenu();
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Atualização do Nexo pronta', body: 'Clique no botão verde no Nexo (ou aqui) para reiniciar e atualizar. Se preferir, ela entra sozinha da próxima vez que você abrir.', icon: ICON });
      n.on('click', () => { showWin(); });
      n.show();
    }
  });
  setTimeout(() => checkUpdate(), 15000);
  setInterval(() => checkUpdate(), 3 * 3600e3);
}
async function checkUpdate(fromUser) {
  if (!upd.updater) return 'O atualizador só funciona no programa instalado.';
  if (upd.ready) return upd.status;
  try { await upd.updater.checkForUpdates(); } catch {}
  await new Promise(r => setTimeout(r, 1500));
  if (fromUser && tray && process.platform === 'win32') tray.displayBalloon({ title: 'Nexo', content: upd.status || 'Pronto.', iconType: 'info' });
  return upd.status;
}
function installUpdate() {
  if (!upd.ready || !upd.updater) return;
  quitting = true;
  setImmediate(() => upd.updater.quitAndInstall(true, true));
}

// ---------- conversa com o site ----------
ipcMain.on('nexo:version', e => { e.returnValue = app.getVersion(); });
ipcMain.on('nexo:focus', showWin);
ipcMain.on('nexo:attention', () => { if (win && !win.isFocused()) { win.flashFrame(true); if (!win.isVisible()) win.showInactive(); } });
ipcMain.on('nexo:install', installUpdate);
ipcMain.handle('nexo:check', () => checkUpdate());
ipcMain.handle('nexo:settings', () => ({ closeToTray: cfg.closeToTray, openAtLogin: app.getLoginItemSettings().openAtLogin, updateStatus: upd.status }));
ipcMain.handle('nexo:set', (_e, k, v) => {
  if (k === 'closeToTray') { cfg.closeToTray = !!v; saveCfg(); }
  if (k === 'openAtLogin') setBoot(v);
  return true;
});

app.on('second-instance', showWin);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.whenReady().then(() => {
  setupSession();
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Nexo');
  tray.on('click', showWin);
  trayMenu();
  setupUpdater();
});
