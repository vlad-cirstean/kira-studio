import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { accelerator } from '../shared/domain/shortcuts';
import { IPC } from '../shared/protocol/ipc';

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
        label: 'New Connection',
        accelerator: accelerator('app.newConnection'),
        click: () => sendToFocusedWindow(IPC.newConnection),
      },
      {
        label: 'Settings…',
        accelerator: accelerator('app.settings'),
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
        accelerator: accelerator('view.toggleProjectPanel'),
        click: () => sendToFocusedWindow(IPC.toggleProjectPanel),
      },
      {
        label: 'Toggle Operations Panel',
        accelerator: accelerator('view.toggleOperationsPanel'),
        click: () => sendToFocusedWindow(IPC.toggleOperationsPanel),
      },
      { type: 'separator' },
      {
        label: 'Command Palette…',
        accelerator: accelerator('view.commandPalette'),
        click: () => sendToFocusedWindow(IPC.commandPalette),
      },
      {
        label: 'Find',
        accelerator: accelerator('view.find'),
        click: () => sendToFocusedWindow(IPC.viewFind),
      },
      {
        label: 'Refresh',
        accelerator: accelerator('view.refresh'),
        click: () => sendToFocusedWindow(IPC.viewRefresh),
      },
      {
        label: 'Run Statement',
        accelerator: accelerator('view.run'),
        click: () => sendToFocusedWindow(IPC.viewRun),
      },
      {
        label: 'Run All',
        accelerator: accelerator('view.runAll'),
        click: () => sendToFocusedWindow(IPC.viewRunAll),
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
    submenu: [
      {
        label: 'Next Tab',
        accelerator: accelerator('tab.next'),
        click: () => sendToFocusedWindow(IPC.tabNext),
      },
      {
        label: 'Previous Tab',
        accelerator: accelerator('tab.prev'),
        click: () => sendToFocusedWindow(IPC.tabPrev),
      },
      {
        label: 'Close Tab',
        accelerator: accelerator('tab.close'),
        click: () => sendToFocusedWindow(IPC.tabClose),
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'zoom' },
      // role: 'close' defaults to CmdOrCtrl+W, which "Close Tab" above already claims — moved
      // to Shift+W (browser-tab convention: plain W closes the active tab, Shift+W the window).
      { role: 'close', accelerator: accelerator('window.close') },
    ],
  };

  return Menu.buildFromTemplate([appMenu, editMenu, viewMenu, windowMenu]);
}
