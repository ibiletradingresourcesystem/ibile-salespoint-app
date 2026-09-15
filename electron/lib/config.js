'use strict';

/**
 * Per-installation settings in %APPDATA%\Ibile POS\config.json.
 *
 * Secrets (local database password, session secret, cloud database connection string) are encrypted with Electron
 * safeStorage, which on Windows uses DPAPI: they can only be read by this Windows user on this
 * computer. Copying the file elsewhere does not expose them.
 */

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { safeStorage } = require('electron');

function seal(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: 'safeStorage', value: safeStorage.encryptString(value).toString('base64') };
  }
  return { enc: 'plain', value };
}

function unseal(sealed) {
  if (!sealed) return '';
  if (sealed.enc === 'safeStorage') {
    return safeStorage.decryptString(Buffer.from(sealed.value, 'base64'));
  }
  return sealed.value || '';
}

class DesktopConfig {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep a copy of an unreadable file instead of silently replacing it
        try {
          fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
        } catch {
          // ignore
        }
      }
    }

    const fresh = {
      installationId: crypto.randomUUID(),
      installationName: os.hostname(),
      serverPort: defaults.serverPort || 5150,
      mongoPort: defaults.mongoPort || 27517,
      mongoUser: 'ibilepos',
      secrets: {},
      enrollment: null,
    };
    this.data = { ...fresh, ...this.data, secrets: { ...(this.data.secrets || {}) } };

    // Earlier builds synced through the web deployment with a token; that setup is no longer used
    if (this.data.secrets.syncToken || this.data.cloudUrl !== undefined) {
      delete this.data.secrets.syncToken;
      delete this.data.cloudUrl;
      if (!this.data.secrets.cloudMongoUri) this.data.enrollment = null;
    }

    if (!this.data.secrets.mongoPassword) this.data.secrets.mongoPassword = seal(crypto.randomBytes(24).toString('base64url'));
    if (!this.data.secrets.sessionSecret) this.data.secrets.sessionSecret = seal(crypto.randomBytes(48).toString('base64url'));
    this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  secret(name) {
    return unseal(this.data.secrets[name]);
  }

  setSecret(name, value) {
    if (value) this.data.secrets[name] = seal(value);
    else delete this.data.secrets[name];
    this.save();
  }

  get isEnrolled() {
    return Boolean(this.data.enrollment && this.data.secrets.cloudMongoUri && this.data.cloudDbName);
  }

  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
    fs.renameSync(temp, this.file);
  }
}

module.exports = { DesktopConfig };
