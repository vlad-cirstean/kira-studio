/**
 * The `WebviewViewProvider` for `kiraVersion.review` (P7 W8, §2.1/§6.8). `panelView.ts`'s
 * sibling, deliberately *not* a refactor of it into a shared base class — the two differ in what
 * HTML is rendered and how a review target is pushed in, and a base class hiding that behind a
 * template method would be harder to read than two short files.
 *
 * G1 migration note: see panelView.ts's own note — `service: RepoService` (and with it
 * `setUiVisible`/`endReview`/the `repo.changed` forward) is gone; `handlers` is supplied by the
 * constructor. G3 restores the review-session lifecycle once a real connection exists to end.
 */
import type { RpcServer, ServerHandlers, SettingsSnapshot } from '@kira/git-ipc';
import { createRpcServer } from '@kira/git-ipc';
import * as vscode from 'vscode';
import type { ReviewTarget } from './html.ts';
import { renderHtml } from './html.ts';
import { createWebviewChannel } from './transport.ts';

const REVIEW_FOCUS_COMMAND = 'kiraVersion.review.focus';

export interface KiraReviewViewProviderDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: ServerHandlers;
}

export class KiraReviewViewProvider implements vscode.WebviewViewProvider {
  readonly #deps: KiraReviewViewProviderDeps;
  #server: RpcServer | undefined;
  /** The target a cold `resolveWebviewView` should seed into the bootstrap island — set by
   *  `reviewBranch` before the view is revealed, read (and left in place, so a subsequent hide/
   *  reveal without an intervening `reviewBranch` call still repaints the same review) here. */
  #pendingTarget: ReviewTarget | null = null;

  constructor(deps: KiraReviewViewProviderDeps) {
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
      view: 'review',
      target: this.#pendingTarget,
    });

    const channel = createWebviewChannel(webviewView.webview);
    const server = createRpcServer(channel, handlers);
    this.#server = server;

    webviewView.onDidDispose(() => {
      server.dispose();
      if (this.#server === server) this.#server = undefined;
    });
  }

  /**
   * Reveals the review view, optionally targeting `branch` in `repoId`. Both undefined is the
   * palette command's own case (§6.8/D40): reveal with no target at all and let the view ask —
   * for a repo first if none is open yet (the same repo-open flow the panel itself falls back
   * to, reused rather than a second host-side picker), then for a branch, in the same ask-state
   * vocabulary §6.8 already defines for a missing base. `review.open`'s caller (the panel
   * webview) always supplies both — it already knows its own active repo.
   *
   * Reveal, then either seed a cold resolve or push `review.target` to an already-live one:
   * `resolveWebviewView` only runs on reveal-from-hidden, and reviewing a second branch must
   * replace an already-open view's contents rather than being silently ignored.
   */
  reviewBranch(repoId: string | undefined, branch: string | undefined): void {
    this.#pendingTarget = repoId !== undefined && branch !== undefined ? { repoId, branch } : null;
    void vscode.commands.executeCommand(REVIEW_FOCUS_COMMAND);
    if (this.#pendingTarget) {
      this.#server?.emit('review.target', {
        repoId: this.#pendingTarget.repoId,
        branch: this.#pendingTarget.branch,
      });
    }
  }

  /** Pushed by `extension.ts` after `onDidChangeConfiguration` re-coerces the settings snapshot
   *  — a no-op when no webview is currently resolved (view collapsed or never opened). */
  notifySettingsChanged(settings: SettingsSnapshot): void {
    this.#server?.emit('settings.changed', { settings });
  }
}
