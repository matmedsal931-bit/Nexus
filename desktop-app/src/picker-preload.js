const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('picker', {
  onSources: cb => ipcRenderer.on('picker:sources', (_e, s, audioOk) => cb(s, audioOk)),
  choose: (id, audio) => ipcRenderer.send('picker:choose', id, audio),
  cancel: () => ipcRenderer.send('picker:choose', null, false),
});
