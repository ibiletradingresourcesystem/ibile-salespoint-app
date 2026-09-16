'use strict';

/**
 * Ibile POS desktop app.
 *
 * Runs the existing System POS on the customer's computer:
 *   local MongoDB (lib/mongo.js)  ->  POS server = the same Next.js app (lib/server.js)  ->  window
 * and keeps it in step with the cloud through the sync engine inside the POS server
 * (src/lib/desktop/syncEngine.js). Sync runs only when staff ask for it (Sync Products, Sync Now),
 * so the cloud deployment is not called in the background.
 *
 * There is no server PC and no server in the cloud path: every installation is self-contained and
 * syncs directly with the customer's cloud MongoDB. The connection string stays in this process
 * (DPAPI-encrypted on disk) and the local POS server; it is never given to the page.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, net, powerMonitor, safeStorage, shell } = require('electron');

const { getPaths } = require('./lib/paths');
const { createLogger } = require('./lib/logger');
const { DesktopConfig } = require('./lib/config');
const { LocalMongo } = require('./lib/mongo');
const { LocalServer } = require('./lib/server');
const backups = require('./lib/backup');
const migrations = require('./lib/migrations');
const { Updater } = require('./lib/updater');
const cloud = require('./lib/cloud');
const { isSrvUri, resolveSrvConnectionString } = require('./lib/srv');
const { readPreconfiguredCloud } = require('./lib/provisioning');
const printing = require('./lib/printing');
const appDefaults = require('./app-config.json');

// Testing and support: run against a separate data folder without touching the real installation
if (process.env.POS_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.POS_USER_DATA_DIR));
}

const SPLASH = path.join(__dirname, 'splash.html');
const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const internalToken = crypto.randomBytes(32).toString('hex');

let paths;
let log;
let config;
let mongo;
let server;
let updater;
let mainWindow = null;
let shuttingDown = false;
let busy = false;
let updatePrompted = false;
const crashTimes = [];

/* ------------------------------------------------------------------ helpers */

const backupMeta = () => ({
  appVersion: app.getVersion(),
  installationId: config.get('installationId'),
  installationName: config.get('installationName'),
});

function serverEnv() {
  const enrolled = config.isEnrolled;
  return {
    POS_RUNTIME: 'desktop',
    MONGODB_URI: mongo.uri(),
    SESSION_SECRET: config.secret('sessionSecret'),
    NEXTAUTH_SECRET: config.secret('sessionSecret'),
    DESKTOP_INTERNAL_TOKEN: internalToken,
    DESKTOP_APP_VERSION: app.getVersion(),
    SYNC_INSTALLATION_ID: config.get('installationId'),
    SYNC_INSTALLATION_NAME: config.get('installationName'),
    SYNC_LOCATION_ID: config.get('enrollment')?.locationId || '',
    // The Atlas hosts already looked up (lib/srv.js), so the server does not depend on SRV DNS answers
    CLOUD_MONGODB_URI: enrolled ? config.secret('cloudConnectUri') || config.secret('cloudMongoUri') : '',
    CLOUD_MONGODB_DB: enrolled ? config.get('cloudDbName') : '',
    CLOUD_MONGODB_HOST: enrolled ? config.get('cloudHost') || '' : '',
  };
}

/**
 * Looks up the hosts behind a mongodb+srv:// connection string and keeps the result (encrypted).
 * Installations set up before this existed get it on their next start.
 */
async function refreshCloudConnectUri({ wait = false } = {}) {
  if (!config.isEnrolled || !isSrvUri(config.secret('cloudMongoUri'))) return false;
  const run = async () => {
    try {
      const { uri, resolver } = await resolveSrvConnectionString(config.secret('cloudMongoUri'), { log });
      if (uri === config.secret('cloudConnectUri')) return false;
      config.setSecret('cloudConnectUri', uri);
      log.info(`Cloud database hosts updated (looked up with ${resolver})`);
      return true;
    } catch (error) {
      log.warn(error.message);
      return false;
    }
  };
  if (wait) return run();
  run();
  return false;
}

