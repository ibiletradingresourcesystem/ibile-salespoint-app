'use strict';

/**
 * Ibile POS desktop app.
 *
 * Runs the existing System POS on the customer's computer:
 *   local MongoDB (lib/mongo.js)  ->  POS server = the same Next.js app (lib/server.js)  ->  window
 * and keeps it in step with the cloud through the sync engine inside the POS server
 * (src/lib/desktop/syncEngine.js), woken by lib/scheduler.js.
 *
 * There is no server PC: every installation is self-contained and talks only to the cloud.
 */

const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { getPaths } = require('./lib/paths');
const { createLogger } = require('./lib/logger');
const { DesktopConfig } = require('./lib/config');
const { LocalMongo } = require('./lib/mongo');
const { LocalServer } = require('./lib/server');
const { SyncScheduler } = require('./lib/scheduler');
const backups = require('./lib/backup');
const migrations = require('./lib/migrations');
const { Updater } = require('./lib/updater');
const cloud = require('./lib/cloud');
const { buildMenu } = require('./lib/menu');
const appDefaults = require('./app-config.json');

// Testing and support: run against a separate data folder without touching the real installation
if (process.env.POS_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.POS_USER_DATA_DIR));
}

const SPLASH = path.join(__dirname, 'splash.html');
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const internalToken = crypto.randomBytes(32).toString('hex');

let paths;
let log;
let config;
let mongo;
let server;
let scheduler;
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
    SYNC_CLOUD_URL: enrolled ? config.get('cloudUrl') : '',
    SYNC_TOKEN: enrolled ? config.secret('syncToken') : '',
    SYNC_LOCATION_ID: config.get('enrollment')?.locationId || '',
  };
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
  scheduler.stop();
  await server.restart(serverEnv());
  scheduler.start();
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
    backgroundColor: '#0e7490',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
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
  buildMenu(menuActions, { isDev: paths.isDev });
  registerIpc();

  mongo = new LocalMongo({ paths, config, log });
  server = new LocalServer({ paths, config, log });
  scheduler = new SyncScheduler({ getOrigin: () => server.origin, internalToken, log });
  updater = new Updater({ log, updateConfigPath: paths.updateConfig });
  updater.on('status', onUpdateStatus);

  sendSplash('Starting the local database…');
  await mongo.start();
  mongo.onUnexpectedExit = () => recoverFromCrash('database');

  await prepareDatabase();

  sendSplash('Starting the POS…');
  await server.start(serverEnv());
  server.onUnexpectedExit = () => recoverFromCrash('server');

  scheduler.start();
  await loadPos();
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
    scheduler.stop();
    if (component === 'database') {
      await server.stop();
      await mongo.start();
    }
    await server.start(serverEnv());
    scheduler.start();
    await loadPos();
  } catch (error) {
    busy = false;
    return fatal(error);
  }
  busy = false;
}

async function fatal(error) {
  log?.error('Fatal error', error);
  sendSplash(error?.message || 'Ibile POS could not start', true);
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
    scheduler?.stop();
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

async function enrollThisInstallation(payload = {}) {
  if (busy) return { ok: false, error: 'Another operation is in progress. Try again shortly.' };
  busy = true;
  try {
    const name = String(payload.installationName || '').trim().slice(0, 80) || config.get('installationName');
    const result = await cloud.enrollInstallation({
      cloudUrl: payload.cloudUrl,
      installationId: config.get('installationId'),
      installationName: name,
      locationId: payload.locationId,
      staffId: payload.staffId,
      pin: payload.pin,
      appVersion: app.getVersion(),
    });

    config.setSecret('syncToken', result.token);
    config.set({
      cloudUrl: result.cloudUrl,
      installationName: result.installation?.name || name,
      enrollment: {
        locationId: result.installation?.locationId || payload.locationId,
        locationName: result.installation?.locationName || '',
        storeName: result.store?.name || '',
        enrolledAt: new Date().toISOString(),
      },
    });
    log.info(`Enrolled with ${result.cloudUrl} for ${result.installation?.locationName}`);

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
      'Use this if the POS was revoked, or its cloud access needs renewing. ' +
      'All data on this computer is kept, and anything not yet synced is sent once it is set up.',
  });
  if (response !== 0) return;

  config.setSecret('syncToken', '');
  config.set({ enrollment: null });
  await restartServer();
  await mainWindow.loadURL(`${server.origin}/desktop-setup`);
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
    scheduler.stop();
    await server.stop();

    sendSplash('Saving a safety backup of the current data…');
    safety = await backups.createBackup({ uri: mongo.uri(), backupsDir: paths.backupsDir, reason: 'pre-restore', meta: backupMeta(), log });

    sendSplash('Restoring backup…');
    await backups.restoreBackup({ uri: mongo.uri(), file, log });

    if (fromOtherInstallation) {
      config.setSecret('syncToken', '');
      config.set({
        installationId: manifest.installationId,
        installationName: manifest.installationName || config.get('installationName'),
        enrollment: null,
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
    scheduler.start();
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

const menuActions = {
  backupNow: () => backupNow(),
  restoreBackup: () => restoreFromBackup(),
  openBackupsFolder: () => shell.openPath(paths.backupsDir),
  syncNow: () => scheduler?.trigger({ force: true }),
  reenroll: () => reenroll(),
  checkForUpdates: () => checkForUpdates(),
  openLogsFolder: () => shell.openPath(paths.logsDir),
  about: () =>
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'About Ibile POS',
      message: `Ibile POS ${app.getVersion()}`,
      detail: [
        `Computer name: ${config.get('installationName')}`,
        `Installation ID: ${config.get('installationId')}`,
        `Cloud: ${config.isEnrolled ? config.get('cloudUrl') : 'not set up'}`,
        `Location: ${config.get('enrollment')?.locationName || '—'}`,
        `Data folder: ${paths.userData}`,
      ].join('\n'),
    }),
};

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
    cloudUrl: config.get('cloudUrl') || appDefaults.cloudUrl || '',
    enrolled: config.isEnrolled,
    locationName: config.get('enrollment')?.locationName || '',
    storeName: config.get('enrollment')?.storeName || '',
    update: updater?.state || null,
  }));
  handle('desktop:cloud-lookup', async ({ cloudUrl }) => {
    try {
      return await cloud.lookupCloud(cloudUrl);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('desktop:enroll', (payload) => enrollThisInstallation(payload));
  handle('desktop:sync-now', async () => {
    await scheduler.trigger({ force: true });
    return { ok: true };
  });
  handle('desktop:backup-now', () => backupNow());
  handle('desktop:restore-backup', () => restoreFromBackup());
  handle('desktop:open-backups-folder', () => shell.openPath(paths.backupsDir));
  handle('desktop:check-for-updates', () => updater.check());
  handle('desktop:install-update', () => {
    if (updater.isReady) shutdown({ installUpdate: true });
    return updater.state;
  });
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
