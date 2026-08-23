/**
 * `Dialogs` over `vscode.window.showOpenDialog` (P3 W10) — one method, `pickFolder`, exactly
 * what §3.3 says P3 needs.
 */
import type { Dialogs, PickFolderOptions } from "@kira-version/core";
import * as vscode from "vscode";

export class VsCodeDialogs implements Dialogs {
  async pickFolder(opts: PickFolderOptions): Promise<string | null> {
    const picked = await vscode.window.showOpenDialog({
      title: opts.title,
      openLabel: "Open Repository",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    return picked?.[0]?.fsPath ?? null;
  }
}
