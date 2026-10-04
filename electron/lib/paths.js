'use strict';

/**
 * Where things live. Business data is kept in the user's application data folder, separate from
 * the installed program files, so updates and reinstalls never touch it.
 *
 *   %APPDATA%\Ibile POS\
 *     config.json        installation id, ports, encrypted secrets
 *     backups\           automatic and manual backups
 *     logs\              main.log, server.log, mongod.log
 *     run\               process ids (to clean up after a crash)
 *
 *   %LOCALAPPDATA%\Ibile POS\
 *     data\mongodb\      local MongoDB database
 *
 * The database is the one thing that must not be in Roaming: that folder is copied to a server at
 * sign-in on a managed computer, or redirected onto a network share, and MongoDB supports neither.
 * %LOCALAPPDATA% stays on the computer. An installation that still has its database in Roaming has
 * it moved across on the next start (lib/dataFolder.js).
 */

const path = require('path');
const { app } = require('electron');

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function getPaths() {
  const isDev = !app.isPackaged;
  const repoRoot = path.resolve(__dirname, '..', '..');
  const userData = app.getPath('userData');
  // app.getPath('userData') is Roaming; the database belongs on this computer only. An instance
  // started with POS_USER_DATA_DIR (tests, support) keeps its database in that folder as well:
  // pointing it at %LOCALAPPDATA% would put it on the installed till's live database.
  const localData = process.env.POS_USER_DATA_DIR
    ? userData
    : process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, app.getName())
      : userData;

  return {
    isDev,
    repoRoot,
    userData,
    localData,
    configFile: path.join(userData, 'config.json'),
    dbPath: path.join(localData, 'data', 'mongodb'),
    legacyDbPath: path.join(userData, 'data', 'mongodb'),
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
