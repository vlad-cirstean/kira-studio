/**
 * P62 §4 — the repo file viewer's own git-blame annotation: injected text at the end of the
 * cursor's line, `<author>, <age> · <subject>`, reusing v1.4 P5's `blame.line` backend with no
 * wire change (§0/§1). Shaped like `reviewDecorations.ts`: `attach…(mod, editor, deps)` returns a
 * `{ dispose() }` handle, called once per mount.
 *
 * §4.3's request lifecycle re-derives `blameWidget.ts`'s own shape on Monaco's events rather than
 * importing it (that controller is `vscode`-facing and lives in a different bundle): cursor-line
 * trigger, dedupe on the line (not the column — this view is read-only, so there is no dirty-
 * buffer half of the key P5 needs, §4.3), 150 ms debounce, an `AbortController` per request plus a
 * `line !== lastLine` guard on resolution, a per-mount cache (legitimate here in a way a server-
 * side cache is not — the model is immutable for the life of the mount, §4.3), and `repo.changed`
 * invalidation. Failure is always silence (§4.3) — an untracked path, a line past EOF, an aborted
 * request and a genuine RPC error all render nothing, never an error surface.
 */
import { formatAbsoluteDate, formatRelativeDate } from '@kira/git-core';
import type { EventPayload, ResultOf, Transport } from '@kira/git-ipc';
import { codeRepoIdFor, stashPendingBlameReveal } from '../../repo/git/hostHandlers';
import { pinnedGraphTabId } from '../../repo/git/reviewSession';
import { emitUiAction } from '../../repo/git/transport';
import { ensureRepoOpen } from '../../state/repoOpenHold';
import { activateTab } from '../../state/tabs';
import type { MonacoModule } from './monaco';

type CodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type DeltaDecoration = import('monaco-editor').editor.IModelDeltaDecoration;

const DEBOUNCE_MS = 150;

/** `blame.line`'s own sentinel for a line whose content isn't in any commit yet (an unstaged,
 *  on-disk edit) — the same literal `porcelain.UncommittedBlameSHA` and
 *  `blameState.ts`'s `UNCOMMITTED_BLAME_SHA` already carry. A third copy rather than a shared
 *  import: neither of those is reachable from this module (Go isn't importable; the extension's
 *  own `blameState.ts` is a different bundle) — `blame.go`'s own doc comment names this as the
 *  right call over inventing a boolean the wire does not have (§4.4). */
const UNCOMMITTED_BLAME_SHA = '0000000000000000000000000000000000000000';

type BlameResult = ResultOf<'blame.line'>;

export interface BlameAnnotationDeps {
  readonly transport: Transport;
  readonly gitRepoId: string;
  /** Already repo-relative — `props.tab.path`, the same string `codeWorkspaceReadFile` reads. */
  readonly path: string;
}

export interface BlameAnnotationHandle {
  dispose(): void;
}

// §4.2: `blame.line` needs this connection to already hold the repo — `ensureRepoOpen` (moved to
// state/repoOpenHold.ts, Group 3 P69 review, so `repo/git/transport.ts`'s own dispose path can
// clear its memo entry without a views/ -> repo/ layering violation) memoises the `repo.open`
// call per gitRepoId, one hold per transport for as long as it lives.

/** Injected text must be a single line (Monaco's own `InjectedTextOptions.content` doc comment) —
 *  a commit subject can't itself contain a newline after `--line-porcelain`, but this normalises
 *  whitespace and clamps length anyway rather than trusting that, so a pathological subject can
 *  never push the horizontal scrollbar out. */
function clampSubject(summary: string): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

function annotationText(result: BlameResult): string {
  if (result.sha === UNCOMMITTED_BLAME_SHA) return 'Uncommitted';
  const subject = clampSubject(result.summary);
  const age = formatRelativeDate(result.authorTimeSeconds);
  return subject.length > 0 ? `${result.author}, ${age} · ${subject}` : `${result.author}, ${age}`;
}

