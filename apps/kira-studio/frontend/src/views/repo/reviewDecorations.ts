/**
 * C11 §7.3/§7.4 (S9) — the review diff's own Monaco layer: gutter glyphs for hunk/comment state,
 * inline comment threads, and the "mark reviewed"/"add a comment" gestures. No precedent
 * elsewhere in this repo (§7's own doc comment) — everything here was designed against the
 * pinned `monaco-editor@0.56.0` source, not from memory (§7.3's two gotchas below).
 *
 * §7.2's whole reason this module computes no line mapping of its own: a review diff's right-hand
 * document is always `<branchTip>:<path>`, and `review.comment.list`/`review.fileDiff` already
 * return `range` in exactly those coordinates (anchored server-side, `gitsession/comments.go`) —
 * this module places a decoration at `comment.range.start` and renders `anchor` as a label, the
 * same two lines of logic `reviewComments.ts:63-74` already uses.
 *
 * Two decoration lanes keep a hunk glyph and a comment glyph from colliding on the same line
 * (§7.3): hunk state renders in `GlyphMarginLane.Right`, comment/add-comment glyphs in
 * `GlyphMarginLane.Left`.
 */
import {
  clampRanges,
  coverage,
  hunkChangeBlock,
  normalizeRanges,
  selectionToRange,
} from '@kira/git-core';
import type {
  DiffHunk,
  FileDiffBody,
  LineRange,
  ResultOf,
  ReviewComment,
  Transport,
} from '@kira/git-ipc';
import { type App, createApp, nextTick } from 'vue';
import { onReviewRepaint } from '../../repo/git/transport';
import type { MonacoModule } from './monaco';
import ReviewThread from './ReviewThread.vue';

type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;
type ModifiedEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type DeltaDecoration = import('monaco-editor').editor.IModelDeltaDecoration;
type ViewZone = import('monaco-editor').editor.IViewZone;

// §3.1: pinned monaco-editor@0.56.0's own `view.js` appends `.view-zones` BEFORE `.view-lines` in
// `.lines-content`, and `viewLines.js` sizes `.view-lines` to the full scroll width/height with no
// z-index of its own (`position: absolute; z-index: auto`) — a later positioned sibling with
// `z-index: auto` loses every hit test to it. `10` is VS Code's own value for the view-zone
// widgets it mounts the same way; without it, a zone paints but nothing in it can ever be clicked.
const VIEW_ZONE_Z_INDEX = '10';

export interface ReviewDecorationsDeps {
  readonly transport: Transport;
  readonly gitRepoId: string;
  readonly path: string;
  /** `repoDiffTabStateSchema.left` — the tab's own leftRev (merge base in `range` mode, the
   *  file's own `reviewedAtSha` in `sinceReview` mode), compared against a fresh
   *  `review.fileDiff`'s own `reviewedAtSha` exactly as `reviewMarking.ts:249-276`'s `resolve`
   *  does, so a tab opened in one mode never silently repaints as the other. */
  readonly leftRev: string;
  readonly review: {
    readonly branch: string;
    readonly branchTip: string;
    readonly leftLabel: string;
  };
}

export interface ReviewDecorationsHandle {
  dispose(): void;
}

// reviewMarking.ts:221-241's own memoised resolveBase, ported: review.fileDiff needs `base`, which
// nothing on the diff tab carries directly (only `leftRev`, §7.5) — re-resolving here, memoised by
// (repoId, branch), is the same trade the extension already made rather than threading `base`
// through the whole tab-open path for a value this module can cheaply ask for itself. Module-level
// (not per-handle): two review diff tabs for the same branch share one resolution.
//
// C12-7: only a SUCCESSFUL resolution stays cached. A failure (e.g. a transient index.lock
// conflict) used to cache `null` forever, with no expiry — every load() thereafter silently
// early-returned, permanently disabling the whole review layer for that branch until the app
// restarted. Evicting the entry on failure lets the next call (this editor's own retry, or
// another editor's load()) try fresh instead of replaying the same rejection from cache forever.
//
// C13-9: a REJECTION is now propagated (not swallowed into a `null` value) so load() can tell it
// apart from a resolved `base: null` — the legitimate, permanent "no base branch configured for
// this repository" answer. C12-7's collapse of both into the same cached `null` routed a
// permanent condition to the same "Couldn't load, click Retry" banner built for transient
// failures — Retry could never succeed there, since re-resolving just returns the same `null`.
const baseMemo = new Map<string, Promise<string | null>>();

