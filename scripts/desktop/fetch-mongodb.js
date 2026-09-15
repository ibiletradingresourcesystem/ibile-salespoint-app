#!/usr/bin/env node
'use strict';

/**
 * Downloads the MongoDB Community Server for Windows x64 and keeps only what the desktop app runs:
 *   build/desktop/mongodb/bin/mongod.exe (+ any DLLs beside it) and the licence files.
 *
 * The release and its SHA-256 come from MongoDB's official release list; the download is verified
 * before use.
 *   MONGODB_SERIES=8.0 (default)   newest production release in that series
 *   MONGODB_VERSION=8.0.x          an exact version
 *   --dry-run                      only show which release would be used
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const target = path.join(root, 'build', 'desktop', 'mongodb');
const RELEASES_URL = 'https://downloads.mongodb.org/full.json';

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
};

async function resolveRelease() {
  const response = await fetch(RELEASES_URL);
  if (!response.ok) throw new Error(`Could not read ${RELEASES_URL} (${response.status})`);
  const { versions = [] } = await response.json();

  const exact = process.env.MONGODB_VERSION;
  const series = process.env.MONGODB_SERIES || '8.0';
  const release = versions
    .filter((entry) => entry.production_release && (exact ? entry.version === exact : entry.version.startsWith(`${series}.`)))
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  if (!release) throw new Error(`No production MongoDB release found for ${exact || `series ${series}`}`);

  const download = (release.downloads || []).find((entry) =>
    entry.arch === 'x86_64' &&
    /^windows/.test(entry.target || '') &&
    /\/mongodb-windows-x86_64-[\d.]+\.zip$/.test(entry.archive?.url || '')
  );
  if (!download?.archive?.sha256) throw new Error(`MongoDB ${release.version} has no Windows x64 community zip listed`);

  return { version: release.version, url: download.archive.url, sha256: download.archive.sha256 };
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function main() {
  const release = await resolveRelease();
  console.log(`MongoDB ${release.version}\n  ${release.url}\n  sha256 ${release.sha256}`);
  if (process.argv.includes('--dry-run')) return;

  const versionFile = path.join(target, 'VERSION');
  if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8').trim() === release.version && fs.existsSync(path.join(target, 'bin', 'mongod.exe'))) {
    console.log('Already downloaded.');
    return;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ibile-mongodb-'));
  const zip = path.join(work, 'mongodb.zip');
  try {
    console.log('Downloading (this is a large file)…');
    const response = await fetch(release.url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const hash = crypto.createHash('sha256');
    const source = Readable.fromWeb(response.body);
    source.on('data', (chunk) => hash.update(chunk));
    await pipeline(source, fs.createWriteStream(zip));

    const actual = hash.digest('hex');
    if (actual !== release.sha256) throw new Error(`Checksum mismatch: expected ${release.sha256}, got ${actual}`);
    console.log('Checksum verified. Extracting…');

    const extractDir = path.join(work, 'extracted');
    const extract = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${extractDir}' -Force`], { stdio: 'inherit' })
      : spawnSync('unzip', ['-q', zip, '-d', extractDir], { stdio: 'inherit' });
    if (extract.status !== 0) throw new Error('Could not extract the MongoDB archive');

    const mongod = findFile(extractDir, 'mongod.exe');
    if (!mongod) throw new Error('mongod.exe was not found in the archive');
    const binDir = path.dirname(mongod);
    const releaseDir = path.dirname(binDir);

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.join(target, 'bin'), { recursive: true });
    fs.copyFileSync(mongod, path.join(target, 'bin', 'mongod.exe'));
    for (const name of fs.readdirSync(binDir).filter((file) => file.toLowerCase().endsWith('.dll'))) {
      fs.copyFileSync(path.join(binDir, name), path.join(target, 'bin', name));
    }
    for (const name of fs.readdirSync(releaseDir).filter((file) => /^(LICENSE|THIRD-PARTY|README|MPL)/i.test(file))) {
      fs.copyFileSync(path.join(releaseDir, name), path.join(target, name));
    }
    fs.writeFileSync(versionFile, `${release.version}\n`);
    console.log(`MongoDB ${release.version} ready in ${target}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
