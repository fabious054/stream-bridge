/**
 * preload.js — Bridge segura contextIsolation
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  // Server
  startServer:  (port)  => ipcRenderer.invoke('server:start', port),
  stopServer:   ()      => ipcRenderer.invoke('server:stop'),
  serverStatus: ()      => ipcRenderer.invoke('server:status'),
  getIP:        ()      => ipcRenderer.invoke('get:ip'),
  openBrowser:  (url)   => ipcRenderer.invoke('open:browser', url),

  // Events from main
  onPeerUpdate: (cb)    => ipcRenderer.on('peer-update', (_, data) => cb(data)),

  // Window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close'),
  quit:     () => ipcRenderer.send('win:quit'),
});