function hoverMessage(result: BlameResult): { value: string }[] {
  if (result.sha === UNCOMMITTED_BLAME_SHA) return [{ value: 'Not committed yet' }];
  const subject = clampSubject(result.summary);
  return [
    { value: subject.length > 0 ? subject : '(no commit message)' },
    { value: `${result.author}, ${formatAbsoluteDate(result.authorTimeSeconds)}` },
  ];
}

/** §4.5: routes the annotation's context-menu action to the pinned graph tab — mirrors C11's own
 *  `review.open` cold-mount race (`hostHandlers.ts`'s `pendingReviewTargetByCodeRepoId`): a file
 *  tab can be active before the graph tab has ever mounted, so a `ui.action` emitted straight onto
 *  the transport would have nothing listening. Stash-then-activate covers the cold case;
 *  `emitUiAction` covers the case where the graph is already live. A codeRepoId or graph-tab miss
 *  (this file's own repo isn't open as a workspace, or has never mounted a graph tab — neither
 *  should happen in practice) is a silent no-op, the same posture every other cold-path guard in
 *  this module already takes.
 */
function revealBlameCommit(gitRepoId: string, sha: string): void {
  const codeRepoId = codeRepoIdFor(gitRepoId);
  if (codeRepoId === undefined) return;
  const graphTabId = pinnedGraphTabId(codeRepoId);
  if (!graphTabId) return;
  const target = { repoId: gitRepoId, sha };
  // Group 6 (P68 review): emit live FIRST and only stash when nothing was actually listening — the
  // common case (the graph tab is already mounted, since it's pinned) delivers immediately here, so
  // stashing unconditionally on top of that left a pending entry no mount ever consumed, surviving
  // to replay a stale target on the graph tab's NEXT remount (takePendingBlameReveal's own doc
  // comment promises that can't happen).
  const consumed = emitUiAction(codeRepoId, { action: 'revealCommit', target });
  if (!consumed) stashPendingBlameReveal(codeRepoId, target);
  activateTab(graphTabId);
}

/** Attaches the blame layer to an already-mounted, read-only file editor. Call once per mount
 *  (`RepoFileView.vue`); `dispose()` on unmount or when the `inlineBlame` setting turns off. */
