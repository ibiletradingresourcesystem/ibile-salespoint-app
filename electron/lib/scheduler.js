'use strict';

/**
 * Heartbeat for the sync engine in the local server. The engine applies its own offline backoff;
 * this only makes sure it keeps running, and wakes it promptly when the network comes back or the
 * computer resumes from sleep.
 */

const { net, powerMonitor } = require('electron');

class SyncScheduler {
  constructor({ getOrigin, internalToken, log, intervalMs = 20 * 1000 }) {
    this.getOrigin = getOrigin;
    this.internalToken = internalToken;
    this.log = log;
    this.intervalMs = intervalMs;
    this.timers = [];
    this.lastOnline = null;
    this.onResume = () => this.trigger({ force: true });
  }

  start() {
    this.stop();
    this.trigger({ force: true });
    this.timers.push(setInterval(() => this.trigger(), this.intervalMs));
    this.timers.push(setInterval(() => this.watchNetwork(), 10 * 1000));
    powerMonitor.on('resume', this.onResume);
    powerMonitor.on('unlock-screen', this.onResume);
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    powerMonitor.removeListener('resume', this.onResume);
    powerMonitor.removeListener('unlock-screen', this.onResume);
  }

  watchNetwork() {
    const online = net.isOnline();
    if (online && this.lastOnline === false) {
      this.log.info('Network connection restored; syncing');
      this.trigger({ force: true });
    }
    this.lastOnline = online;
  }

  async trigger({ force = false, wait = false } = {}) {
    try {
      const response = await fetch(`${this.getOrigin()}/api/desktop/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-desktop-internal-token': this.internalToken },
        body: JSON.stringify({ force, wait }),
        signal: AbortSignal.timeout(wait ? 5 * 60 * 1000 : 10 * 1000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
}

module.exports = { SyncScheduler };
