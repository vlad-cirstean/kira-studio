/**
 * The application menu (P3 W11) — the minimum an app needs to not feel broken: About/Quit,
 * Open Repository…, Reload, Toggle DevTools, Close Window. Not a feature surface — every git
 * action stays in the UI (§2.2), so "Open Repository…" only records the picked folder into
 * `recentRepos`; the user opens it from the UI's own repo picker, the same as any other recent
 * entry. Nothing here pushes state into an already-open webContents — the finalized ipc
 * contract (W1) has no event for "a repo became available," and adding one is not this work
 * item's job.
 */

import type { Dialogs } from "@kira-version/core";
import { Menu } from "electron";
import type { RecentRepos } from "./recentRepos.ts";

export interface BuildMenuOptions {
  readonly dialogs: Dialogs;
  readonly recentRepos: RecentRepos;
}

export function buildMenu(opts: BuildMenuOptions): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Kira Version",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Open Repository…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            void (async () => {
              const path = await opts.dialogs.pickFolder({ title: "Open Repository" });
              if (path) await opts.recentRepos.add(path);
            })();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
    },
    {
      label: "Window",
      submenu: [{ role: "close" }],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}
