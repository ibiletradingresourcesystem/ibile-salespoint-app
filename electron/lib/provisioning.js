'use strict';

/**
 * The cloud database connection string pre-filled into this build (see scripts/provisioning.js).
 * Decrypted only in the main process and never sent to the page; the page only learns the host.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let cached;

function readPreconfiguredCloud({ log, resourcesPath = process.resourcesPath, isDev = false } = {}) {
  if (cached !== undefined) return cached;
  cached = null;

  const key = require('../package.json').ibilePos?.provisioningKey;
  const file = isDev
    ? path.resolve(__dirname, '..', '..', 'build', 'desktop', 'provisioning', 'cloud.dat')
    : path.join(resourcesPath, 'provisioning', 'cloud.dat');
  if (!key || !fs.existsSync(file)) return cached;

  try {
    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
    const { cloudMongoUri } = JSON.parse(plain);
    if (!/^mongodb(\+srv)?:\/\//i.test(cloudMongoUri || '')) throw new Error('not a MongoDB connection string');
    cached = {
      cloudMongoUri,
      host: /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(cloudMongoUri)?.[1] || '',
    };
  } catch (error) {
    log?.warn(`Pre-filled cloud database could not be read: ${error.message}`);
  }
  return cached;
}

module.exports = { readPreconfiguredCloud };