function sendSplash(text, isError = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents.getURL().startsWith('file:')) return;
  mainWindow.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)}, ${isError})`).catch(() => {});
}

async function showSplash(text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents.getURL().startsWith('file:')) {
    await mainWindow.loadFile(SPLASH).catch(() => {});
  }
  sendSplash(text);
}

async function fetchStatus() {
  try {
    const response = await fetch(`${server.origin}/api/desktop/status`, { signal: AbortSignal.timeout(5000) });
    return await response.json();
  } catch {
    return null;
  }
}

async function loadPos() {
  const status = await fetchStatus();
  const target = status?.enrolled && status?.initialSyncComplete ? '/' : '/desktop-setup';
  await mainWindow.loadURL(`${server.origin}${target}`);
}

async function restartServer() {
  await server.restart(serverEnv());
}

/**
 * Automatic sync runs inside the POS server. This only wakes it straight away when the computer's
 * internet comes back or it resumes from sleep, instead of waiting for the next offline retry.
 */
function watchConnectivity() {
  let wasOnline = net.isOnline();
  setInterval(() => {
    const online = net.isOnline();
    if (online && !wasOnline) {
      log.info('Internet connection restored; syncing');
      syncNow();
    }
    wasOnline = online;
  }, 10 * 1000).unref?.();
  powerMonitor.on('resume', () => syncNow());
}

/** Runs a sync cycle in the POS server now (menu, setup, reconnect). */
async function syncNow() {
  try {
    const response = await fetch(`${server.origin}/api/desktop/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-desktop-internal-token': internalToken },
      body: JSON.stringify({ force: true }),
      signal: AbortSignal.timeout(10 * 1000),
    });
    return { ok: response.ok };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/* ------------------------------------------------------------------ window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Ibile POS',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#0e7490',
    // No Windows title bar or menu: help, system actions, minimize and exit are buttons in the POS itself
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // A till that is minimised or behind another window keeps running at full speed
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    // Support and automated checks: run without putting a window in front of the till user
    if (process.env.POS_WINDOW_HIDDEN === '1') return;
    mainWindow.maximize();
    mainWindow.show();
  });

  const isLocal = (url) => Boolean(server?.port) && (url === server.origin || url.startsWith(`${server.origin}/`));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocal(url) || url.startsWith('file:')) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
  });

  // Developer tools only when running from source (F12 or Ctrl+Shift+I)
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      const toggle = input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'));
      if (toggle) mainWindow.webContents.toggleDevTools();
    });
  }

  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  mainWindow.on('close', (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      shutdown();
    }
  });

  mainWindow.on('session-end', () => shutdown());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadFile(SPLASH);
}

/* ------------------------------------------------------------------ startup */

async function prepareDatabase() {
  const uri = mongo.uri();
  const { pending, hasData } = await migrations.inspect(uri);
  const lastVersion = config.get('lastRunVersion');
  const versionChanged = Boolean(lastVersion) && lastVersion !== app.getVersion();

  if (hasData && (pending.length > 0 || versionChanged)) {
    sendSplash('Backing up local data…');
    await backups.createBackup({ uri, backupsDir: paths.backupsDir, reason: 'pre-migration', meta: backupMeta(), log });
  }
  if (pending.length > 0) {
    sendSplash('Updating local data…');
    await migrations.runMigrations(uri, pending, log);
  }
  config.set({ lastRunVersion: app.getVersion() });
}

