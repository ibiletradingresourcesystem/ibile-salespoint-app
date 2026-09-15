'use strict';

const { Menu } = require('electron');

function buildMenu(actions, { isDev }) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Back Up Now', click: actions.backupNow },
        { label: 'Restore From Backup…', click: actions.restoreBackup },
        { label: 'Open Backups Folder', click: actions.openBackupsFolder },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Sync',
      submenu: [
        { label: 'Sync Now', click: actions.syncNow },
        { type: 'separator' },
        { label: 'Set Up This POS Again…', click: actions.reenroll },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates', click: actions.checkForUpdates },
        { label: 'Open Logs Folder', click: actions.openLogsFolder },
        { type: 'separator' },
        { label: 'About Ibile POS', click: actions.about },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
