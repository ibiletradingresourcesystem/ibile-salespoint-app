'use strict';

/**
 * Installer configuration (electron-builder).
 *
 * Automatic updates are enabled only when IBILE_POS_UPDATE_URL is set at build time: the address of
 * the folder where released installers and latest.yml are uploaded. Without it the app still builds
 * and runs, with updates turned off.
 */

const { prepareProvisioning } = require('./scripts/provisioning');

const updateUrl = process.env.IBILE_POS_UPDATE_URL;
// Customer's cloud database pre-filled for setup, encrypted (see scripts/provisioning.js)
const provisioningKey = prepareProvisioning();

module.exports = {
  appId: 'com.ibilemart.pos',
  extraMetadata: provisioningKey ? { ibilePos: { provisioningKey } } : {},
  productName: 'Ibile POS',
  copyright: 'Ibile Mart Systems',
  directories: {
    output: '../dist-desktop',
  },
  files: ['main.js', 'preload.js', 'splash.html', 'app-config.json', 'lib/**/*', 'assets/**/*', 'package.json'],
  extraResources: [
    { from: '../build/desktop/app-server', to: 'app-server', filter: ['**/*'] },
    { from: '../build/desktop/mongodb', to: 'mongodb', filter: ['**/*'] },
    // Microsoft Visual C++ Redistributable (x64), needed by mongod.exe; installed by installer.nsh
    { from: '../build/desktop/redist', to: 'redist', filter: ['vc_redist.x64.exe'] },
    { from: '../build/desktop/provisioning', to: 'provisioning', filter: ['cloud.dat'] },
  ],
  afterPack: './scripts/after-pack.js',
  asar: true,
  win: {
    // Ibile logo (from public/images/logo.png): app executable, taskbar and desktop shortcut
    icon: 'assets/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Keep the vendors' own signatures: re-signing Microsoft's installer can break it
    signExts: ['!vc_redist.x64.exe', '!mongod.exe'],
  },
  nsis: {
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Ibile POS',
    include: 'installer.nsh',
  },
  publish: updateUrl ? [{ provider: 'generic', url: updateUrl }] : null,
};
