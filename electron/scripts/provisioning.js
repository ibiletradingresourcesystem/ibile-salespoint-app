'use strict';

/**
 * Build time: pre-fills the customer's cloud database connection string into the installer, so
 * setup on each till only asks for the location and a manager passcode.
 *
 * Source, first found:
 *   1. IBILE_POS_CLOUD_MONGODB_URI environment variable
 *   2. MONGODB_URI in the POS project's .env (the web deployment's database; .env is not in Git)
 * Set IBILE_POS_NO_PREFILL=1 to build an installer that asks for the connection string instead.
 *
 * The string is encrypted (AES-256-GCM) with a key made for this build. The encrypted file goes in
 * the installer's resources and the key inside the app package, so the string is not readable in
 * the installed files as text. Anyone holding the installer can still recover it, so share the
 * installer only with the customer and use a database user limited to the POS database.
 * On the till the app stores it with Windows DPAPI once set up, as for a typed connection string.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POS_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(POS_ROOT, 'build', 'desktop', 'provisioning');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'cloud.dat');

function readDotEnvValue(file, key) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`).exec(line);
      if (match) return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no file
  }
  return '';
}

function findConnectionString() {
  if (process.env.IBILE_POS_NO_PREFILL === '1') return { uri: '', source: 'IBILE_POS_NO_PREFILL=1' };
  if (process.env.IBILE_POS_CLOUD_MONGODB_URI) {
    return { uri: process.env.IBILE_POS_CLOUD_MONGODB_URI.trim(), source: 'IBILE_POS_CLOUD_MONGODB_URI' };
  }
  const fromEnv = readDotEnvValue(path.join(POS_ROOT, '.env'), 'MONGODB_URI');
  return { uri: fromEnv, source: fromEnv ? '.env MONGODB_URI' : 'no IBILE_POS_CLOUD_MONGODB_URI, and no MONGODB_URI in .env' };
}

const hostOf = (uri) => /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(uri)?.[1] || '';

/**
 * Writes build/desktop/provisioning/cloud.dat and returns the key for the app package
 * (null when nothing is pre-filled).
 */
function prepareProvisioning({ log = console.log } = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.rmSync(OUTPUT_FILE, { force: true });

  const { uri, source } = findConnectionString();
  if (!uri) {
    log(`Cloud database: not pre-filled (${source}); setup will ask for the connection string.`);
    return null;
  }
  if (!/^mongodb(\+srv)?:\/\/\S+$/i.test(uri)) throw new Error(`${source} is not a MongoDB connection string`);
  // IBILE_POS_PREFILL_ALLOW_LOCAL=1 is only for testing the installer against a database on this computer
  if (process.env.IBILE_POS_PREFILL_ALLOW_LOCAL !== '1' && /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?(localhost|127\.|\[::1\])/i.test(uri)) {
    throw new Error(`${source} points at this computer (${hostOf(uri)}), not the customer's cloud database`);
  }

  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ cloudMongoUri: uri, createdAt: new Date().toISOString() }), 'utf8'), cipher.final()]);
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
  );
  log(`Cloud database: pre-filled ${hostOf(uri)} (from ${source}, encrypted)`);
  return key.toString('base64');
}

module.exports = { prepareProvisioning, OUTPUT_DIR };
