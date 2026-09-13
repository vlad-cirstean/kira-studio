/**
 * G13 D9 — VS Code's own Comments API, over the sha-addressed review documents D8 opens. This is
 * the "add" gesture's whole home: the webview never adds a comment (D10), and the gutter "+" is
 * what F8 calls "the platform's own answer" to a feature whose entire output is prose to hand an
 * AI (F8: a hand-rolled palette command + `showInputBox` is single-line only and renders nothing
 * at the lines it annotates).
 *
 * `reviewAnchorFor` and the fourth virtual-key field it reads are G14's own seam (D20) — a G14
 * that re-derives "which document, which repo/branch/path, at which revision" has gone wrong.
 */
import { basename } from 'node:path';
import type { ReviewComment } from '@kira/git-ipc';
import * as vscode from 'vscode';
import type { ConnectionManager } from './connection.ts';
import { SCHEME } from './ports/editorIntegration.ts';
import { decodeKey, encodeKey, parseVirtualKey, virtualKey } from './virtualKey.ts';

const CONTROLLER_ID = 'kiraVersion.reviewComments';
const CONTROLLER_LABEL = 'Kira review comments';

/** Everything `review.comment.*` needs about one document, resolved statelessly from its own URI
 *  (D8a/D9/D20) — no registry, no `Map`, survives a window reload. */
export interface ReviewAnchor {
  readonly repoId: string;
  readonly branch: string;
  readonly path: string;
  readonly at: string;
}

/** Is `uri` the branch-tip side of a review diff, and of which `(repoId, branch, path)` at which
 *  revision? Pure and stateless (D9/D20) — the answer lives entirely in the URI's own fourth
 *  virtual-key field (D8a), which only the branch-tip side of `editor.openRangeDiff` ever sets. */
export function reviewAnchorFor(uri: vscode.Uri): ReviewAnchor | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const [first] = uri.path.split('/').filter((segment) => segment.length > 0);
  if (first === undefined) return undefined;
  const parsed = parseVirtualKey(decodeKey(first));
  if (!parsed || parsed.reviewBranch === undefined) return undefined;
  return { repoId: parsed.repoId, branch: parsed.reviewBranch, path: parsed.path, at: parsed.rev };
}

/** The same URI shape `ports/editorIntegration.ts`'s own `toUri` mints for a `{kind: 'virtual'}`
 *  ref — reconstructed here from plain data so `proxyHandlers.ts` (which never imports `vscode`,
 *  by design) can ask for a re-render after opening a diff without holding a `vscode.Uri` itself. */
function reviewDocumentUri(
  repoId: string,
  branchTip: string,
  path: string,
  branch: string,
): vscode.Uri {
  const key = virtualKey(repoId, branchTip, path, branch);
  return vscode.Uri.parse(`${SCHEME}:/${encodeKey(key)}/${encodeURIComponent(basename(path))}`);
}

/** Our own `Comment` objects carry two extra fields no typed API field expresses — `id` for
 *  `review.comment.remove`, `parent` (the owning thread) so a comment-scoped command (`comments/
 *  comment/title`, whose argument is the `Comment` object alone) can still find its own URI. */
interface KiraReviewComment extends vscode.Comment {
  readonly id: number;
  readonly parent: vscode.CommentThread;
}

function anchorLabel(comment: ReviewComment, branch: string): string | undefined {
  const sha8 = comment.anchorSha.slice(0, 8);
  switch (comment.anchor) {
    case 'removed':
      return `lines no longer exist on ${branch} — shown as of ${sha8}`;
    case 'stale':
      return `lines as of ${sha8} — ${branch}'s history was rewritten since`;
    case 'exact':
    case 'projected':
      return undefined;
  }
}

export interface ReviewCommentController extends vscode.Disposable {
  /** Renders (or re-renders) one document's threads from a fresh `review.comment.list` — the
   *  plain-data entry point `proxyHandlers.ts` calls right after `editor.openRangeDiff` opens the
   *  branch-tip side of a diff (D9's "when it renders", case (a)). */
  renderThreadsForKey(repoId: string, branchTip: string, path: string, branch: string): void;
  /** Re-renders every currently-tracked document belonging to `(repoId, branch)` — the extension's
   *  own answer to a webview-side `review.comment.*` mutation (case (c)): the webview's own
   *  mutation already travels through `proxyHandlers.ts`, so no new event is needed, only this
   *  callback after the forward succeeds. */
  notifyCommentsMutated(repoId: string, branch: string): void;
  /** `comments/commentThread/context`'s own handler (D9's "submitting"). */
  submit(reply: vscode.CommentReply): Promise<void>;
  /** `comments/comment/title`'s own handler (D9's "deleting"). */
  deleteComment(comment: vscode.Comment): Promise<void>;
  /** `kiraVersion.addReviewComment`'s own handler (D19): an expanded, empty thread at the active
   *  editor's selection, so the user types into VS Code's own editor — or an explanation when the
   *  active editor is not a review document. */
  addAtSelection(): Promise<void>;
}

/** `onEditorMutated` is D19's `refreshReviewComments` route: called after THIS controller's own
 *  `submit`/`deleteComment` succeeds, so the extension can push that event to the Comments pane —
 *  a webview-side mutation needs no such push (it already knows; `notifyCommentsMutated` above is
 *  the extension's own answer to that direction). */