function scheduleAutoBackups() {
  const run = async () => {
    if (busy || shuttingDown) return;
    const last = config.get('lastAutoBackupAt');
    if (last && Date.now() - new Date(last).getTime() < AUTO_BACKUP_INTERVAL_MS) return;
    try {
      await backups.createBackup({ uri: mongo.uri(), backupsDir: paths.backupsDir, reason: 'auto', meta: backupMeta(), log });
      config.set({ lastAutoBackupAt: new Date().toISOString() });
    } catch (error) {
      log.error('Automatic backup failed', error);
    }
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}

async function startApp() {
  paths = getPaths();
  log = createLogger(paths.logsDir);
  log.info(`Ibile POS ${app.getVersion()} starting (${paths.isDev ? 'development' : 'installed'})`);
  app.setAppUserModelId('com.ibilemart.pos');

  config = new DesktopConfig(paths.configFile, appDefaults);
  await createWindow();
  Menu.setApplicationMenu(null);
  registerIpc();

  mongo = new LocalMongo({ paths, config, log });
  server = new LocalServer({ paths, config, log });
  updater = new Updater({ log, updateConfigPath: paths.updateConfig });
  updater.on('status', onUpdateStatus);

  sendSplash('Starting the local database…');
  await mongo.start();
  mongo.onUnexpectedExit = () => recoverFromCrash('database');

  await prepareDatabase();

  if (config.isEnrolled && isSrvUri(config.secret('cloudMongoUri')) && !config.secret('cloudConnectUri')) {
    sendSplash('Looking up the cloud database…');
    await refreshCloudConnectUri({ wait: true });
  }

  sendSplash('Starting the POS…');
  await server.start(serverEnv());
  server.onUnexpectedExit = () => recoverFromCrash('server');

  await loadPos();
  // Atlas hosts rarely change; a new list is used from the next start
  refreshCloudConnectUri();
  watchConnectivity();
  scheduleAutoBackups();
  updater.init();
}

async function recoverFromCrash(component) {
  if (shuttingDown || busy) return;
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > 10 * 60 * 1000) crashTimes.shift();
  const label = component === 'database' ? 'The local database' : 'The POS service';
  if (crashTimes.length > 3) {
    return fatal(new Error(`${label} keeps stopping. Details are in the logs folder.`));
  }

  busy = true;
  try {
    await showSplash(`${label} stopped. Restarting…`);
    if (component === 'database') {
      await server.stop();
      await mongo.start();
    }
    await server.start(serverEnv());
    await loadPos();
  } catch (error) {
    busy = false;
    return fatal(error);
  }
  busy = false;
}

function runInstaller(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'ignore' });
    child.once('error', (error) => {
      log?.error('Could not run the installer', error);
      resolve(null);
    });
    child.once('exit', (code) => resolve(code));
  });
}

/**
 * mongod.exe needs the Microsoft Visual C++ runtime. The installer adds it; this covers computers where
 * it is still missing (installer run without it, or the runtime removed later).
 */
async function repairVisualCppRuntime(error) {
  const installer = paths && !paths.isDev ? path.join(process.resourcesPath, 'redist', 'vc_redist.x64.exe') : null;
  const bundled = Boolean(installer && fs.existsSync(installer));

  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Ibile POS',
    message: 'Ibile POS needs a Microsoft component that is missing on this computer.',
    detail:
      `${error.message}\n\n` +
      (bundled
        ? 'Choose "Install and Restart". Windows will ask for permission; it takes about a minute.'
        : `Download and install it from Microsoft (${VC_REDIST_URL}), then open Ibile POS again.`) +
      '\n\nSales already saved on this computer are safe.',
    buttons: [bundled ? 'Install and Restart' : 'Download from Microsoft', 'Open Logs Folder', 'Quit'],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 1) await shell.openPath(paths.logsDir);
  if (response === 0 && !bundled) await shell.openExternal(VC_REDIST_URL);
  if (response === 0 && bundled) {
    sendSplash('Installing the Microsoft Visual C++ Runtime…');
    const code = await runInstaller(installer, ['/install', '/passive', '/norestart']);
    log?.info(`Visual C++ Runtime installer finished (exit code ${code})`);
    // 0 installed, 3010 installed (restart pending), 1638 a newer version is already installed
    if ([0, 3010, 1638].includes(code)) {
      app.relaunch();
    } else if (code === null) {
      // Could not start it from here: let Windows open it, then the POS is opened again by hand
      await shell.openPath(installer);
      await dialog.showMessageBox({
        type: 'info',
        title: 'Ibile POS',
        message: 'Finish installing the Microsoft Visual C++ Runtime, then open Ibile POS again.',
        buttons: ['OK'],
      });
    } else {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Ibile POS',
        message: 'The Microsoft Visual C++ Runtime was not installed.',
        detail: `The installer stopped with code ${code}${code === 1602 ? ' (cancelled)' : ''}. ` +
          `You can also install it from ${VC_REDIST_URL}, then open Ibile POS again.`,
        buttons: ['OK'],
      });
    }
  }
  await shutdown();
}

async function fatal(error) {
  log?.error('Fatal error', error);
  sendSplash(error?.message || 'Ibile POS could not start', true);
  if (error?.reason === 'vc_runtime') return repairVisualCppRuntime(error);
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Ibile POS',
    message: 'Ibile POS could not continue.',
    detail: `${error?.message || error}\n\nSales already saved on this computer are safe.`,
    buttons: ['Open Logs Folder', 'Quit'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response === 0 && paths) await shell.openPath(paths.logsDir);
  await shutdown();
}

