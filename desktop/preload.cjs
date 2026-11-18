'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('echoLabDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  openOfficialHelp: (kind) => {
    if (kind !== 'driver' && kind !== 'usb') return Promise.reject(new Error('Unsupported link'));
    return ipcRenderer.invoke('echolab:open-official-help', kind);
  }
}));
