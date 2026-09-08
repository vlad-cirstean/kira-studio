/**
 * G15 D1-D4/D7/D8/D12 — range/hunk-level review marking inside VS Code's native diff editor.
 *
 * SPEC's own G15 row names VS Code's built-in Git extension's hunk-staging gutter ("stage this
 * hunk") as the model, but that mechanism is unavailable to a sideloaded `.vsix` on stable VS
 * Code: `diffEditor/gutter/hunk`/`diffEditor/gutter/selection` are both declared
 * `proposed: 'contribDiffEditorGutterToolBarMenus'` (VS Code's own `menusExtensionPoint.ts`), and
 * the hunk data behind them (`TextEditor.diffInformation`) lives in
 * `vscode.proposed.textEditorDiffInformation.d.ts`, absent from stable `@types/vscode`. The
 * `diffEditor.codeLens` setting that would make a CodeLens-only design visible also defaults to
 * `false`. This controller therefore reproduces the *affordance* — a gutter mark, a trusted hover
 * carrying the action, a selection-driven toolbar entry, and an opt-in CodeLens — from stable API
 * only (D1), never `--enable-proposed-api` and never a second diff implementation to match VS
 * Code's own rendered blocks (D1's two rejections).
 *
 * `goToFile.ts`'s split applies here too (D11): this file is the `vscode`-facing controller;
 * `reviewRanges.ts` is the pure algebra beneath it, importable and testable with no extension host.
 */
import { basename } from 'node:path';
import type { DiffHunk, EventPayload, FileDiffBody, LineRange } from '@kira/git-ipc';
import * as vscode from 'vscode';
import type { ConnectionManager, ConnectionState } from './connection.ts';
import { SCHEME } from './ports/editorIntegration.ts';
import { reviewAnchorFor } from './reviewComments.ts';
import {
  clampRanges,
  coverage,
  hunkChangeBlock,
  normalizeRanges,
  selectionToRange,
} from './reviewRanges.ts';
import { decodeKey, encodeKey, parseVirtualKey, virtualKey } from './virtualKey.ts';

const MARK_REVIEWED_COMMAND = 'kiraVersion.markSelectionReviewed';
const MARK_UNREVIEWED_COMMAND = 'kiraVersion.markSelectionUnreviewed';

const IN_REVIEW_DIFF_CONTEXT = 'kiraVersion.inReviewDiff';
const REVIEW_SELECTION_CONTEXT = 'kiraVersion.reviewSelection';

export interface ReviewMarkingDeps {
  readonly connection: ConnectionManager;
  readonly extensionUri: vscode.Uri;
  /** D9: `reviewProvider.runUiAction('refresh')` — the `let`-bound provider, same cycle break
   *  `reviewComments.ts`'s own `onEditorMutated` already uses. */
  readonly notifySidebarRefresh: () => void;
}

/** An explicit `{uri, ranges}` target — the hover command link and the CodeLens's own invocation
 *  (D2), bypassing tab/selection resolution entirely. */
export interface MarkTarget {
  readonly uri: vscode.Uri;
  readonly ranges: readonly LineRange[];
}

export interface ReviewMarkingController extends vscode.Disposable {
  /** `proxyHandlers.ts`'s post-`editor.openRangeDiff` hook (D7) — paints immediately rather than
   *  waiting for `onDidChangeVisibleTextEditors`. */
  refreshForKey(repoId: string, branchTip: string, path: string, branch: string): void;
  /** The webview-mutation hook: a sidebar whole-file toggle repaints every tracked URI for the
   *  same `(repoId, branch, path)`. */
  notifyMarked(repoId: string, branch: string, path: string): void;
  /** D8's staleness check. */
  notifyRepoChanged(payload: EventPayload<'repo.changed'>): void;
  /** D7's "connection state leaves connected" row. */
  notifyConnectionState(state: ConnectionState): void;
  /** The shared body behind both commands (D2/D5). `undefined` `target` resolves the active review
   *  diff and its selection; an explicit one (hover link, CodeLens) acts on exactly that hunk. */
  markRanges(target: MarkTarget | undefined, reviewed: boolean): Promise<void>;
}

