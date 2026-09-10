/**
 * The `WebviewViewProvider` for `kiraVersion.review` (P7 W8, §2.1/§6.8). `panelView.ts`'s
 * sibling, deliberately *not* a refactor of it into a shared base class — the two differ in what
 * HTML is rendered and how a review target is pushed in, and a base class hiding that behind a
 * template method would be harder to read than two short files.
 *
 * G1 migration note: see panelView.ts's own note — `service: RepoService` (and with it
 * `setUiVisible`/`endReview`/the `repo.changed` forward) is gone; `handlers` is supplied by the
 * constructor. G6 forwards `repo.changed` (`notifyRepoChanged` below) but does NOT restore
 * `endReview`'s own lifecycle: there is no `review.end` on the wire (D6) — the server invalidates
 * the ranged walk on `refsChanged` instead (D5), which is what makes `notifyRepoChanged` load-
 * bearing here at all (F11): `ReviewSessionState`'s background re-resolve and its "the comparison
 * has changed" banner are the sole consumer of this event in the review webview.
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
import type { ReviewTarget } from './html.ts';
import { renderHtml } from './html.ts';
import { createWebviewChannel } from './transport.ts';

const REVIEW_FOCUS_COMMAND = 'kiraVersion.review.focus';

// G14 D8 row 2 / D10: the review row's own "Open in graph" hover action reaches
// `kiraVersion.openCommitInGraph` through a `command:` URI — VS Code's own webview escape hatch
// for invoking an already-contributed command, restricted (the array form, not `true`) to exactly
// this one command id. Not a bridge request: a command URI never touches the RPC contract, which
// is what keeps D8's own "no RPC changes" fence true while still making the button real.
const OPEN_COMMIT_IN_GRAPH_COMMAND = 'kiraVersion.openCommitInGraph';

export interface KiraReviewViewProviderDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: ServerHandlers;
  // G19 D11b: not read by this class directly (review.session.save/.load's own handler lives in
  // proxyHandlers.ts, already closed over context.workspaceState there) — threaded here only so
  // this provider's own deps stay a complete, self-contained bundle, the same shape its
  // constructor already takes everything else through. A small, mechanical addition, not new
  // state: extension.ts's own activate() already holds this.
  readonly context: vscode.ExtensionContext;
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
      enableCommandUris: [OPEN_COMMIT_IN_GRAPH_COMMAND],
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
    this.#server?.emit('ui.action', { action });
  }

  /** Forwarded from `ConnectionManager.on('repo.changed', ...)` by `extension.ts` (G6/D15,
   *  resolving F11) — a three-line copy of `panelView.ts`'s own `notifyRepoChanged`. Without this,
   *  `ReviewSessionState`'s background re-resolve and its "the comparison has changed" banner can
   *  never fire: `repo.changed` is their sole trigger. A no-op when no webview is currently
   *  resolved. */
  notifyRepoChanged(payload: EventPayload<'repo.changed'>): void {
    this.#server?.emit('repo.changed', payload);
  }

  /** G31 round-2 functional-correctness review, finding #4: `repoSettings.changed` (G18 D4/D7's
   *  cross-connection settings fan-out) was never forwarded to EITHER webview — see
   *  `panelView.ts`'s own copy of this method for the full explanation. Forwarded here too (not
   *  just the graph panel) since both webviews mount the same `App.vue`, with its own
   *  `RepoSettingsState`, over two entirely independent connections. */
  notifyRepoSettingsChanged(payload: EventPayload<'repoSettings.changed'>): void {
    this.#server?.emit('repoSettings.changed', payload);
  }

  /** G31 round-2 functional-correctness review, finding #3: `stack.progress` was never forwarded
   *  to either webview — see `panelView.ts`'s own copy of this method. Forwarded here too since
   *  both webviews' `App.vue` instantiate their own `StackState` unconditionally, regardless of
   *  `view`. */
  notifyStackProgress(payload: EventPayload<'stack.progress'>): void {
    this.#server?.emit('stack.progress', payload);
  }
}