function resolveBase(transport: Transport, repoId: string, branch: string): Promise<string | null> {
  const key = `${repoId}\0${branch}`;
  let cached = baseMemo.get(key);
  if (!cached) {
    cached = transport
      .request('review.resolveBase', { repoId, branch }, undefined)
      .then((r) => r.base)
      .catch((err) => {
        baseMemo.delete(key);
        console.error('reviewDecorations: review.resolveBase failed', err);
        throw err;
      });
    baseMemo.set(key, cached);
  }
  return cached;
}

function commentHoverMessage(comment: ReviewComment): { value: string } {
  const firstLine = comment.body.split('\n', 1)[0] ?? '';
  return { value: firstLine.length > 0 ? firstLine : '(empty comment)' };
}

/** Attaches the review layer to an already-mounted diff editor's modified pane. Call once per
 *  mount (`RepoDiffView.vue`, S11); `dispose()` on unmount, mirroring `registerDiffEditor`/
 *  `unmountEditor`'s own widget lifecycle (`editors.ts`) — never on a mere repaint. */
export function attachReviewDecorations(
  mod: MonacoModule,
  diffEditor: DiffEditor,
  deps: ReviewDecorationsDeps,
): ReviewDecorationsHandle {
  const modifiedEditor: ModifiedEditor = diffEditor.getModifiedEditor();
  // §7.3 gotcha 1: the registered option default and the .d.ts prose disagree — set explicitly
  // rather than depend on either being right in a future Monaco bump.
  modifiedEditor.updateOptions({ glyphMargin: true });

  let disposed = false;
  // C14-2: separate counters per resource -- loadDiff and loadComments used to share one loadSeq,
  // so a fast loadComments (single DB read) firing while a slower loadDiff (server-side git diff)
  // was still in flight bumped the shared counter and made the diff load discard its own result on
  // resolution, with nothing else left to re-fetch it. Each counter still guarantees its own "a
  // stale result never clobbers a fresher one" property; the two just can no longer invalidate each
  // other.
  let diffSeq = 0;
  let commentsSeq = 0;

  let hunks: readonly DiffHunk[] = [];
  let bodyKind: FileDiffBody['kind'] = 'text';
  let reviewedRanges: readonly LineRange[] = [];
  let lineCount = 0;
  let comments: readonly ReviewComment[] = [];

  // Line number -> the hunk block/reviewed state at that line, rebuilt every paint() — what the
  // click handler looks up instead of re-walking `hunks` on every gutter click.
  let hunkByLine = new Map<number, { block: LineRange; reviewed: boolean }>();
  let commentByLine = new Map<number, ReviewComment>();

  const reviewedLineCollection = modifiedEditor.createDecorationsCollection([]);
  const hunkCollection = modifiedEditor.createDecorationsCollection([]);
  const commentCollection = modifiedEditor.createDecorationsCollection([]);
  const addGlyphCollection = modifiedEditor.createDecorationsCollection([]);

  let hoverLine: number | null = null;
  let openThreadCommentId: number | null = null;
  let zoneId: string | null = null;
  let zoneApp: App | null = null;

  function closeZone(): void {
    if (zoneId === null) return;
    const id = zoneId;
    modifiedEditor.changeViewZones((accessor) => accessor.removeZone(id));
    zoneApp?.unmount();
    zoneApp = null;
    zoneId = null;
    openThreadCommentId = null;
  }

  function openZone(afterLine: number, mount: (container: HTMLElement) => App): void {
    closeZone();
    const domNode = document.createElement('div');
    domNode.style.zIndex = VIEW_ZONE_Z_INDEX;
    const zone: ViewZone = { afterLineNumber: afterLine, heightInPx: 120, domNode };
    modifiedEditor.changeViewZones((accessor) => {
      zoneId = accessor.addZone(zone);
    });
    zoneApp = mount(domNode);
    // §3.2: 120 predates the compose form's final shape — measure the mounted app's own root
    // (`.review-thread`, already `overflow: auto`) once it has rendered and re-lay the zone out,
    // so a long existing comment scrolls inside its own box instead of being clipped by a guess.
    const id = zoneId;
    if (id === null) return; // addZone's own callback ran synchronously just above; defensive only.
    void nextTick(() => {
      if (zoneId !== id || disposed) return;
      const measured = domNode.firstElementChild?.scrollHeight;
      if (measured && measured !== zone.heightInPx) {
        zone.heightInPx = measured;
        modifiedEditor.changeViewZones((accessor) => accessor.layoutZone(id));
      }
    });
  }

  // C12-7: resolveBase's own failure (a transient index.lock conflict, most likely) used to be
  // invisible — the diff still rendered, just with zero gutter glyphs/highlighting/comments and no
  // indication anything had gone wrong. A plain DOM view zone (no Vue mount needed, unlike
  // openZone/closeZone's own compose/thread box above) banners the real failure at the top of the
  // editor with a manual retry, independent of that zone's own lifecycle.
  let errorZoneId: string | null = null;

  function closeErrorZone(): void {
    if (errorZoneId === null) return;
    const id = errorZoneId;
    modifiedEditor.changeViewZones((accessor) => accessor.removeZone(id));
    errorZoneId = null;
  }

  // C13-9: one banner zone, two distinct uses — a genuine failure (network/server error, worth a
  // Retry that can plausibly succeed) and a legitimate, permanent condition (no base branch
  // configured for this repository, where Retry re-resolving the same answer would only mislead).
  function showBannerZone(message: string, retryable: boolean): void {
    closeErrorZone();
    const domNode = document.createElement('div');
    // §3.1: same paint-order defect as the compose zone above — the Retry button is otherwise
    // unreachable.
    domNode.style.zIndex = VIEW_ZONE_Z_INDEX;
    domNode.className = 'kira-review-load-error';
    const span = document.createElement('span');
    span.textContent = message;
    domNode.append(span);
    if (retryable) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'kira-review-load-error-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => void load());
      domNode.append(retry);
    }
    modifiedEditor.changeViewZones((accessor) => {
      errorZoneId = accessor.addZone({ afterLineNumber: 0, heightInPx: 28, domNode });
    });
  }

  function showLoadError(): void {
    showBannerZone("Couldn't load review data for this file.", true);
  }

  function showNoBaseConfigured(): void {
    showBannerZone('No base branch configured for this repository.', false);
  }

  function paintAddGlyph(): void {
    if (hoverLine === null || commentByLine.has(hoverLine)) {
      addGlyphCollection.set([]);
      return;
    }
    addGlyphCollection.set([
      {
        range: new mod.Range(hoverLine, 1, hoverLine, 1),
        options: {
          glyphMarginClassName: 'codicon codicon-add kira-review-glyph kira-review-glyph-add',
          glyphMargin: { position: mod.editor.GlyphMarginLane.Left },
          glyphMarginHoverMessage: { value: 'Add a review comment' },
        },
      },
    ]);
  }

  function paint(): void {
    if (disposed) return;

    // P75 §5: a fully-reviewed file needs no per-line tint — the per-hunk glyph below and the file
    // tree's own checked box already say it, on every line at once. The tint earns its keep only
    // for a partial review, where it is the sole thing showing which lines are covered.
    const fullyReviewed =
      lineCount > 0 && coverage({ start: 1, end: lineCount }, reviewedRanges) === 'full';
    reviewedLineCollection.set(
      fullyReviewed
        ? []
        : normalizeRanges(reviewedRanges).map(
            (r): DeltaDecoration => ({
              range: new mod.Range(r.start, 1, r.end, 1),
              options: {
                isWholeLine: true,
                className: 'kira-review-line-reviewed',
                overviewRuler: {
                  color: 'var(--kira-ok)',
                  position: mod.editor.OverviewRulerLane.Left,
                },
              },
            }),
          ),
    );

    const nextHunkByLine = new Map<number, { block: LineRange; reviewed: boolean }>();
    const hunkDecorations: DeltaDecoration[] = [];
    if (bodyKind === 'text') {
      for (const hunk of hunks) {
        const block = hunkChangeBlock(hunk);
        if (!block) continue;
        const reviewed = coverage(block, reviewedRanges) === 'full';
        nextHunkByLine.set(block.start, { block, reviewed });
        hunkDecorations.push({
          range: new mod.Range(block.start, 1, block.start, 1),
          options: {
            glyphMarginClassName: reviewed
              ? 'codicon codicon-pass-filled kira-review-glyph kira-review-glyph-reviewed'
              : 'codicon codicon-circle-large-outline kira-review-glyph kira-review-glyph-actionable',
            glyphMargin: { position: mod.editor.GlyphMarginLane.Right },
            glyphMarginHoverMessage: { value: reviewed ? 'Mark unreviewed' : 'Mark reviewed' },
          },
        });
      }
    }
    hunkByLine = nextHunkByLine;
    hunkCollection.set(hunkDecorations);

    const nextCommentByLine = new Map<number, ReviewComment>();
    for (const comment of comments) nextCommentByLine.set(comment.range.start, comment);
    commentByLine = nextCommentByLine;
    commentCollection.set(
      comments.map(
        (c): DeltaDecoration => ({
          range: new mod.Range(c.range.start, 1, c.range.start, 1),
          options: {
            glyphMarginClassName:
              'codicon codicon-comment kira-review-glyph kira-review-glyph-comment',
            glyphMargin: { position: mod.editor.GlyphMarginLane.Left },
            glyphMarginHoverMessage: commentHoverMessage(c),
          },
        }),
      ),
    );
    paintAddGlyph();

    // A repaint can move or remove the line the open thread was anchored to (a mark/comment
    // mutation elsewhere, §7.6) — close it rather than leave it pointing at a stale line.
    if (openThreadCommentId !== null && !comments.some((c) => c.id === openThreadCommentId)) {
      closeZone();
    }
  }

  // C13-12: split from one combined load() into loadDiff()/loadComments() — onReviewRepaint's own
  // fan-out (below) now dispatches by the repaint event's own `kind` instead of always reloading
  // both. A `mark` mutation can't change the comment list; a `comments` mutation can't change the
  // file diff — with N open review tabs on one branch, reloading both on every mutation cost N
  // redundant full diffs (a real server-side git diff, review.fileDiff) plus N full branch-wide
  // comment re-fetches (re-anchoring every comment on the branch server-side) for every single
  // comment click or mark toggle. C14-2: each now guards against staleness with its own counter
  // (diffSeq/commentsSeq) rather than one shared one — see those declarations' own comment.

  // reviewMarking.ts:245-288's own resolution chain, ported: sinceReview first, retried as `range`
  // only when the file's own reviewedAtSha has moved past what this tab was opened against — the
  // same "never silently switch modes under an open tab" rule.
  // Returns whether the diff actually loaded — C13-12's own load() uses this so a failed diff load
  // (any of the three early-return cases below) skips the now-separate loadComments() call too,
  // preserving the original combined function's own short-circuit: no point fetching a branch's
  // full comment list for an editor that has nothing to anchor it against and is showing an error
  // banner instead.
  async function loadDiff(): Promise<boolean> {
    const seq = ++diffSeq;
    let base: string | null;
    try {
      base = await resolveBase(deps.transport, deps.gitRepoId, deps.review.branch);
    } catch (err) {
      if (disposed || seq !== diffSeq) return false;
      // C13-9: a genuine rejection (a transient index.lock conflict, most likely) — resolveBase
      // no longer caches this (see baseMemo's own comment), so the banner's own Retry button (or
      // another load() call, e.g. the repaint fan-out) can genuinely succeed on a later attempt.
      console.error('reviewDecorations: review.resolveBase failed', err);
      showLoadError();
      return false;
    }
    if (disposed || seq !== diffSeq) return false;
    if (base === null) {
      // C13-9: a SUCCESSFUL resolution to "no base configured" — permanent, not transient, so
      // Retry (which would just re-resolve the same legitimate null) is actively misleading here.
      // Distinct message, no Retry button.
      showNoBaseConfigured();
      return false;
    }
    closeErrorZone();

    let result: ResultOf<'review.fileDiff'>;
    try {
      result = await deps.transport.request('review.fileDiff', {
        repoId: deps.gitRepoId,
        branch: deps.review.branch,
        base,
        path: deps.path,
        mode: 'sinceReview',
      });
      if (disposed || seq !== diffSeq) return false;
      if (result.reviewedAtSha !== null && result.reviewedAtSha !== deps.leftRev) {
        result = await deps.transport.request('review.fileDiff', {
          repoId: deps.gitRepoId,
          branch: deps.review.branch,
          base,
          path: deps.path,
          mode: 'range',
        });
        if (disposed || seq !== diffSeq) return false;
      }
    } catch (err) {
      if (disposed || seq !== diffSeq) return false;
      // C13-9: previously uncaught — a rejection here left a silently blank review layer and an
      // unhandled promise rejection in the console, entirely bypassing C12-7's retry-banner
      // mechanism (unlike the review.comment.list call below, which already had a `.catch`).
      console.error('reviewDecorations: review.fileDiff failed', err);
      showLoadError();
      return false;
    }
    hunks = result.body.kind === 'text' ? result.body.hunks : [];
    bodyKind = result.body.kind;
    reviewedRanges = result.reviewedRanges;
    lineCount = result.lineCount;
    paint();
    return true;
  }

  async function loadComments(): Promise<void> {
    const seq = ++commentsSeq;
    const commentsResult = await deps.transport
      .request('review.comment.list', {
        repoId: deps.gitRepoId,
        branch: deps.review.branch,
        at: deps.review.branchTip,
      })
      .catch(() => ({ at: deps.review.branchTip, comments: [] as readonly ReviewComment[] }));
    if (disposed || seq !== commentsSeq) return;
    // C14-6: review.comment.list is scoped to the whole review SESSION (every file on the
    // branch), not this editor's own file -- without this filter, a comment on another file could
    // paint as a phantom glyph/hover/thread here if that file happened to have a line at the same
    // number. (The VS Code extension's own reviewComments.ts:renderThreads has the identical gap,
    // left unfixed there -- out of this chapter's scope.)
    comments = commentsResult.comments.filter((c) => c.path === deps.path);
    paint();
  }

  /** The mount-time (and Retry-button) load only — reloads reachable from onReviewRepaint's own
   *  fan-out below call loadDiff/loadComments directly, whichever the mutation could actually have
   *  changed. Skips loadComments() when the diff itself never loaded (any of loadDiff's own three
   *  early-return cases) — no point fetching a branch's full comment list for an editor that is
   *  showing an error banner instead, the original combined function's own short-circuit. */
  async function load(): Promise<void> {
    if (await loadDiff()) await loadComments();
  }

  async function mark(range: LineRange, reviewed: boolean): Promise<void> {
    const clamped = clampRanges([range], lineCount);
    if (clamped.length === 0) return;
    try {
      await deps.transport.request('review.mark', {
        repoId: deps.gitRepoId,
        branch: deps.review.branch,
        path: deps.path,
        reviewed,
        ranges: clamped,
      });
    } catch (err) {
      console.error('reviewDecorations: review.mark failed', err);
      return;
    }
    // F9 (reviewMarking.ts:520-521): never predict the stored state locally — reload from the
    // server's own fresh review.fileDiff. No explicit reload here: transport.ts's own repaint
    // fan-out (§7.6) is the ONE reload path for every open tab on this (repoId, branch, path),
    // this editor included — its `onReviewRepaint` filter matches this editor's own deps just
    // like every other subscriber's (C12-4: an extra `load()` call here used to double-reload
    // this same editor, since the fan-out never excluded the tab that made the call).
  }

  function currentSelectionRange(): LineRange {
    const selection = modifiedEditor.getSelection();
    if (!selection) return { start: 1, end: 1 };
    return selectionToRange({
      start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
      end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
    });
  }

  function toggleThread(comment: ReviewComment): void {
    if (openThreadCommentId === comment.id) {
      closeZone();
      return;
    }
    openThreadCommentId = comment.id;
    openZone(comment.range.start, (container) => {
      const app = createApp(ReviewThread, {
        mode: 'view' as const,
        comment,
        branch: deps.review.branch,
        onClose: () => closeZone(),
        onDelete: () => void handleDelete(comment),
      });
      app.mount(container);
      return app;
    });
  }

  function openCompose(line: number): void {
    openZone(line, (container) => {
      const app = createApp(ReviewThread, {
        mode: 'compose' as const,
        branch: deps.review.branch,
        onCancel: () => closeZone(),
        onSubmit: (body: string) => void handleSubmit(line, body),
      });
      app.mount(container);
      return app;
    });
  }

  async function handleSubmit(line: number, body: string): Promise<void> {
    try {
      await deps.transport.request('review.comment.add', {
        repoId: deps.gitRepoId,
        branch: deps.review.branch,
        path: deps.path,
        at: deps.review.branchTip,
        range: { start: line, end: line },
        body,
      });
    } catch (err) {
      console.error('reviewDecorations: review.comment.add failed', err);
      return;
    }
    closeZone();
    // No explicit reload — see mark()'s own comment: transport.ts's repaint fan-out covers this
    // editor already (C12-4).
  }

  async function handleDelete(comment: ReviewComment): Promise<void> {
    try {
      await deps.transport.request('review.comment.remove', {
        repoId: deps.gitRepoId,
        branch: deps.review.branch,
        id: comment.id,
      });
    } catch (err) {
      console.error('reviewDecorations: review.comment.remove failed', err);
      return;
    }
    closeZone();
    // No explicit reload — see mark()'s own comment: transport.ts's repaint fan-out covers this
    // editor already (C12-4).
  }

  const mouseDownDisposable = modifiedEditor.onMouseDown((e) => {
    if (e.target.type !== mod.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    if (line === undefined) return;
    const lane = e.target.detail.glyphMarginLane;
    if (lane === mod.editor.GlyphMarginLane.Right) {
      const hunk = hunkByLine.get(line);
      if (hunk) void mark(hunk.block, !hunk.reviewed);
    } else if (lane === mod.editor.GlyphMarginLane.Left) {
      const comment = commentByLine.get(line);
      if (comment) toggleThread(comment);
      else if (hoverLine === line) openCompose(line);
    }
  });

  const mouseMoveDisposable = modifiedEditor.onMouseMove((e) => {
    const line = e.target.position?.lineNumber ?? null;
    if (line === hoverLine) return;
    hoverLine = line;
    paintAddGlyph();
  });

  const mouseLeaveDisposable = modifiedEditor.onMouseLeave(() => {
    hoverLine = null;
    paintAddGlyph();
  });

  // §7.4: the context-menu/keybinding route to the same two gestures a glyph click already gives —
  // OQ3's "keep both".
  const addCommentAction = modifiedEditor.addAction({
    id: 'kira.review.addComment',
    label: 'Add Review Comment',
    contextMenuGroupId: 'kiraReview',
    run: () => {
      const line =
        modifiedEditor.getSelection()?.positionLineNumber ??
        modifiedEditor.getPosition()?.lineNumber;
      if (line !== undefined) openCompose(line);
    },
  });
  const markReviewedAction = modifiedEditor.addAction({
    id: 'kira.review.markReviewed',
    label: 'Mark Selection Reviewed',
    contextMenuGroupId: 'kiraReview',
    run: () => void mark(currentSelectionRange(), true),
  });
  const markUnreviewedAction = modifiedEditor.addAction({
    id: 'kira.review.markUnreviewed',
    label: 'Mark Selection Unreviewed',
    contextMenuGroupId: 'kiraReview',
    run: () => void mark(currentSelectionRange(), false),
  });

  // §7.6's repaint table, the listening side of transport.ts's fan-out — a mutation from either
  // half of the UI (this editor or the panel's own Comments pane) reloads this editor exactly
  // once it actually succeeded. C13-12: dispatches by the event's own `kind` rather than always
  // reloading both halves — a `mark` mutation can only have changed the file diff (reviewed
  // ranges/hunks), a `comments` mutation only the comment list.
  const unsubscribeRepaint = onReviewRepaint((event) => {
    if (event.repoId !== deps.gitRepoId || event.branch !== deps.review.branch) return;
    if (event.kind === 'mark') {
      if (event.path !== deps.path) return;
      void loadDiff();
    } else {
      void loadComments();
    }
  });

  void load();

  return {
    dispose(): void {
      disposed = true;
      unsubscribeRepaint();
      closeZone();
      closeErrorZone();
      mouseDownDisposable.dispose();
      mouseMoveDisposable.dispose();
      mouseLeaveDisposable.dispose();
      addCommentAction.dispose();
      markReviewedAction.dispose();
      markUnreviewedAction.dispose();
      reviewedLineCollection.clear();
      hunkCollection.clear();
      commentCollection.clear();
      addGlyphCollection.clear();
      // 7d (P68 review): this module is what leases deps.transport (gitTransportFor, called once
      // per mount by RepoDiffView.vue) — nothing else holds a reference to release it.
      deps.transport.dispose();
    },
  };
}
