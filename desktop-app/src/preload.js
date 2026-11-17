// Ponte entre o site do Nexo e o programa (só o que o site precisa — nada de acesso ao computador)
const { contextBridge, ipcRenderer } = require('electron');

let ready = null;
ipcRenderer.on('nexo:update-ready', (_e, v) => {
  ready = v;
  window.dispatchEvent(new Event('nexo-desktop-update'));
});

contextBridge.exposeInMainWorld('nexoDesktop', {
  version: ipcRenderer.sendSync('nexo:version'),
  platform: process.platform,
  updateReady: () => ready,
  installUpdate: () => ipcRenderer.send('nexo:install'),
  checkUpdate: () => ipcRenderer.invoke('nexo:check'),
  focus: () => ipcRenderer.send('nexo:focus'),
  attention: () => ipcRenderer.send('nexo:attention'),
  settings: () => ipcRenderer.invoke('nexo:settings'),
  setSetting: (k, v) => ipcRenderer.invoke('nexo:set', k, v),
});
