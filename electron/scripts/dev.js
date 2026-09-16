'use strict';

/**
 * `npm run desktop:dev`: runs the desktop app from source (POS pages with `next dev`).
 *
 * VS Code's terminal sets ELECTRON_RUN_AS_NODE, which would start Electron as plain Node; it is removed
 * here. Extra arguments are passed to Electron.
 */

const path = require('path');
const { spawn } = require('child_process');

let electron;
try {
  electron = require('electron');
} catch {
  console.error('Electron is not installed. Run "npm run desktop:install" in the POS project first.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
  windowsHide: false,
});
child.on('exit', (code) => process.exit(code ?? 0));
