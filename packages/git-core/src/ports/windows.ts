/**
 * G25 D6: "Open in New Window" for a worktree — `vscode.commands.executeCommand('vscode.openFolder',
 * ...)` in VS Code today. One method, matching `Clipboard`'s own "narrow, single-purpose port"
 * shape: `worktree.openWindow` is the only caller, and needs nothing more from a host than "open
 * this folder, optionally in a new window".
 */
export interface OpenFolderOptions {
  /** Defaults to `true` at the call site (`proxyHandlers.ts`'s own `worktree.openWindow` handler)
   *  — opening a worktree in the SAME window tears down the extension host mid-request (D6), so a
   *  caller must opt OUT of a new window explicitly, never opt in. */
  readonly forceNewWindow?: boolean;
}

export interface Windows {
  openFolder(path: string, opts?: OpenFolderOptions): Promise<void>;
}
