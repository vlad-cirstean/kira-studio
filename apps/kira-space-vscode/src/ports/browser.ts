/**
 * `Browser` over `vscode.env.openExternal` (P74 §3.3) — the built-in API for handing a URL to the
 * OS's own default handler, the same "built-in command over a lower-level API" precedent
 * `VsCodeWindows` already set for `vscode.openFolder`.
 */
import type { Browser } from '@kira/git-core';
import * as vscode from 'vscode';

export class VsCodeBrowser implements Browser {
  async openExternal(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
