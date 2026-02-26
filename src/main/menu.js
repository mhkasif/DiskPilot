'use strict';
const { Menu } = require('electron');

module.exports = function buildMenu(mainWindow) {
  const send = (ch) => () => mainWindow && mainWindow.webContents.send(ch);

  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'DiskPilot',
      submenu: [
        { label: 'About DiskPilot', click: () => mainWindow && mainWindow.webContents.send('menu:about') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Scan Directory…', accelerator: 'CmdOrCtrl+O', click: send('menu:scan') },
        { label: 'Refresh',         accelerator: 'F5',           click: send('menu:refresh') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Expand All',   click: send('menu:expand-all') },
        { label: 'Collapse All', click: send('menu:collapse-all') },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
