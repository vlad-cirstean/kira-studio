/**
 * P5 — the status-bar blame widget's own `vscode`-facing controller: active-line tracking,
 * debounce, and repoId resolution. `goToFile.ts`'s split applies here too: `blameState.ts` is the
 * pure algebra (what should the status bar show), importable and testable with no extension host —
 * the same split `reviewMarking.ts`/`reviewRanges.ts` already establish for a different feature.
 *
 * Design questions `docs/v1.4/SPEC.md`'s P5 row named, both resolved by `docs/v1.4/plans/
 * P5-git-blame-widget.md` §0: per-line on demand (never a whole-file cache), and a dirty document
 * is never blamed against its own live buffer (shown as its own `'dirty'` state below, resolved
 * again once `onDidSaveTextDocument` fires).
 */
import { relative } from 'node:path';
import { nfcPath } from '@kira/git-core';
import type { EventPayload } from '@kira/git-ipc';
import * as vscode from 'vscode';
import { type BlameDisplayState, selectBlameDisplayState } from './blameState.ts';
import type { ConnectionManager, ConnectionState } from './connection.ts';

export type { BlameDisplayState } from './blameState.ts';
export { blameStatusText } from './blameState.ts';

const DEBOUNCE_MS = 150;

export interface BlameWidgetDeps {
  readonly connection: ConnectionManager;
}

export interface BlameWidgetController extends vscode.Disposable {
  readonly onDidChangeState: vscode.Event<void>;
  state(): BlameDisplayState;
  /** D8-shaped staleness check (mirrors `reviewMarking.ts`'s own `notifyRepoChanged`) — the
   *  underlying git state moved, so whatever is currently shown may be stale. Cheap to just
   *  re-resolve rather than narrow to the exact repo/folder this event names. */
  notifyRepoChanged(payload: EventPayload<'repo.changed'>): void;
  /** Mirrors `reviewMarking.ts`'s own `notifyConnectionState` — called from `extension.ts`'s single
   *  `manager.onStateChange` dispatcher, not a second internal subscription. Drops the memoized
   *  `repoId` per workspace folder on leaving `connected` (a reconnect may land on a different Kira
   *  Studio process, the same reset `lastAppInit` already gets), and re-resolves. */
  notifyConnectionState(state: ConnectionState): void;
}

export function createBlameWidgetController(deps: BlameWidgetDeps): BlameWidgetController {
  const { connection } = deps;

  let current: BlameDisplayState = { kind: 'none' };
  const changeEmitter = new vscode.EventEmitter<void>();

  // repoId resolution memo: keyed by the workspace folder's own nfcPath-composed fsPath — nothing
  // in the extension host already holds "the repoId for the active editor's workspace folder"
  // (plan §5), so this controller resolves it itself via repo.open, idempotent per (connection,
  // repoId), the same way migrateLegacySettings/openRepository (extension.ts) already do.
  const repoIdByFolder = new Map<string, string | null>();
  const repoIdResolving = new Map<string, Promise<string | null>>();

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let lastLineKey: string | undefined;

  function setState(next: BlameDisplayState): void {
    current = next;
    changeEmitter.fire();
  }

  function resolveRepoId(folder: vscode.WorkspaceFolder): Promise<string | null> {
    const key = nfcPath(folder.uri.fsPath);
    const cached = repoIdByFolder.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = repoIdResolving.get(key);
    if (!pending) {
      pending = connection
        .request('repo.open', { path: key })
        .then((r) => (r.kind === 'ok' ? r.repo.repoId : null))
        .catch(() => null)
        .then((repoId) => {
          repoIdByFolder.set(key, repoId);
          repoIdResolving.delete(key);
          return repoId;
        });
      repoIdResolving.set(key, pending);
    }
    return pending;
  }

  function cancelPending(): void {
    if (debounce !== undefined) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    inFlight?.abort();
    inFlight = undefined;
  }

  function refresh(): void {
    cancelPending();

    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme !== 'file' || connection.state.kind !== 'connected') {
      lastLineKey = undefined;
      setState({ kind: 'none' });
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
      lastLineKey = undefined;
      setState({ kind: 'none' });
      return;
    }

    // vscode's own selection is 0-based; git blame -L is 1-based.
    const line = editor.selection.active.line + 1;
    // De-duplicated on the active *line*, not every column move (a horizontal cursor move on the
    // same line must not re-fire) — isDirty is part of the key so a save (which flips it false)
    // always re-triggers even when the line number itself didn't change.
    const lineKey = `${folder.uri.toString()}\0${editor.document.uri.toString()}\0${line}\0${editor.document.isDirty}`;
    if (lineKey === lastLineKey) return;
    lastLineKey = lineKey;

    if (editor.document.isDirty) {
      setState({ kind: 'dirty' });
      return;
    }

    debounce = setTimeout(() => {
      debounce = undefined;
      void runBlame(editor, folder, line, lineKey);
    }, DEBOUNCE_MS);
  }

  async function runBlame(
    editor: vscode.TextEditor,
    folder: vscode.WorkspaceFolder,
    line: number,
    lineKey: string,
  ): Promise<void> {
    const repoId = await resolveRepoId(folder);
    if (repoId === null) {
      if (lineKey === lastLineKey) setState({ kind: 'none' });
      return;
    }
    const rel = relative(folder.uri.fsPath, editor.document.uri.fsPath);
    const controller = new AbortController();
    inFlight = controller;
    try {
      const result = await connection.request(
        'blame.line',
        { repoId, path: rel, line },
        controller.signal,
      );
      // Superseded by a newer line/editor/save before this resolved — never let a slower, older
      // request clobber a newer one's already-rendered answer.
      if (lineKey !== lastLineKey) return;
      setState(
        selectBlameDisplayState({
          kind: 'result',
          repoId,
          sha: result.sha,
          author: result.author,
          authorTimeSeconds: result.authorTimeSeconds,
          summary: result.summary,
        }),
      );
    } catch {
      // Any failure (untracked path, a line past EOF, the request was aborted) reads as "nothing
      // to add here" — never a shown error for what is, from the editor's own vantage, a
      // perfectly ordinary file (mirrors state/schemaColumns.ts's ensureSchemaColumns catch).
      if (lineKey === lastLineKey) setState({ kind: 'none' });
    }
  }

  const subscriptions: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) refresh();
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc === vscode.window.activeTextEditor?.document) refresh();
    }),
  ];

  refresh();

  return {
    onDidChangeState: changeEmitter.event,
    state: () => current,
    notifyRepoChanged: () => {
      lastLineKey = undefined;
      refresh();
    },
    notifyConnectionState: (state) => {
      if (state.kind !== 'connected') repoIdByFolder.clear();
      refresh();
    },
    dispose: () => {
      cancelPending();
      changeEmitter.dispose();
      for (const s of subscriptions) s.dispose();
    },
  };
}
