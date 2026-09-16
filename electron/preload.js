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
  // Clears an unfinished setup and restarts the app at the first setup step
  resetSetup: () => ipcRenderer.invoke('desktop:reset-setup'),
  openBackupsFolder: () => ipcRenderer.invoke('desktop:open-backups-folder'),
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  // Printing through Windows printers: listPrinters() -> [{ name, displayName, isDefault }];
  // printHtml({ html, deviceName, silent, paperWidth, fitToContent }) -> { ok, error? }
  listPrinters: () => ipcRenderer.invoke('desktop:list-printers'),
  printHtml: (job) => ipcRenderer.invoke('desktop:print-html', job),
  printerRequest: (action, body) => ipcRenderer.invoke('desktop:printer-request', { action, body }),
  confirmManager: (manager) => ipcRenderer.invoke('desktop:confirm-manager', manager),
  getPrinterSettings: () => ipcRenderer.invoke('desktop:get-printer-settings'),
  setPrinterSettings: (settings) => ipcRenderer.invoke('desktop:set-printer-settings', settings),
  // Screen, till and layout settings, kept per computer
  getUiSettings: () => ipcRenderer.invoke('desktop:get-ui-settings'),
  setUiSettings: (settings) => ipcRenderer.invoke('desktop:set-ui-settings', settings),
  minimize: () => ipcRenderer.invoke('desktop:window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop:window-toggle-maximize'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  // { message, at } while setup connects to the cloud database and authorises this POS
  onSetupStep: (callback) => {
    const listener = (_event, step) => callback(step);
    ipcRenderer.on('desktop:setup-step', listener);
    return () => ipcRenderer.removeListener('desktop:setup-step', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});
