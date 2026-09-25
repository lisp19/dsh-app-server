const { contextBridge, ipcRenderer } = require('electron');

// The main process separately verifies the sender's window, main frame and exact URL.
contextBridge.exposeInMainWorld('connectionSettings', Object.freeze({
  read: () => ipcRenderer.invoke('settings:read'),
  locale: value => ipcRenderer.invoke('settings:locale', value),
  connect: (url, token) => ipcRenderer.invoke('settings:connect', { url, token }),
  cancel: () => ipcRenderer.invoke('settings:cancel'),
  onStatus: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('settings:status', (_event, code) => callback(code));
  },
}));
