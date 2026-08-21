import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '../shared/ipc';

function sendToFocusedWindow(channel: string): void {
  const window = BrowserWindow.getFocusedWindow();
  window?.webContents.send(channel);
}

export function buildMenu(): Menu {
  const isDev = !app.isPackaged;

  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => sendToFocusedWindow(IPC.openSettings),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Project Panel',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendToFocusedWindow(IPC.toggleProjectPanel),
      },
      {
        label: 'Toggle Operations Panel',
        accelerator: 'CmdOrCtrl+J',
        click: () => sendToFocusedWindow(IPC.toggleOperationsPanel),
      },
      ...(isDev
        ? ([
            { type: 'separator' },
            { role: 'reload' },
            { role: 'toggleDevTools' },
          ] satisfies MenuItemConstructorOptions[])
        : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  };

  return Menu.buildFromTemplate([appMenu, editMenu, viewMenu, windowMenu]);
}
