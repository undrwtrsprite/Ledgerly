const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ledgerlyStorage', {
  load: () => ipcRenderer.invoke('ledgerly:load'),
  save: data => ipcRenderer.invoke('ledgerly:save', data),
  platform: process.platform,
})

contextBridge.exposeInMainWorld('ledgerlyUpdates', {
  status: () => ipcRenderer.invoke('ledgerly:updates-status'),
  check: frontend => ipcRenderer.invoke('ledgerly:updates-check', frontend),
  restart: () => ipcRenderer.invoke('ledgerly:updates-restart'),
  booted: version => ipcRenderer.invoke('ledgerly:updates-booted', version),
})
