/**
 * `Dialogs` over `vscode.window.showOpenDialog` (P3 W10) — one method, `pickFolder`, exactly
 * what §3.3 says P3 needs.
 */

import type { Dialogs, PickFolderOptions } from '@kira/git-core';
import { nfcPath } from '@kira/git-core';
import * as vscode from 'vscode';

export class VsCodeDialogs implements Dialogs {
  async pickFolder(opts: PickFolderOptions): Promise<string | null> {
    const picked = await vscode.window.showOpenDialog({
      title: opts.title,
      openLabel: 'Open Repository',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    // G27 D7: a folder picker's result is filesystem-sourced, same reasoning as workspaceRoots.ts.
    const fsPath = picked?.[0]?.fsPath;
    return fsPath ? nfcPath(fsPath) : null;
  }
}
