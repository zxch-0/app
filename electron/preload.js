'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orb', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  grabToken: () => ipcRenderer.invoke('token:grab'),
  machineInfo: () => ipcRenderer.invoke('app:machine'),
  resolveWebhook: () => ipcRenderer.invoke('webhook:resolve'),
  sendWebhook: (opts) => ipcRenderer.invoke('webhook:send', opts),
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  openExternal: (url) => ipcRenderer.send('open:external', url)
});
