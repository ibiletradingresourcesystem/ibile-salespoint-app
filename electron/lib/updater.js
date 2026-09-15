'use strict';

/**
 * Application updates (separate from data sync).
 *
 * Updates download in the background and are never installed in the middle of trading: the staff
 * choose "Restart now", or the update installs the next time the app closes. Before installing, the
 * app stops the POS service and backs up the local database (main.js shutdown).
 */

const fs = require('fs');
const { EventEmitter } = require('events');

class Updater extends EventEmitter {
  constructor({ log, updateConfigPath }) {
    super();
    this.log = log;
    this.enabled = Boolean(updateConfigPath && fs.existsSync(updateConfigPath));
    this.state = { status: this.enabled ? 'idle' : 'disabled', version: null, progress: 0, error: '' };
    this.autoUpdater = null;
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.state);
  }

  init() {
    if (!this.enabled) {
      this.log.info('Automatic updates are not configured for this build');
      return;
    }

    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.logger = { info: this.log.info, warn: this.log.warn, error: this.log.error, debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', error: '' }));
    autoUpdater.on('update-available', (info) => this.setState({ status: 'downloading', version: info?.version || null, progress: 0 }));
    autoUpdater.on('update-not-available', () => this.setState({ status: 'up-to-date' }));
    autoUpdater.on('download-progress', (progress) => this.setState({ progress: Math.round(progress?.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => this.setState({ status: 'ready', version: info?.version || this.state.version, progress: 100 }));
    autoUpdater.on('error', (error) => this.setState({ status: 'error', error: error?.message || String(error) }));

    setTimeout(() => this.check(), 60 * 1000).unref?.();
    setInterval(() => this.check(), 6 * 60 * 60 * 1000).unref?.();
  }

  async check() {
    if (!this.autoUpdater || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.setState({ status: 'error', error: error?.message || String(error) });
    }
    return this.state;
  }

  get isReady() {
    return this.state.status === 'ready';
  }

  install() {
    this.autoUpdater?.quitAndInstall(false, true);
  }
}

module.exports = { Updater };
