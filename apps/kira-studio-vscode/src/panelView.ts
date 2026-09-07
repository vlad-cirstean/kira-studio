/**
 * The `WebviewViewProvider` for `kiraVersion.graph` (P3 W10, §2.1). `retainContextWhenHidden`
 * is deliberately left off — W9's rehydration exists precisely so we do not pay for it — so
 * `resolveWebviewView` runs again on every hide/reveal and must rebuild the channel and the
 * `RpcServer` from scratch each time.
 *
 * G1 migration note: upstream built its own `ServerHandlers` per-view via
 * `createRepoHandlers({service, ...})` against an in-process `RepoService`. That type doesn't
 * exist in this repo (SPEC §5: replaced by the Go server + this extension's socket connection) —
 * `handlers` is now supplied by the constructor instead, and the `repo.changed`/`remote.progress`
 * event forwards this view used to set up itself are G3's job, once a connection actually produces
 * those events (docs/v1.3/plans/G1-....md §5.5). This provider is migrated but not registered by
 * `activate()` (D13) until then.
 */
import type { Disposable } from '@kira/git-core';
import type { RpcServer, ServerHandlers, SettingsSnapshot } from '@kira/git-ipc';
import { createRpcServer } from '@kira/git-ipc';
import * as vscode from 'vscode';
import { renderHtml } from './html.ts';
import { createWebviewChannel } from './transport.ts';

export interface KiraGraphViewProviderDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: ServerHandlers;
}

export class KiraGraphViewProvider implements vscode.WebviewViewProvider {
  readonly #deps: KiraGraphViewProviderDeps;
  #server: RpcServer | undefined;
  #changeSubscription: Disposable | undefined;
  #progressSubscription: Disposable | undefined;

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
    });

    const channel = createWebviewChannel(webviewView.webview);
    const server = createRpcServer(channel, handlers);
    this.#server = server;

    webviewView.onDidDispose(() => {
      this.#changeSubscription?.dispose();
      this.#changeSubscription = undefined;
      this.#progressSubscription?.dispose();
      this.#progressSubscription = undefined;
      server.dispose();
      if (this.#server === server) this.#server = undefined;
    });
  }

  /** Pushed by `extension.ts` after `onDidChangeConfiguration` re-coerces the settings snapshot
   *  — a no-op when no webview is currently resolved (panel collapsed or never opened). */
  notifySettingsChanged(settings: SettingsSnapshot): void {
    this.#server?.emit('settings.changed', { settings });
  }
}
