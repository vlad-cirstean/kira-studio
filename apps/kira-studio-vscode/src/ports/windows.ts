/**
 * `Windows` over `vscode.commands.executeCommand('vscode.openFolder', ...)` (G25 D6) — the
 * built-in command every VS Code build already registers for "open this folder, optionally in a
 * new window", rather than a lower-level API this extension would have to keep in step with.
 */
import type { OpenFolderOptions, Windows } from '@kira/git-core';
import * as vscode from 'vscode';

export class VsCodeWindows implements Windows {
  async openFolder(path: string, opts?: OpenFolderOptions): Promise<void> {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(path),
      opts?.forceNewWindow ?? true,
    );
  }
}
