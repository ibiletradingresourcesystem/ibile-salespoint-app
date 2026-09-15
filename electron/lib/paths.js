'use strict';

/**
 * Where things live. Business data is kept in the user's application data folder, separate from
 * the installed program files, so updates and reinstalls never touch it.
 *
 *   %APPDATA%\Ibile POS\
 *     config.json        installation id, ports, encrypted secrets
 *     data\mongodb\      local MongoDB database
 *     backups\           automatic and manual backups
 *     logs\              main.log, server.log, mongod.log
 *     run\               process ids (to clean up after a crash)
 */

const path = require('path');
const { app } = require('electron');

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function getPaths() {
  const isDev = !app.isPackaged;
  const repoRoot = path.resolve(__dirname, '..', '..');
  const userData = app.getPath('userData');

  return {
    isDev,
    repoRoot,
    userData,
    configFile: path.join(userData, 'config.json'),
    dbPath: path.join(userData, 'data', 'mongodb'),
    backupsDir: path.join(userData, 'backups'),
    logsDir: path.join(userData, 'logs'),
    runDir: path.join(userData, 'run'),
    mongod: process.env.POS_MONGOD_PATH || (isDev
      ? path.join(repoRoot, 'build', 'desktop', 'mongodb', 'bin', exe('mongod'))
      : path.join(process.resourcesPath, 'mongodb', 'bin', exe('mongod'))),
    serverDir: isDev ? repoRoot : path.join(process.resourcesPath, 'app-server'),
    updateConfig: isDev ? null : path.join(process.resourcesPath, 'app-update.yml'),
  };
}

module.exports = { getPaths };
