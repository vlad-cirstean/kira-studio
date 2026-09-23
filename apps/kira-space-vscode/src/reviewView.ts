/**
 * The `WebviewViewProvider` for `kiraSpace.review` (P7 W8, §2.1/§6.8). `panelView.ts`'s
 * sibling — both extend `webviewProviderBase.ts`'s `WebviewProviderBase` (P107 I2-24) for the
 * shared options/html/channel/server/dispose frame and `notify*` forwarders; what HTML is
 * rendered and how a review target is pushed in stay this class's own (`bootstrap`,
 * `reviewBranch`).
 *
 * G1 migration note: see panelView.ts's own note — `service: RepoService` (and with it
 * `setUiVisible`/`endReview`/the `repo.changed` forward) is gone; `handlers` is supplied by the
 * constructor. G6 forwards `repo.changed` (`WebviewProviderBase.notifyRepoChanged`) but does NOT
 * restore `endReview`'s own lifecycle: there is no `review.end` on the wire (D6) — the server
 * invalidates the ranged walk on `refsChanged` instead (D5), which is what makes
 * `notifyRepoChanged` load-bearing here at all (F11): `ReviewSessionState`'s background re-resolve
 * and its "the comparison has changed" banner are the sole consumer of this event in the review
 * webview.
 */
import type { UiActionKind } from '@kira/git-ipc';
import * as vscode from 'vscode';
import { toWireConnectionState } from './connection.ts';
import type { ReviewTarget } from './html.ts';
import { renderHtml } from './html.ts';
import { WebviewProviderBase, type WebviewProviderBaseDeps } from './webviewProviderBase.ts';

const REVIEW_FOCUS_COMMAND = 'kiraSpace.review.focus';

export interface KiraReviewViewProviderDeps extends WebviewProviderBaseDeps {
  // G19 D11b: not read by this class directly (review.session.save/.load's own handler lives in
  // proxyHandlers.ts, already closed over context.workspaceState there) — threaded here only so
  // this provider's own deps stay a complete, self-contained bundle, the same shape its
  // constructor already takes everything else through. A small, mechanical addition, not new
  // state: extension.ts's own activate() already holds this.
  readonly context: vscode.ExtensionContext;
}

export class KiraReviewViewProvider extends WebviewProviderBase {
  /** The target a cold `resolveWebviewView` should seed into the bootstrap island — set by
   *  `reviewBranch` before the view is revealed, read (and left in place, so a subsequent hide/
   *  reveal without an intervening `reviewBranch` call still repaints the same review) here. */
  #pendingTarget: ReviewTarget | null = null;

  // Narrows the base constructor's `WebviewProviderBaseDeps` to `KiraReviewViewProviderDeps` so
  // `context` stays required at every call site — `context` itself is never read here (see the
  // interface's own doc comment).
  constructor(deps: KiraReviewViewProviderDeps) {
    super(deps);
  }

  protected bootstrap(webviewView: vscode.WebviewView): string {
    const { extensionUri, connection } = this.deps;
    return renderHtml({
      webview: webviewView.webview,
      extensionUri,
      view: 'review',
      target: this.#pendingTarget,
      connectionState: toWireConnectionState(connection.state),
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
      this.server?.emit('review.target', {
        repoId: this.#pendingTarget.repoId,
        branch: this.#pendingTarget.branch,
      });
    }
  }

  /**
   * G11 D17: routes one palette command's action into the review webview — `panelView.ts`'s own
   * proven two-arm pattern, ported: reveal the view either way, then emit `ui.action` to an
   * already-live server or fall back to `#pendingTarget`-style handling... except the review view
   * has no `#pendingAction` slot to stash into on a cold reveal (unlike the graph panel), since
   * this phase's only action needs a file already open in the Files pane — a webview that has not
   * even booted yet cannot have one, so a cold reveal simply has nothing to toggle and the emit is
   * silently dropped in that case, exactly as it would be with no live server.
   */
  runUiAction(action: UiActionKind): void {
    void vscode.commands.executeCommand(REVIEW_FOCUS_COMMAND);
    this.server?.emit('ui.action', { action });
  }
}