/* ------------------------------------------------------------------ shutdown */

async function shutdown({ installUpdate = false } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  const installing = Boolean(installUpdate || updater?.isReady);

  try {
    await showSplash(installing ? 'Preparing to install the update…' : 'Closing Ibile POS…');
    await server?.stop();
    if (installing && mongo?.port) {
      sendSplash('Backing up local data…');
      await backups
        .createBackup({ uri: mongo.uri(), backupsDir: paths.backupsDir, reason: 'pre-update', meta: backupMeta(), log })
        .catch((error) => log.error('Backup before update failed', error));
    }
    await mongo?.stop();
  } catch (error) {
    log?.error('Error while closing', error);
  }

  if (installing) {
    log.info('Installing update');
    updater.install();
    return;
  }
  app.exit(0);
}

/* ------------------------------------------------------------------ actions */

// Connection string checked by the setup page's first step, held here until the manager authorises
let pendingCloud = null;

/** Live step messages for the setup page while it connects and authorises (no credentials). */
function sendSetupStep(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:setup-step', { message, at: new Date().toISOString() });
}

const preconfiguredCloud = () => readPreconfiguredCloud({ log, isDev: paths.isDev });

async function lookupCloudDatabase({ connectionString, preconfigured = false }) {
  try {
    if (preconfigured) {
      connectionString = preconfiguredCloud()?.cloudMongoUri;
      if (!connectionString) throw new Error('This installer has no cloud database set up. Enter the connection string.');
    }
    const result = await cloud.lookupCloud(connectionString, { log, onStep: sendSetupStep });
    pendingCloud = {
      connectionString: String(connectionString).trim(),
      connectUri: result.connectUri,
      dbName: result.dbName,
      host: result.host,
    };
    return { ok: true, host: result.host, storeName: result.storeName, locations: result.locations, managers: result.managers };
  } catch (error) {
    pendingCloud = null;
    return { ok: false, error: error.message };
  }
}

