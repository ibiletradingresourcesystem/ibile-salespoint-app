'use strict';

/**
 * electron-builder afterPack hook.
 *
 * 1. electron-builder leaves out node_modules folders when copying extraResources, but the POS
 *    server needs its traced dependencies, so they are copied here.
 * 2. Refuses to produce a package that would not run, or that carries environment files (which can
 *    hold cloud database credentials).
 */

const fs = require('fs');
const path = require('path');

const serverBuild = path.resolve(__dirname, '..', '..', 'build', 'desktop', 'app-server');

exports.default = async function afterPack(context) {
  const resources = path.join(context.appOutDir, 'resources');
  const serverResources = path.join(resources, 'app-server');
  const mongod = context.electronPlatformName === 'win32' ? 'mongod.exe' : 'mongod';

  const sourceModules = path.join(serverBuild, 'node_modules');
  if (fs.existsSync(sourceModules)) {
    fs.cpSync(sourceModules, path.join(serverResources, 'node_modules'), { recursive: true, dereference: true });
  }

  const required = [
    'app-server/server.js',
    'app-server/node_modules/next/package.json',
    'app-server/node_modules/mongoose/package.json',
    'app-server/.next/static',
    'app-server/public',
    `mongodb/bin/${mongod}`,
    ...(context.electronPlatformName === 'win32' ? ['redist/vc_redist.x64.exe'] : []),
  ];
  const missing = required.filter((relative) => !fs.existsSync(path.join(resources, relative)));
  if (missing.length > 0) {
    throw new Error(
      `The desktop package is incomplete (missing ${missing.join(', ')}). ` +
      'Run "npm run desktop:build-server" and "npm run desktop:fetch-mongodb" in the POS project first.'
    );
  }

  const envFiles = fs.readdirSync(serverResources).filter((name) => name.startsWith('.env'));
  if (envFiles.length > 0) {
    throw new Error(`Environment files must not be packaged: ${envFiles.join(', ')}`);
  }
};
