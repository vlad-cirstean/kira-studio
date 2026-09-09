/**
 * The `WebviewViewProvider` for `kiraVersion.graph` (P3 W10, §2.1). `retainContextWhenHidden`
 * is deliberately left off — W9's rehydration exists precisely so we do not pay for it — so
 * `resolveWebviewView` runs again on every hide/reveal and must rebuild the channel and the
 * `RpcServer` from scratch each time.
 *
 * G1 migration note: upstream built its own `ServerHandlers` per-view via
 * `createRepoHandlers({service, ...})` against an in-process `RepoService`. That type doesn't
 * exist in this repo (SPEC §5: replaced by the Go server + this extension's socket connection) —
 * `handlers` is now supplied by the constructor instead (`proxyHandlers.ts`'s
 * `createProxyHandlers`, G3 D18). Registered by `activate()` since G3 (D17) — the graph renders
 * end to end from there on; `repo.changed` is forwarded from the connection into this view's own
 * `RpcServer.emit` via `notifyRepoChanged` (D18, replacing G1 §5.5's `service.onChanged` note).
 */
import type {
  EventPayload,
  RpcServer,
  ServerHandlers,
  SettingsSnapshot,
  UiActionKind,
} from '@kira/git-ipc';
import { createRpcServer } from '@kira/git-ipc';
import * as vscode from 'vscode';
import { renderHtml } from './html.ts';
import { createWebviewChannel } from './transport.ts';

const GRAPH_FOCUS_COMMAND = 'kiraVersion.graph.focus';

export interface KiraGraphViewProviderDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: ServerHandlers;
}

export class KiraGraphViewProvider implements vscode.WebviewViewProvider {
  readonly #deps: KiraGraphViewProviderDeps;
  #server: RpcServer | undefined;
  /** G10 D19: a palette command that fired while this view was cold — consumed (and cleared) by
   *  the next `resolveWebviewView`'s bootstrap island, the same one-shot arm `reviewView.ts`'s own
   *  `#pendingTarget` established, except cleared once used rather than left sticky: an action
   *  (continue an operation, revert a commit) must not replay on a later hide/reveal the way a
   *  review's current target correctly does. G14 D10: grew an optional `target`, mirroring
   *  `ui.action`'s own shape — this is the extension's own cold-boot document, not the wire. */
  #pendingUiAction: { action: UiActionKind; target?: { repoId: string; sha: string } } | null =
    null;

  constructor(deps: KiraGraphViewProviderDeps) {
    this.#deps = deps;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const { extensionUri, handlers } = this.#deps;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui')],
    };
    webviewView.webview.html = renderHtml({
      webview: webviewView.webview,
      extensionUri,
      view: 'graph',
      pendingUiAction: this.#pendingUiAction,
    });
    this.#pendingUiAction = null;

    const channel = createWebviewChannel(webviewView.webview);
    const server = createRpcServer(channel, handlers);
    this.#server = server;

    webviewView.onDidDispose(() => {
      server.dispose();
      if (this.#server === server) this.#server = undefined;
    });
  }

  /**
   * G10 D19: routes one palette command's action into the graph webview — `reviewView.ts`'s own
   * proven two-arm pattern (F11: the only way the extension host can reach a live webview is a
   * contract event; a `postMessage` into a document that has not booted yet is dropped).
   *
   * Focuses the view either way (so the user sees the effect land), then either emits `ui.action`
   * to an already-live server, or — the view is currently hidden, so `resolveWebviewView` has not
   * run yet — stashes it as `#pendingUiAction` for the bootstrap island the next cold resolve
   * seeds. `target` is G14 D10's addition, forwarded verbatim into both arms — present only for
   * actions that name a commit ('revealCommit').
   */
  runUiAction(action: UiActionKind, target?: { repoId: string; sha: string }): void {
    this.#pendingUiAction = { action, target };
    void vscode.commands.executeCommand(GRAPH_FOCUS_COMMAND);
    if (this.#server) {
      this.#server.emit('ui.action', { action, target });
      this.#pendingUiAction = null;
    }
  }

  /** Pushed by `extension.ts` after `onDidChangeConfiguration` re-coerces the settings snapshot
   *  — a no-op when no webview is currently resolved (panel collapsed or never opened). */
  notifySettingsChanged(settings: SettingsSnapshot): void {
    this.#server?.emit('settings.changed', { settings });
  }

  /** Forwarded from `ConnectionManager.on('repo.changed', ...)` by `extension.ts` (D18, replacing
   *  G1 §5.5's `service.onChanged` note) — a no-op when no webview is currently resolved. */
  notifyRepoChanged(payload: EventPayload<'repo.changed'>): void {
    this.#server?.emit('repo.changed', payload);
  }

  /** G7 D20/§4.2: forwarded from `ConnectionManager.on('remote.progress', ...)` — the GRAPH
   *  provider only, never the review one (upstream's own W16): the review sidebar renders no
   *  operation UI at all, so fanning progress into it would be built, encoded and delivered for
   *  nothing. A no-op when no webview is currently resolved. */
  notifyRemoteProgress(payload: EventPayload<'remote.progress'>): void {
    this.#server?.emit('remote.progress', payload);
  }

  /** G25 D13: forwarded from `ConnectionManager.on('worktree.progress', ...)` — the same shape
   *  `notifyRemoteProgress` above already uses, the graph provider only (the review sidebar has no
   *  worktree UI either). A no-op when no webview is currently resolved. */
  notifyWorktreeProgress(payload: EventPayload<'worktree.progress'>): void {
    this.#server?.emit('worktree.progress', payload);
  }
}
