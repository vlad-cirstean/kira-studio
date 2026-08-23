/**
 * `WorkspaceRoots` over `vscode.workspace.workspaceFolders` (P3 W10). A file that imports
 * `vscode` carries no logic worth a test (`docs/plans/P3.md`, W10) — this is a direct wrap,
 * nothing more.
 */
import type { Disposable, RepoCandidate, WorkspaceRoots } from "@kira-version/core";
import * as vscode from "vscode";

export class VsCodeWorkspaceRoots implements WorkspaceRoots {
  list(): Promise<readonly RepoCandidate[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return Promise.resolve(
      folders.map((folder) => ({ path: folder.uri.fsPath, label: folder.name })),
    );
  }

  onChanged(fn: () => void): Disposable {
    return vscode.workspace.onDidChangeWorkspaceFolders(() => fn());
  }
}