async function enrollThisInstallation(payload = {}) {
  if (busy) return { ok: false, error: 'Another operation is in progress. Try again shortly.' };
  if (!pendingCloud) return { ok: false, error: 'Enter the cloud database connection string first.' };
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'Windows cannot encrypt the database credentials for this user, so they cannot be saved.' };
  }

  busy = true;
  try {
    const name = String(payload.installationName || '').trim().slice(0, 80) || config.get('installationName');
    const result = await cloud.enrollInstallation({
      connectionString: pendingCloud.connectionString,
      connectUri: pendingCloud.connectUri,
      log,
      onStep: sendSetupStep,
      dbName: pendingCloud.dbName,
      installationId: config.get('installationId'),
      installationName: name,
      locationId: payload.locationId,
      staffId: payload.staffId,
      pin: payload.pin,
      appVersion: app.getVersion(),
    });

    sendSetupStep('Saving the connection on this computer (encrypted)');
    config.setSecret('cloudMongoUri', pendingCloud.connectionString);
    config.setSecret('cloudConnectUri', result.connectUri || '');
    config.set({
      cloudDbName: result.dbName,
      cloudHost: result.host,
      installationName: result.installation?.name || name,
      enrollment: {
        locationId: result.installation?.locationId || payload.locationId,
        locationName: result.installation?.locationName || '',
        storeName: result.store?.name || '',
        enrolledAt: new Date().toISOString(),
      },
    });
    pendingCloud = null;
    log.info(`Connected to cloud database ${result.host}/${result.dbName} for ${result.installation?.locationName}`);

    sendSetupStep('Restarting the POS service with the cloud connection');
    await restartServer();
    setTimeout(() => mainWindow?.loadURL(`${server.origin}/desktop-setup`), 200);
    return { ok: true };
  } catch (error) {
    log.warn(`Enrolment failed: ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    busy = false;
  }
}

async function reenroll() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Set Up Again', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Set up this POS again',
    message: 'Connect this POS to the cloud again?',
    detail:
      'Use this if the POS was disconnected by a manager, or the cloud database credentials changed. ' +
      'All data on this computer is kept, and anything not yet synced is sent once it is set up.',
  });
  if (response !== 0) return;

  clearCloudConnection();
  await restartServer();
  await mainWindow.loadURL(`${server.origin}/desktop-setup`);
}

function clearCloudConnection() {
  config.setSecret('cloudMongoUri', '');
  config.setSecret('cloudConnectUri', '');
  config.set({ enrollment: null, cloudDbName: '', cloudHost: '' });
}

/**
 * Setup stopped half-way (closed, lost connection, wrong store): clears this computer's POS data and
 * cloud connection, then restarts the app so setup starts from the beginning. Only while setup has
 * never finished, so no sales can be lost; a POS that was in use has Restore from backup and
 * Set up this POS again instead. A safety backup is made first whenever there is local data.
 */
async function resetUnfinishedSetup() {
  if (busy) return { ok: false, error: 'Another operation is in progress. Try again shortly.' };

  const status = await fetchStatus();
  if (!status) return { ok: false, error: 'The POS service is not answering. Close Ibile POS and open it again.' };
  if (status.initialSyncComplete) {
    return {
      ok: false,
      error: 'This POS has already been used, so its data cannot be cleared here. Use Set up this POS again or Restore from backup.',
    };
  }
  const unsent = (status.pending || 0) + (status.failed || 0) + (status.conflicts || 0);
  if (unsent > 0) {
    return { ok: false, error: `${unsent} change(s) on this computer have not reached the cloud yet, so the data cannot be cleared.` };
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Clear and Restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Start setup again',
    message: 'Clear the setup and start again?',
    detail:
      'The cloud connection and the store data downloaded so far are removed from this computer, and Ibile POS restarts ' +
      'at the first setup step. Nothing in the cloud database is changed.',
  });
  if (response !== 0) return { ok: false, canceled: true };

  busy = true;
  try {
    await showSplash('Clearing setup…');
    await server.stop();

    const { hasData } = await migrations.inspect(mongo.uri());
    if (hasData) {
      sendSplash('Saving a safety backup…');
      await backups.createBackup({ uri: mongo.uri(), backupsDir: paths.backupsDir, reason: 'pre-reset', meta: backupMeta(), log });
    }

    sendSplash('Removing local data…');
    await mongo.stop();
    fs.rmSync(paths.dbPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    clearCloudConnection();
    config.set({ lastAutoBackupAt: null });
    log.info('Unfinished setup cleared; restarting');

    app.relaunch();
  } catch (error) {
    log.error('Clearing setup failed', error);
    busy = false;
    return fatal(new Error(`Could not clear the setup: ${error.message}`));
  }
  busy = false;
  await shutdown();
  return { ok: true };
}

async function backupNow() {
  try {
    const { file } = await backups.createBackup({
      uri: mongo.uri(),
      backupsDir: paths.backupsDir,
      reason: 'manual',
      meta: backupMeta(),
      log,
    });
    dialog
      .showMessageBox(mainWindow, { type: 'info', title: 'Backup', message: 'Backup complete', detail: file, buttons: ['OK', 'Show in Folder'] })
      .then(({ response }) => response === 1 && shell.showItemInFolder(file));
    return { ok: true, file };
  } catch (error) {
    log.error('Manual backup failed', error);
    dialog.showErrorBox('Backup failed', error.message);
    return { ok: false, error: error.message };
  }
}

async function restoreFromBackup() {
  if (busy) return { ok: false, error: 'Another operation is in progress' };

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore from backup',
    defaultPath: paths.backupsDir,
    filters: [{ name: 'Ibile POS backup', extensions: [backups.EXTENSION.slice(1)] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  const file = filePaths[0];

  let summary;
  try {
    summary = await backups.verifyBackup(file);
  } catch (error) {
    dialog.showErrorBox('Cannot restore this backup', error.message);
    return { ok: false, error: error.message };
  }

  const { manifest } = summary;
  const status = await fetchStatus();
  const fromOtherInstallation = Boolean(manifest.installationId) && manifest.installationId !== config.get('installationId');
  const detail = [
    `Backup made ${new Date(manifest.createdAt).toLocaleString()} (${manifest.reason}), app version ${manifest.appVersion || 'unknown'}.`,
    'All data on this computer will be replaced. A safety backup of the current data is made first.',
    status?.pending ? `${status.pending} change(s) on this computer have not reached the cloud yet and will be replaced.` : '',
    fromOtherInstallation
      ? `This backup belongs to another installation ("${manifest.installationName || manifest.installationId}"). This computer will take its place and must be set up again with a manager passcode.`
      : '',
  ].filter(Boolean).join('\n\n');

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restore from backup',
    message: 'Replace the data on this computer with this backup?',
    detail,
  });
  if (response !== 0) return { ok: false, canceled: true };

  busy = true;
  let safety = null;
  try {
    await showSplash('Stopping the POS…');
    await server.stop();

    sendSplash('Saving a safety backup of the current data…');
    safety = await backups.createBackup({ uri: mongo.uri(), backupsDir: paths.backupsDir, reason: 'pre-restore', meta: backupMeta(), log });

    sendSplash('Restoring backup…');
    await backups.restoreBackup({ uri: mongo.uri(), file, log });

    if (fromOtherInstallation) {
      clearCloudConnection();
      config.set({
        installationId: manifest.installationId,
        installationName: manifest.installationName || config.get('installationName'),
      });
    }
    await prepareDatabase();
  } catch (error) {
    log.error('Restore failed', error);
    dialog.showErrorBox(
      'Restore failed',
      `${error.message}${safety ? `\n\nThe data from before the restore was saved to:\n${safety.file}` : ''}`
    );
  }

  try {
    sendSplash('Starting the POS…');
    await server.start(serverEnv());
    await loadPos();
  } catch (error) {
    busy = false;
    return fatal(error);
  }
  busy = false;
  return { ok: true };
}

async function checkForUpdates() {
  if (!updater.enabled) {
    dialog.showMessageBox(mainWindow, { type: 'info', title: 'Updates', message: 'Automatic updates are not configured for this build.' });
    return updater.state;
  }
  const state = await updater.check();
  const messages = {
    checking: 'Checking for updates…',
    downloading: `Downloading version ${state.version}…`,
    ready: `Version ${state.version} is ready to install.`,
    'up-to-date': 'Ibile POS is up to date.',
    error: `Could not check for updates: ${state.error}`,
  };
  dialog.showMessageBox(mainWindow, { type: 'info', title: 'Updates', message: messages[state.status] || 'Checking for updates…' });
  return state;
}

function onUpdateStatus(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:update-status', state);
  if (state.status !== 'ready' || updatePrompted) return;
  updatePrompted = true;

  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      title: 'Update ready',
      message: `Ibile POS ${state.version} is ready to install.`,
      detail:
        'Choose Restart Now when no sale is in progress. Otherwise it installs the next time Ibile POS closes. ' +
        'Local data is backed up first.',
    })
    .then(({ response }) => {
      if (response === 0) shutdown({ installUpdate: true });
    });
}

/**
 * Restore and "set up again" can replace data or stop syncing, so a manager or admin confirms them
 * with their passcode. The check runs here (against the local staff records), not in the page.
 */
const managerChecks = { failures: 0, lockedUntil: 0 };

async function verifyManager({ staffId, pin } = {}) {
  if (Date.now() < managerChecks.lockedUntil) {
    throw new Error('Too many wrong passcodes. Try again in a few minutes.');
  }
  let data = {};
  try {
    const response = await fetch(`${server.origin}/api/desktop/verify-manager`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-desktop-internal-token': internalToken },
      body: JSON.stringify({ staffId, pin }),
      signal: AbortSignal.timeout(10 * 1000),
    });
    data = await response.json().catch(() => ({}));
    if (response.ok && data.ok) {
      managerChecks.failures = 0;
      return data;
    }
  } catch {
    throw new Error('The POS service is not responding.');
  }

  managerChecks.failures += 1;
  if (managerChecks.failures >= 5) {
    managerChecks.failures = 0;
    managerChecks.lockedUntil = Date.now() + 5 * 60 * 1000;
  }
  throw new Error(data.message || 'The manager or passcode is not correct.');
}

async function withManager(payload, action) {
  try {
    const manager = await verifyManager(payload);
    log.info(`${action.name} confirmed by ${manager.name}`);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return action();
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (event, payload) => {
      const url = event.senderFrame?.url || '';
      const fromPos = Boolean(server?.port) && event.sender === mainWindow?.webContents && url.startsWith(`${server.origin}/`);
      if (!fromPos) throw new Error('Not allowed');
      return handler(payload || {});
    });
  };

  handle('desktop:get-info', () => ({
    appVersion: app.getVersion(),
    installationId: config.get('installationId'),
    installationName: config.get('installationName'),
    // Host only; the connection string itself is never sent to the page
    cloudHost: config.isEnrolled ? config.get('cloudHost') : '',
    enrolled: config.isEnrolled,
    cloudDbName: config.isEnrolled ? config.get('cloudDbName') : '',
    locationName: config.get('enrollment')?.locationName || '',
    storeName: config.get('enrollment')?.storeName || '',
    // Host only: set up with the customer's database built into this installer
    preconfiguredCloudHost: preconfiguredCloud()?.host || '',
    dataFolder: paths.userData,
    update: updater?.state || null,
  }));
  handle('desktop:cloud-lookup', (payload) => lookupCloudDatabase(payload));
  handle('desktop:enroll', (payload) => enrollThisInstallation(payload));
  handle('desktop:sync-now', () => syncNow());
  // Internet connection of this computer, without contacting the cloud
  handle('desktop:network-status', () => ({ online: net.isOnline() }));
  handle('desktop:backup-now', () => backupNow());
  handle('desktop:restore-backup', (payload) => withManager(payload, function restoreBackup() { return restoreFromBackup(); }));
  handle('desktop:reenroll', (payload) => withManager(payload, async function setUpAgain() { await reenroll(); return { ok: true }; }));
  // Only for a setup that never finished (checked in the function)
  handle('desktop:reset-setup', () => resetUnfinishedSetup());
  handle('desktop:open-backups-folder', () => shell.openPath(paths.backupsDir));
  handle('desktop:open-logs-folder', () => shell.openPath(paths.logsDir));
  handle('desktop:check-for-updates', () => checkForUpdates());
  handle('desktop:install-update', () => {
    if (updater.isReady) shutdown({ installUpdate: true });
    return updater.state;
  });
  // Printing through Windows printer drivers, and this till's printer settings (kept by the app)
  handle('desktop:list-printers', () => printing.listPrinters(mainWindow.webContents));
  handle('desktop:print-html', (payload) => printing.printHtml(payload, { log, webContents: mainWindow.webContents }));
  // Thermal printer check / ESC/POS print through the POS server, allowed before anyone logs in
  handle('desktop:printer-request', async ({ action, body } = {}) => {
    if (!['status', 'print-direct'].includes(action)) throw new Error('Unknown printer action');
    try {
      const response = await fetch(`${server.origin}/api/desktop/printer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-desktop-internal-token': internalToken },
        body: JSON.stringify({ ...(body || {}), action }),
        signal: AbortSignal.timeout(45 * 1000),
      });
      return await response.json();
    } catch (error) {
      return { success: false, available: false, message: `The POS service did not answer: ${error.message}` };
    }
  });
  // Manager or admin passcode for app settings opened from the login screen (same lockout as restore)
  handle('desktop:confirm-manager', async (payload) => {
    try {
      const manager = await verifyManager(payload);
      log.info(`Printer settings opened by ${manager.name}`);
      return { ok: true, name: manager.name };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  // Printer and screen/till settings belong to this computer, not to the store
  const settingsHandlers = (channel, key, label) => {
    handle(`desktop:get-${channel}`, () => config.get(key) || null);
    handle(`desktop:set-${channel}`, (payload) => {
      const text = JSON.stringify(payload || {});
      if (text.length > 20000) throw new Error(`${label} are too large`);
      config.set({ [key]: JSON.parse(text) });
      return { ok: true };
    });
  };
  settingsHandlers('printer-settings', 'printerSettings', 'Printer settings');
  settingsHandlers('ui-settings', 'uiSettings', 'Settings');
  // Window controls (the window has no Windows title bar)
  handle('desktop:window-minimize', () => mainWindow?.minimize());
  handle('desktop:window-toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  handle('desktop:quit', () => shutdown());
}

/* ------------------------------------------------------------------ lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('before-quit', (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      shutdown();
    }
  });

  app.on('window-all-closed', () => app.quit());

  process.on('unhandledRejection', (reason) => log?.error('Unhandled rejection', reason));

  app.whenReady().then(startApp).catch((error) => fatal(error));
}
