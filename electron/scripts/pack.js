#!/usr/bin/env node
'use strict';

/**
 * Builds the Windows app (electron-builder), working around security software that will not let
 * the app's executable be created inside the project folder.
 *
 * Avast does exactly that here: anything that tries to create
 *   dist-desktop\win-unpacked\Ibile POS.exe
 * is refused, and electron-builder stops with
 *   EPERM: operation not permitted, rename 'electron.exe' -> 'Ibile POS.exe'
 * even though the same build runs fine in another folder.
 *
 * So the name is tried first. If it is refused, the build runs in a folder outside the project and
 * the installer is copied back into dist-desktop, where it is expected. Nothing else changes: the
 * installer is the same one, and on a machine without that software the build stays where it was.
 *
 *   node scripts/pack.js          installer (nsis)
 *   node scripts/pack.js --dir    unpacked app only, for the packaged tests
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ELECTRON_DIR = path.resolve(__dirname, '..');
const POS_ROOT = path.resolve(ELECTRON_DIR, '..');
const IN_PROJECT = path.join(POS_ROOT, 'dist-desktop');
const OUTSIDE_PROJECT = path.join(os.tmpdir(), 'ibile-pos-build');
const APP_EXE = 'Ibile POS.exe';
const ARTIFACTS = /\.(exe|blockmap)$/i;

/** Can the app's executable be created in this output folder, or is the name blocked? */
function appExeAllowed(outputDir) {
  const unpacked = path.join(outputDir, 'win-unpacked');
  const target = path.join(unpacked, APP_EXE);
  const existed = fs.existsSync(unpacked);
  try {
    fs.mkdirSync(unpacked, { recursive: true });
    // A leftover from an earlier build proves nothing: the build replaces it, so remove it and see
    fs.rmSync(target, { force: true });
    fs.writeFileSync(target, '');
    fs.rmSync(target, { force: true });
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY') return false;
    throw error;
  } finally {
    // Leave no empty folder behind when the build is going to happen elsewhere
    if (!existed) {
      try {
        if (fs.readdirSync(unpacked).length === 0) fs.rmdirSync(unpacked);
      } catch {
        // it has something in it, which is fine
      }
    }
  }
}

function build(outputDir, passThrough) {
  const args = [
    '--config',
    'electron-builder.config.js',
    '--win',
    '--x64',
    ...passThrough,
    `--config.directories.output=${outputDir.replace(/\\/g, '/')}`,
  ];
  const result = spawnSync('npx', ['--no-install', 'electron-builder', ...args], {
    cwd: ELECTRON_DIR,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

function copyArtifacts(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(from)) {
    if (!ARTIFACTS.test(name) && name !== 'latest.yml') continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    copied.push(name);
  }
  return copied;
}

const passThrough = process.argv.slice(2);
const dirOnly = passThrough.includes('--dir');
const allowed = appExeAllowed(IN_PROJECT);
const outputDir = allowed ? IN_PROJECT : OUTSIDE_PROJECT;

if (!allowed) {
  console.log(
    `Security software on this computer will not allow "${APP_EXE}" in ${IN_PROJECT}.\n` +
      `Building in ${outputDir} instead; the installer is copied back afterwards.`
  );
}

if (!build(outputDir, passThrough)) {
  console.error('\nThe build failed. The output above says why.');
  process.exit(1);
}

if (!allowed) {
  if (dirOnly) {
    console.log(`\nApp built in ${path.join(outputDir, 'win-unpacked')}`);
  } else {
    const copied = copyArtifacts(outputDir, IN_PROJECT);
    console.log(`\nCopied to ${IN_PROJECT}: ${copied.join(', ') || 'nothing to copy'}`);
    console.log(`The app itself stays in ${path.join(outputDir, 'win-unpacked')} (POS_EXE for the packaged tests).`);
  }
}
