'use strict';

/**
 * Bridge between the POS page and the desktop app. Runs before any page script.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// In the desktop app the POS API is the local server on this computer, so it is always reachable.
// The existing POS code uses navigator.onLine to decide between calling the API and queueing in
// the browser; report online so every sale goes straight to the local database. Real internet and
// cloud status is shown from /api/desktop/status.
function reportApiReachable() {
  try {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
  } catch {
    // ignore
  }
  window.addEventListener('offline', (event) => event.stopImmediatePropagation(), true);
}

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({ func: reportApiReachable });
} else {
  webFrame.executeJavaScript(`(${reportApiReachable.toString()})()`);
}

contextBridge.exposeInMainWorld('posDesktop', {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  cloudLookup: (payload) => ipcRenderer.invoke('desktop:cloud-lookup', payload),
  enroll: (payload) => ipcRenderer.invoke('desktop:enroll', payload),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  getNetworkStatus: () => ipcRenderer.invoke('desktop:network-status'),
  backupNow: () => ipcRenderer.invoke('desktop:backup-now'),
  // { staffId, pin } of a manager or admin, checked by the app before anything happens
  restoreBackup: (manager) => ipcRenderer.invoke('desktop:restore-backup', manager),
  reenroll: (manager) => ipcRenderer.invoke('desktop:reenroll', manager),
  openBackupsFolder: () => ipcRenderer.invoke('desktop:open-backups-folder'),
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  minimize: () => ipcRenderer.invoke('desktop:window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop:window-toggle-maximize'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});
