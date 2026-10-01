'use strict';

/**
 * Where the local database files live.
 *
 * They used to sit in %APPDATA% (Roaming). On an ordinary home computer that is harmless, but on a
 * managed one Roaming is the folder Windows copies to a server at sign-in and sign-out, or redirects
 * onto a network share outright. Either is fatal for a database: MongoDB does not support its files
 * on network storage, and a profile copy takes them while they are being written. A till set up like
 * that works the first time and will not open the second — which is the shape of the fault this
 * moves away from.
 *
 * %LOCALAPPDATA% is never roamed and never redirected, so the database goes there, and anything
 * already in Roaming is moved across the first time this runs.
 */

const fs = require('fs');
const path = require('path');

/** A path on another computer: \\server\share, or a drive mapped to one. */
function isNetworkPath(target) {
  const full = path.resolve(target);
  if (full.startsWith('\\\\')) return true;
  if (process.platform !== 'win32') return false;
  try {
    // DRIVE_REMOTE drives answer as network; checked by asking Windows, not by guessing
    const { execFileSync } = require('child_process');
    const drive = full.slice(0, 2);
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`,
      ],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' }
    );
    return String(output).trim() === '4';
  } catch {
    return false;
  }
}

const hasContents = (dir) => {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (error) {
    // Different volumes: copy across, then leave the original for the customer's peace of mind
    if (error.code !== 'EXDEV' && error.code !== 'EPERM') throw error;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * The folder to keep the database in, moving an older one across when there is one.
 * Never throws: if the move fails, the till carries on with the folder it already had.
 */
function resolveDataFolder({ dbPath, legacyDbPath, log }) {
  if (!legacyDbPath || legacyDbPath === dbPath) return dbPath;

  if (hasContents(dbPath)) {
    if (hasContents(legacyDbPath)) {
      log?.warn(`An older database folder is still in ${legacyDbPath}; this POS is using ${dbPath}`);
    }
    return dbPath;
  }

  if (!hasContents(legacyDbPath)) return dbPath;

  try {
    log?.info(`Moving the local database out of the roaming profile: ${legacyDbPath} -> ${dbPath}`);
    move(legacyDbPath, dbPath);
    log?.info('Local database folder moved');
    return dbPath;
  } catch (error) {
    log?.error(`Could not move the local database folder: ${error.message}. Using ${legacyDbPath}.`);
    return legacyDbPath;
  }
}

module.exports = { resolveDataFolder, isNetworkPath };