interface MarkingState {
  readonly anchor: {
    readonly repoId: string;
    readonly branch: string;
    readonly path: string;
    readonly at: string;
  };
  readonly leftRev: string | undefined;
  readonly hunks: readonly DiffHunk[];
  readonly bodyKind: FileDiffBody['kind'];
  readonly bodyEmptyReason: 'modeChangeOnly' | 'identical' | undefined;
  readonly reviewedRanges: readonly LineRange[];
  readonly lineCount: number;
  readonly stale: boolean;
}

/** The URI shape `ports/editorIntegration.ts`'s own `toUri` mints, generalised to either side —
 *  `diffToolbar.ts`'s own `resolveVirtualUri`, re-derived here (not imported) for the same reason
 *  `reviewComments.ts` and `diffToolbar.ts` each already carry their own small copy rather than a
 *  shared one: this file, like those, stays a single self-contained `vscode`-facing unit. */
function resolveVirtualUri(
  uri: vscode.Uri,
): { repoId: string; rev: string; path: string } | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const [first] = uri.path.split('/').filter((segment) => segment.length > 0);
  if (first === undefined) return undefined;
  const parsed = parseVirtualKey(decodeKey(first));
  if (!parsed) return undefined;
  return { repoId: parsed.repoId, rev: parsed.rev, path: parsed.path };
}

function reviewDocumentUri(
  repoId: string,
  branchTip: string,
  path: string,
  branch: string,
): vscode.Uri {
  const key = virtualKey(repoId, branchTip, path, branch);
  return vscode.Uri.parse(`${SCHEME}:/${encodeKey(key)}/${encodeURIComponent(basename(path))}`);
}

function toVscodeRange(range: LineRange): vscode.Range {
  return new vscode.Range(range.start - 1, 0, range.end - 1, 0);
}

