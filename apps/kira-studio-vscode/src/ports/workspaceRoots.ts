/**
 * `WorkspaceRoots` over `vscode.workspace.workspaceFolders` (P3 W10). A file that imports
 * `vscode` carries no logic worth a test (`docs/plans/P3.md`, W10) — this is a direct wrap,
 * nothing more.
 */

import type { Disposable, RepoCandidate, WorkspaceRoots } from '@kira/git-core';
import { nfcPath } from '@kira/git-core';
import * as vscode from 'vscode';

export class VsCodeWorkspaceRoots implements WorkspaceRoots {
  list(): Promise<readonly RepoCandidate[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return Promise.resolve(
      // G27 D7: fsPath is filesystem-sourced (a VS Code Uri), compared against a git-sourced
      // `root` elsewhere (RepoPicker.vue:33, fixed here rather than there per F12) — normalized
      // at this one ingestion point.
      folders.map((folder) => ({ path: nfcPath(folder.uri.fsPath), label: folder.name })),
    );
  }

  onChanged(fn: () => void): Disposable {
    return vscode.workspace.onDidChangeWorkspaceFolders(() => fn());
  }
}