export function createReviewCommentController(
  connection: ConnectionManager,
  onEditorMutated: () => void,
): ReviewCommentController {
  const controller = vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_LABEL);
  controller.commentingRangeProvider = {
    // D9: the document's whole line span, iff reviewAnchorFor resolves — the "+" can then never
    // appear on the base side of a diff, a working-tree file, or any other document.
    provideCommentingRanges(document) {
      if (!reviewAnchorFor(document.uri)) return [];
      return [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)];
    },
  };

  // D9's own thread bookkeeping: one set of threads per document URI, keyed by its string form.
  // Re-rendering disposes the previous set first, so a URI can never accumulate two generations.
  const threadsByUri = new Map<string, vscode.CommentThread[]>();

  function disposeTracked(key: string): void {
    const previous = threadsByUri.get(key);
    if (!previous) return;
    for (const thread of previous) thread.dispose();
    threadsByUri.delete(key);
  }

  function buildThread(
    uri: vscode.Uri,
    branch: string,
    comment: ReviewComment,
  ): vscode.CommentThread {
    const line0 = Math.max(comment.range.start - 1, 0);
    const line1 = Math.max(comment.range.end - 1, 0);
    const thread = controller.createCommentThread(uri, new vscode.Range(line0, 0, line1, 0), []);
    thread.canReply = false; // D5/D9: flat, never a real reply — SPEC's own "no threading in v1.3"
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    thread.contextValue = 'kiraVersionReviewThread';
    const label = anchorLabel(comment, branch);
    if (label !== undefined) thread.label = label;
    const item: KiraReviewComment = {
      id: comment.id,
      parent: thread,
      body: comment.body,
      mode: vscode.CommentMode.Preview,
      author: { name: 'Review comment' },
      contextValue: 'kiraVersionReviewComment',
    };
    thread.comments = [item];
    return thread;
  }

  async function renderThreads(uri: vscode.Uri): Promise<void> {
    const anchor = reviewAnchorFor(uri);
    disposeTracked(uri.toString());
    if (!anchor) return;
    let comments: readonly ReviewComment[];
    try {
      const result = await connection.request('review.comment.list', {
        repoId: anchor.repoId,
        branch: anchor.branch,
        at: anchor.at,
      });
      comments = result.comments;
    } catch {
      return; // a transient failure leaves the document with no rendered threads, not an error UI
    }
    threadsByUri.set(
      uri.toString(),
      comments.map((c) => buildThread(uri, anchor.branch, c)),
    );
  }

  function renderThreadsForKey(
    repoId: string,
    branchTip: string,
    path: string,
    branch: string,
  ): void {
    void renderThreads(reviewDocumentUri(repoId, branchTip, path, branch));
  }

  function notifyCommentsMutated(repoId: string, branch: string): void {
    for (const key of [...threadsByUri.keys()]) {
      const uri = vscode.Uri.parse(key);
      const anchor = reviewAnchorFor(uri);
      if (anchor && anchor.repoId === repoId && anchor.branch === branch) void renderThreads(uri);
    }
  }

  async function submit(reply: vscode.CommentReply): Promise<void> {
    const { thread } = reply;
    const uri = thread.uri;
    const anchor = reviewAnchorFor(uri);
    const range = thread.range;
    const body = reply.text.trim();
    if (!anchor || !range || body === '') {
      thread.dispose();
      return;
    }
    try {
      await connection.request('review.comment.add', {
        repoId: anchor.repoId,
        branch: anchor.branch,
        path: anchor.path,
        at: anchor.at,
        range: { start: range.start.line + 1, end: range.end.line + 1 },
        body: reply.text,
      });
    } catch (err) {
      thread.dispose();
      await vscode.window.showErrorMessage(
        `Kira Version: couldn't add the comment — ${String(err)}`,
      );
      return;
    }
    thread.dispose(); // the composing thread — renderThreads recreates the real, rendered one
    await renderThreads(uri);
    onEditorMutated();
  }

  async function deleteComment(comment: vscode.Comment): Promise<void> {
    const item = comment as Partial<KiraReviewComment>;
    if (item.parent === undefined || item.id === undefined) return;
    const uri = item.parent.uri;
    const anchor = reviewAnchorFor(uri);
    if (!anchor) return;
    try {
      await connection.request('review.comment.remove', {
        repoId: anchor.repoId,
        branch: anchor.branch,
        id: item.id,
      });
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Kira Version: couldn't delete the comment — ${String(err)}`,
      );
      return;
    }
    await renderThreads(uri);
    onEditorMutated();
  }

  async function addAtSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const anchor = editor ? reviewAnchorFor(editor.document.uri) : undefined;
    if (!editor || !anchor) {
      await vscode.window.showInformationMessage(
        'Open a file from the Kira review sidebar first, then select the lines to comment on.',
      );
      return;
    }
    const thread = controller.createCommentThread(editor.document.uri, editor.selection, []);
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.contextValue = 'kiraVersionReviewThread';
  }

  // D9's "when it renders" (d): a review document that becomes visible without ever having been
  // rendered — the tab VS Code restored after a reload, chief among them.
  const visibility = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    for (const editor of editors) {
      const uri = editor.document.uri;
      if (uri.scheme !== SCHEME || threadsByUri.has(uri.toString())) continue;
      void renderThreads(uri);
    }
  });

  return {
    renderThreadsForKey,
    notifyCommentsMutated,
    submit,
    deleteComment,
    addAtSelection,
    dispose() {
      visibility.dispose();
      for (const key of [...threadsByUri.keys()]) disposeTracked(key);
      controller.dispose();
    },
  };
}
