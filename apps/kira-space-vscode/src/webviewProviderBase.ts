/**
 * P107 I2-24 (T2-24's unlanded half — commit `e9fca4aa` landed `virtualUri.ts` only):
 * `panelView.ts`'s `KiraGraphViewProvider` and `reviewView.ts`'s `KiraReviewViewProvider` shared
 * `resolveWebviewView`'s whole options/html/channel/server/dispose frame and five `notify*`
 * forwarders verbatim — the one per-provider difference in `resolveWebviewView` is what HTML to
 * render (`bootstrap()`, abstract here). Each subclass keeps its own deps, its `bootstrap()`
 * island, and its own extras (`runUiAction`, `reviewBranch`, worktree/remote progress) — a
 * template method, not a merge of the two into one class, per the doc's own shape.
 */
import type { EventPayload, RpcServer, ServerHandlers, SettingsSnapshot } from '@kira/git-ipc';
import { createRpcServer } from '@kira/git-ipc';
import * as vscode from 'vscode';
import type { ConnectionManager } from './connection.ts';
import { createWebviewChannel } from './transport.ts';

export interface WebviewProviderBaseDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: ServerHandlers;
  /** G-UX (item 13): read fresh, synchronously, at the top of every `resolveWebviewView` — the
   *  cold-boot seed for the connection banner. Not subscribed to here: `extension.ts`'s own
   *  `ConnectionManager.onStateChange` handler is what pushes live changes via
   *  `notifyConnectionState` below; this deps field only needs a snapshot. */
  readonly connection: ConnectionManager;
}

export abstract class WebviewProviderBase implements vscode.WebviewViewProvider {
  protected readonly deps: WebviewProviderBaseDeps;
  protected server: RpcServer | undefined;

  constructor(deps: WebviewProviderBaseDeps) {
    this.deps = deps;
  }

  /** Builds this cold resolve's document — the one place `resolveWebviewView` differs between
   *  providers (view kind, bootstrap-island payload). Runs before the channel/server are created,
   *  so it is also each subclass's own place to consume (and clear) a one-shot cold-boot field
   *  (`KiraGraphViewProvider`'s `#pendingUiAction`) or leave a sticky one in place
   *  (`KiraReviewViewProvider`'s `#pendingTarget`). */
  protected abstract bootstrap(webviewView: vscode.WebviewView): string;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const { extensionUri, handlers } = this.deps;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui')],
    };
    webviewView.webview.html = this.bootstrap(webviewView);

    const channel = createWebviewChannel(webviewView.webview);
    const server = createRpcServer(channel, handlers);
    this.server = server;

    webviewView.onDidDispose(() => {
      server.dispose();
      if (this.server === server) this.server = undefined;
    });
  }

  /** Pushed by `extension.ts` after `onDidChangeConfiguration` re-coerces the settings snapshot
   *  — a no-op when no webview is currently resolved (panel/view collapsed or never opened). */
  notifySettingsChanged(settings: SettingsSnapshot): void {
    this.server?.emit('settings.changed', { settings });
  }

  /** Forwarded from `ConnectionManager.on('repo.changed', ...)` by `extension.ts` (D18/G6, D15)
   *  — a no-op when no webview is currently resolved. */
  notifyRepoChanged(payload: EventPayload<'repo.changed'>): void {
    this.server?.emit('repo.changed', payload);
  }

  /** G-UX (item 13): forwarded from `ConnectionManager.onStateChange` by `extension.ts`, already
   *  mapped through `toWireConnectionState` — a no-op when no webview is currently resolved. */
  notifyConnectionState(state: EventPayload<'connection.changed'>['state']): void {
    this.server?.emit('connection.changed', { state });
  }

  /** G31 round-2 functional-correctness review, finding #4: `gitrpc/handlers.go`'s `Router`
   *  subscribes every connection to `repoSettingsChanged` and emits `repoSettings.changed`
   *  specifically so every currently-connected client sees a `repoSettings.set` written by ANY of
   *  them (G18 D4/D7's cross-connection fan-out) — forwarded to both webviews since both mount
   *  the same `App.vue`, with its own `RepoSettingsState`, over two independent connections. A
   *  no-op when no webview is currently resolved. */
  notifyRepoSettingsChanged(payload: EventPayload<'repoSettings.changed'>): void {
    this.server?.emit('repoSettings.changed', payload);
  }

  /** G31 round-2 functional-correctness review, finding #3: `gitsession/stack.go`'s `RunRestack`
   *  emits `stack.progress` per branch, and `StackState` subscribes — forwarded to both webviews
   *  since both `App.vue` instantiate their own `StackState` unconditionally, regardless of
   *  `view`. A no-op when no webview is currently resolved. */
  notifyStackProgress(payload: EventPayload<'stack.progress'>): void {
    this.server?.emit('stack.progress', payload);
  }
}