export function attachBlameAnnotation(
  mod: MonacoModule,
  editor: CodeEditor,
  deps: BlameAnnotationDeps,
): BlameAnnotationHandle {
  let disposed = false;
  const collection = editor.createDecorationsCollection([]);

  // Dedupe on the line, not the column (a horizontal cursor move must not re-fire) — mirrors
  // `blameWidget.ts`'s own `lastLineKey`, minus its `isDirty` half: this view is
  // readOnly/domReadOnly and nothing in this app writes its model, so the buffer is always the
  // saved file (§4.3) — P5's dirty-buffer state is structurally absent here, not skipped.
  let lastLine: number | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  // Per-mount cache: the model is immutable for the life of the mount, so (path, line) is a
  // stable key until `repo.changed` says otherwise (§4.3). A cached `null` is a resolved miss
  // (untracked path, line past EOF, a real RPC error) — not retried on every revisit.
  const cache = new Map<number, BlameResult | null>();

  function paint(result: BlameResult | null): void {
    if (disposed) return;
    if (!result) {
      collection.set([]);
      return;
    }
    const line = lastLine;
    const model = line === undefined ? null : editor.getModel();
    if (line === undefined || !model || line > model.getLineCount()) {
      collection.set([]);
      return;
    }
    const maxCol = model.getLineMaxColumn(line);
    const decoration: DeltaDecoration = {
      range: new mod.Range(line, maxCol, line, maxCol),
      options: {
        after: {
          // A few leading spaces so the annotation never butts against the code.
          content: `    ${annotationText(result)}`,
          inlineClassName: 'kira-blame-inline',
          // §3 point 2: never affects letter spacing — the annotation sits past the line's last
          // column, so it must never shift the glyph grid.
        },
        hoverMessage: hoverMessage(result),
      },
    };
    collection.set([decoration]);
  }

  function cancelPending(): void {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    inFlight?.abort();
    inFlight = undefined;
  }

  async function resolveLine(line: number): Promise<void> {
    try {
      await ensureRepoOpen(deps.transport, deps.gitRepoId);
    } catch {
      // §4.3: failure is silence — from the reader's own vantage this is an ordinary file.
      if (line === lastLine) paint(null);
      return;
    }
    if (disposed || line !== lastLine) return;

    const controller = new AbortController();
    inFlight = controller;
    try {
      const result = await deps.transport.request(
        'blame.line',
        { repoId: deps.gitRepoId, path: deps.path, line },
        controller.signal,
      );
      cache.set(line, result);
      if (line === lastLine) paint(result);
    } catch {
      // 5b: an ABORTED request (cancelPending's own inFlight.abort(), or a fresh resolveLine for a
      // later line) is not a resolved miss — the cache's own doc comment says a cached `null` means
      // exactly that (untracked path, line past EOF, a genuine RPC error), never "we didn't wait to
      // find out". Caching it anyway combined with 5a's bug meant arrowing through lines faster than
      // responses land accumulated permanently blame-less lines that never retried, even on revisit.
      if (!controller.signal.aborted) cache.set(line, null);
      if (line === lastLine) paint(null);
    }
  }

  function refresh(): void {
    const line = editor.getPosition()?.lineNumber;
    // 5a: the `line === lastLine` early return must come BEFORE cancelPending — a same-line cursor
    // move (a horizontal arrow key, a column click, a reveal-selection) used to cancel the request
    // already running for THIS line before this check ever ran, and since lastLine already equalled
    // line, nothing restarted it: no annotation ever appeared for that line. This file's own nearby
    // comment already says the opposite is intended ("a horizontal cursor move must not re-fire").
    if (line === undefined || line === lastLine) return;
    cancelPending();
    lastLine = line;

    const cached = cache.get(line);
    if (cached !== undefined) {
      paint(cached);
      return;
    }
    paint(null); // clear any stale annotation from the previous line while this one resolves.
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void resolveLine(line);
    }, DEBOUNCE_MS);
  }

  const cursorSub = editor.onDidChangeCursorPosition(() => refresh());

  // §4.3: cheap to just re-resolve rather than narrow by `kind` — the same posture
  // `blameWidget.ts`'s own `notifyRepoChanged` takes. Clearing `lastLine` before calling
  // `refresh()` makes it re-trigger even though the cursor itself hasn't moved.
  const unsubscribeRepoChanged = deps.transport.on(
    'repo.changed',
    (event: EventPayload<'repo.changed'>) => {
      if (event.repoId !== deps.gitRepoId) return;
      cache.clear();
      lastLine = undefined;
      refresh();
    },
  );

  // §4.5: context-menu/keybinding route to the click-through — C11 §13's own precedent for why
  // this is an editor action and not a trusted-hover command link or a raw DOM click listener on
  // the injected text (§4.5's full reasoning).
  const revealAction = editor.addAction({
    id: 'kira.blame.revealCommit',
    label: 'Open Blame Commit in Graph',
    contextMenuGroupId: 'kiraBlame',
    run: () => {
      const line = editor.getPosition()?.lineNumber;
      const result = line === undefined ? undefined : cache.get(line);
      if (!result || result.sha === UNCOMMITTED_BLAME_SHA) return;
      revealBlameCommit(deps.gitRepoId, result.sha);
    },
  });

  refresh();

  return {
    dispose(): void {
      disposed = true;
      cancelPending();
      cursorSub.dispose();
      unsubscribeRepoChanged();
      revealAction.dispose();
      collection.clear();
      // 7d: this module is what leases deps.transport (gitTransportFor, called once per mount by
      // RepoFileView.vue's own syncBlameAnnotation) — nothing else holds a reference to release it,
      // so releasing it here is the only place that ever happens. unsubscribeRepoChanged above
      // already dropped this handle's own `on` subscription; dispose() only needs to release the
      // lease itself now.
      deps.transport.dispose();
    },
  };
}