function rangeLabel(range: LineRange): string {
  return range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}–${range.end}`;
}

function hoverMessage(
  block: LineRange,
  isReviewed: boolean,
  uri: vscode.Uri,
): vscode.MarkdownString {
  const command = isReviewed ? MARK_UNREVIEWED_COMMAND : MARK_REVIEWED_COMMAND;
  const actionLabel = isReviewed ? 'Mark unreviewed' : 'Mark reviewed';
  const args = encodeURIComponent(JSON.stringify({ uri: uri.toString(), ranges: [block] }));
  const md = new vscode.MarkdownString(
    `**${rangeLabel(block)}** · ${isReviewed ? 'reviewed' : 'not reviewed'}\n\n` +
      `[${actionLabel}](command:${command}?${args})`,
  );
  // D2b: an allow-list of exactly these two commands, never a blanket `true` — house-consistent
  // with reviewView.ts's own enableCommandUris discipline.
  md.isTrusted = { enabledCommands: [MARK_REVIEWED_COMMAND, MARK_UNREVIEWED_COMMAND] };
  return md;
}

function bodyKindMessage(
  kind: FileDiffBody['kind'],
  reason: MarkingState['bodyEmptyReason'],
): string {
  switch (kind) {
    case 'binary':
      return "Kira Version: can't mark ranges — this file is binary.";
    case 'lfsPointer':
      return "Kira Version: can't mark ranges — this file is stored in Git LFS.";
    case 'tooLarge':
      return "Kira Version: can't mark ranges — this file is too large to diff.";
    case 'empty':
      return reason === 'modeChangeOnly'
        ? "Kira Version: can't mark ranges — this is a mode change only, no content differs."
        : "Kira Version: can't mark ranges — the content is identical, there is nothing to review.";
    case 'text':
      return '';
  }
}

function asExplicitTarget(value: unknown): MarkTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as { uri?: unknown; ranges?: unknown };
  if (typeof v.uri !== 'string' || !Array.isArray(v.ranges)) return undefined;
  const ranges: LineRange[] = [];
  for (const r of v.ranges) {
    if (typeof r !== 'object' || r === null) return undefined;
    const { start, end } = r as { start?: unknown; end?: unknown };
    if (typeof start !== 'number' || typeof end !== 'number') return undefined;
    ranges.push({ start, end });
  }
  try {
    return { uri: vscode.Uri.parse(v.uri), ranges };
  } catch {
    return undefined;
  }
}

export function createReviewMarkingController(deps: ReviewMarkingDeps): ReviewMarkingController {
  const { connection, extensionUri, notifySidebarRefresh } = deps;

  // D3: three decoration types, painted on the modified pane only, disposed with the controller.
  const markReviewedIcon = vscode.Uri.joinPath(extensionUri, 'resources', 'mark-reviewed.svg');
  const markedReviewedIcon = vscode.Uri.joinPath(extensionUri, 'resources', 'marked-reviewed.svg');
  const reviewedType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('kiraVersion.reviewedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('kiraVersion.reviewedLineOverviewRuler'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const actionableType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: markReviewedIcon,
    gutterIconSize: 'contain',
    light: { gutterIconPath: markReviewedIcon },
    dark: { gutterIconPath: markReviewedIcon },
  });
  const reviewedHunkType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: markedReviewedIcon,
    gutterIconSize: 'contain',
    light: { gutterIconPath: markedReviewedIcon },
    dark: { gutterIconPath: markedReviewedIcon },
  });

  const states = new Map<string, MarkingState>();
  const inFlight = new Map<string, AbortController>();
  const baseMemo = new Map<string, Promise<string | null>>();
  const codeLensEmitter = new vscode.EventEmitter<void>();

  function resolveBase(repoId: string, branch: string): Promise<string | null> {
    const key = `${repoId}\0${branch}`;
    let cached = baseMemo.get(key);
    if (!cached) {
      // G18 D6: baseCandidates is no longer injected here — a raw request (omitting it) now
      // resolves the repo's own stored kiraVersion.review.baseCandidates server-side, the exact
      // upgrade D6 describes, so this call needs nothing beyond repoId/branch any more.
      cached = connection
        .request('review.resolveBase', { repoId, branch })
        .then((r) => r.base)
        .catch(() => null);
      baseMemo.set(key, cached);
    }
    return cached;
  }

  function dropBaseMemoFor(repoId: string): void {
    for (const key of [...baseMemo.keys()]) {
      if (key.startsWith(`${repoId}\0`)) baseMemo.delete(key);
    }
  }

  // D4: the resolution chain, entirely inside the extension — anchor -> tab -> leftRev -> base
  // (memoised) -> review.fileDiff's own mode selection.
  async function resolve(uri: vscode.Uri, signal: AbortSignal): Promise<MarkingState | undefined> {
    const anchor = reviewAnchorFor(uri);
    if (!anchor) return undefined;
    const tab = findDiffTabForModified(uri);
    const leftRev = tab ? resolveVirtualUri(tab.original)?.rev : undefined;
    const base = await resolveBase(anchor.repoId, anchor.branch);
    if (base === null) return undefined;
    const sinceReview = await connection.request(
      'review.fileDiff',
      {
        repoId: anchor.repoId,
        branch: anchor.branch,
        base,
        path: anchor.path,
        mode: 'sinceReview',
      },
      signal,
    );
    const result =
      sinceReview.reviewedAtSha === null || leftRev === sinceReview.reviewedAtSha
        ? sinceReview
        : await connection.request(
            'review.fileDiff',
            {
              repoId: anchor.repoId,
              branch: anchor.branch,
              base,
              path: anchor.path,
              mode: 'range',
            },
            signal,
          );
    const hunks = result.body.kind === 'text' ? result.body.hunks : [];
    return {
      anchor,
      leftRev,
      hunks,
      bodyKind: result.body.kind,
      bodyEmptyReason: result.body.kind === 'empty' ? result.body.reason : undefined,
      reviewedRanges: result.reviewedRanges,
      lineCount: result.lineCount,
      stale: false,
    };
  }

  function findDiffTabForModified(uri: vscode.Uri): vscode.TabInputTextDiff | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.toString() === uri.toString()
        ) {
          return tab.input;
        }
      }
    }
    return undefined;
  }

  function paint(editor: vscode.TextEditor, state: MarkingState): void {
    editor.setDecorations(reviewedType, state.reviewedRanges.map(toVscodeRange));
    if (state.stale || state.bodyKind !== 'text') {
      editor.setDecorations(actionableType, []);
      editor.setDecorations(reviewedHunkType, []);
      return;
    }
    const actionable: vscode.DecorationOptions[] = [];
    const reviewed: vscode.DecorationOptions[] = [];
    for (const hunk of state.hunks) {
      const block = hunkChangeBlock(hunk);
      if (!block) continue;
      const range = new vscode.Range(block.start - 1, 0, block.start - 1, 0);
      if (coverage(block, state.reviewedRanges) === 'full') {
        reviewed.push({ range, hoverMessage: hoverMessage(block, true, editor.document.uri) });
      } else {
        actionable.push({ range, hoverMessage: hoverMessage(block, false, editor.document.uri) });
      }
    }
    editor.setDecorations(actionableType, actionable);
    editor.setDecorations(reviewedHunkType, reviewed);
  }

  function clear(editor: vscode.TextEditor): void {
    editor.setDecorations(reviewedType, []);
    editor.setDecorations(actionableType, []);
    editor.setDecorations(reviewedHunkType, []);
  }

  function paintForUri(uri: vscode.Uri, state: MarkingState): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) paint(editor, state);
    }
  }

  function clearForUri(uri: vscode.Uri): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) clear(editor);
    }
  }

  function activeModifiedEditor(): vscode.TextEditor | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputTextDiff)) return undefined;
    return vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === input.modified.toString(),
    );
  }

  function aggregateCoverage(
    ranges: readonly LineRange[],
    reviewedRanges: readonly LineRange[],
  ): 'none' | 'partial' | 'full' {
    const results = ranges.map((r) => coverage(r, reviewedRanges));
    if (results.every((c) => c === 'full')) return 'full';
    if (results.every((c) => c === 'none')) return 'none';
    return 'partial';
  }

  // D12: the two context keys driving the `when` clauses — recomputed on selection change and on
  // active-editor change, never on `resourceScheme` alone (a commit diff, and a stale review diff,
  // must both offer nothing).
  function updateContextKeys(): void {
    const editor = activeModifiedEditor();
    const state = editor ? states.get(editor.document.uri.toString()) : undefined;
    const inReviewDiff = state !== undefined && state.bodyKind === 'text' && !state.stale;
    void vscode.commands.executeCommand('setContext', IN_REVIEW_DIFF_CONTEXT, inReviewDiff);
    if (!inReviewDiff || !editor || !state) {
      void vscode.commands.executeCommand('setContext', REVIEW_SELECTION_CONTEXT, 'empty');
      return;
    }
    const ranges = normalizeRanges(
      editor.selections.map((s) =>
        selectionToRange({
          start: { line: s.start.line, character: s.start.character },
          end: { line: s.end.line, character: s.end.character },
        }),
      ),
    );
    void vscode.commands.executeCommand(
      'setContext',
      REVIEW_SELECTION_CONTEXT,
      aggregateCoverage(ranges, state.reviewedRanges),
    );
  }

  async function loadAndPaint(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    inFlight.get(key)?.abort();
    const controller = new AbortController();
    inFlight.set(key, controller);
    try {
      const state = await resolve(uri, controller.signal);
      if (inFlight.get(key) !== controller) return; // superseded by a newer load
      if (!state) {
        states.delete(key);
        clearForUri(uri);
      } else {
        states.set(key, state);
        paintForUri(uri, state);
      }
    } catch {
      // A transient review.fileDiff failure clears decorations and leaves no error UI (D7) — the
      // same posture reviewComments.ts's own renderThreads already takes.
      if (inFlight.get(key) !== controller) return;
      states.delete(key);
      clearForUri(uri);
    } finally {
      if (inFlight.get(key) === controller) inFlight.delete(key);
    }
    updateContextKeys();
    codeLensEmitter.fire();
  }

  function markStale(key: string): void {
    const state = states.get(key);
    if (!state || state.stale) return;
    const next: MarkingState = { ...state, stale: true };
    states.set(key, next);
    paintForUri(vscode.Uri.parse(key), next);
    updateContextKeys();
    codeLensEmitter.fire();
  }

  // D2c: opt-in inline action — invisible unless the user has `diffEditor.codeLens` on (F4), never
  // the sole route to anything.
  const codeLensProvider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: codeLensEmitter.event,
    provideCodeLenses(document) {
      const state = states.get(document.uri.toString());
      if (!state || state.stale || state.bodyKind !== 'text') return [];
      const lenses: vscode.CodeLens[] = [];
      for (const h of state.hunks) {
        const block = hunkChangeBlock(h);
        if (!block) continue;
        const isReviewed = coverage(block, state.reviewedRanges) === 'full';
        const range = new vscode.Range(block.start - 1, 0, block.start - 1, 0);
        lenses.push(
          new vscode.CodeLens(range, {
            title: isReviewed ? 'Mark Unreviewed' : 'Mark Reviewed',
            command: isReviewed ? MARK_UNREVIEWED_COMMAND : MARK_REVIEWED_COMMAND,
            arguments: [{ uri: document.uri.toString(), ranges: [block] }],
          }),
        );
      }
      return lenses;
    },
  };
  const codeLensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: SCHEME },
    codeLensProvider,
  );

  async function markRanges(target: MarkTarget | undefined, reviewed: boolean): Promise<void> {
    let uri: vscode.Uri;
    let ranges: readonly LineRange[];
    if (target) {
      uri = target.uri;
      ranges = target.ranges;
    } else {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!(tab instanceof vscode.TabInputTextDiff)) return;
      // D5's hard refusal, before anything else: the left pane's line numbers are the merge
      // base's (or the snapshot's), and writing them as `ranges` would corrupt durable state with
      // no error anywhere (F9).
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (activeUri && activeUri.toString() === tab.original.toString()) {
        await vscode.window.showInformationMessage(
          "Kira Version: mark reviewed works on the right-hand side of the diff — the branch's own version of the file.",
        );
        return;
      }
      // D5: never `activeTextEditor` alone — take the modified pane's own editor, focused or not.
      const chosenEditor =
        activeUri && activeUri.toString() === tab.modified.toString()
          ? vscode.window.activeTextEditor
          : vscode.window.visibleTextEditors.find(
              (e) => e.document.uri.toString() === tab.modified.toString(),
            );
      if (!chosenEditor) return;
      uri = tab.modified;
      ranges = normalizeRanges(
        chosenEditor.selections.map((s) =>
          selectionToRange({
            start: { line: s.start.line, character: s.start.character },
            end: { line: s.end.line, character: s.end.character },
          }),
        ),
      );
    }

    const key = uri.toString();
    const state = states.get(key);
    if (!state) return;
    if (state.stale) {
      await vscode.window.showInformationMessage(
        `Kira Version: this diff is from an earlier revision of ${state.anchor.branch} — reopen the file from the Branch Review sidebar to mark it.`,
      );
      return;
    }
    if (state.bodyKind !== 'text') {
      await vscode.window.showInformationMessage(
        bodyKindMessage(state.bodyKind, state.bodyEmptyReason),
      );
      return;
    }
    const clamped = clampRanges(ranges, state.lineCount);
    if (clamped.length === 0) return;
    try {
      await connection.request('review.mark', {
        repoId: state.anchor.repoId,
        branch: state.anchor.branch,
        path: state.anchor.path,
        reviewed,
        ranges: clamped,
      });
    } catch (err) {
      await vscode.window.showErrorMessage(`Kira Version: couldn't mark reviewed — ${String(err)}`);
      return;
    }
    // F9: never Union(old, given) locally — the server re-snapshots on every write, so the
    // post-write state is only ever learned from a fresh review.fileDiff.
    await loadAndPaint(uri);
    notifySidebarRefresh();
  }

  function refreshForKey(repoId: string, branchTip: string, path: string, branch: string): void {
    void loadAndPaint(reviewDocumentUri(repoId, branchTip, path, branch));
  }

  function notifyMarked(repoId: string, branch: string, path: string): void {
    for (const [key, state] of states) {
      if (
        state.anchor.repoId === repoId &&
        state.anchor.branch === branch &&
        state.anchor.path === path
      ) {
        void loadAndPaint(vscode.Uri.parse(key));
      }
    }
  }

  // D8: new commits produce a new URI on their own (the tip is embedded in it), so there is
  // nothing to reconcile on the tab a fresh open creates. This is entirely about the *old* one.
  async function notifyRepoChanged(payload: EventPayload<'repo.changed'>): Promise<void> {
    const { repoId } = payload;
    dropBaseMemoFor(repoId);
    const branches = new Set<string>();
    for (const state of states.values()) {
      if (state.anchor.repoId === repoId) branches.add(state.anchor.branch);
    }
    for (const branch of branches) {
      const base = await resolveBase(repoId, branch);
      let branchTip: string | null = null;
      if (base !== null) {
        try {
          const result = await connection.request('review.files', { repoId, branch, base });
          branchTip = result.branchTip;
        } catch {
          branchTip = null;
        }
      }
      for (const [key, state] of states) {
        if (state.anchor.repoId !== repoId || state.anchor.branch !== branch) continue;
        if (branchTip !== null && branchTip === state.anchor.at) {
          void loadAndPaint(vscode.Uri.parse(key));
        } else {
          markStale(key);
        }
      }
    }
  }

  function notifyConnectionState(state: ConnectionState): void {
    if (state.kind === 'connected') return;
    for (const key of [...states.keys()]) clearForUri(vscode.Uri.parse(key));
    states.clear();
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    void vscode.commands.executeCommand('setContext', IN_REVIEW_DIFF_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', REVIEW_SELECTION_CONTEXT, 'empty');
    codeLensEmitter.fire();
  }

  // Loads (D7): a tab VS Code restored after a reload, a split, a second group — repainted from
  // cache when already tracked, fetched otherwise.
  const visibilitySub = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    for (const editor of editors) {
      const cached = states.get(editor.document.uri.toString());
      if (cached) {
        paint(editor, cached);
        continue;
      }
      if (reviewAnchorFor(editor.document.uri)) void loadAndPaint(editor.document.uri);
    }
    updateContextKeys();
  });
  const activeEditorSub = vscode.window.onDidChangeActiveTextEditor(() => updateContextKeys());
  const selectionSub = vscode.window.onDidChangeTextEditorSelection(() => updateContextKeys());
  const tabsSub = vscode.window.tabGroups.onDidChangeTabs((e) => {
    for (const tab of e.closed) {
      if (tab.input instanceof vscode.TabInputTextDiff) {
        const key = tab.input.modified.toString();
        states.delete(key);
        inFlight.get(key)?.abort();
        inFlight.delete(key);
      }
    }
  });

  return {
    refreshForKey,
    notifyMarked,
    notifyRepoChanged: (payload) => void notifyRepoChanged(payload),
    notifyConnectionState,
    markRanges,
    dispose() {
      visibilitySub.dispose();
      activeEditorSub.dispose();
      selectionSub.dispose();
      tabsSub.dispose();
      codeLensRegistration.dispose();
      codeLensEmitter.dispose();
      reviewedType.dispose();
      actionableType.dispose();
      reviewedHunkType.dispose();
      for (const controller of inFlight.values()) controller.abort();
      states.clear();
    },
  };
}

/** `kiraVersion.markSelectionReviewed` — `diffToolbar.ts`'s own two-arm command shape
 *  (`openCommitInGraphCommand`), reused: an explicit `{uri, ranges}` argument (the hover link, the
 *  CodeLens) bypasses tab/selection resolution entirely. */
export function markSelectionReviewedCommand(
  deps: ReviewMarkingController,
): (explicit?: unknown) => void {
  return (explicit?: unknown) => void deps.markRanges(asExplicitTarget(explicit), true);
}

export function markSelectionUnreviewedCommand(
  deps: ReviewMarkingController,
): (explicit?: unknown) => void {
  return (explicit?: unknown) => void deps.markRanges(asExplicitTarget(explicit), false);
}
