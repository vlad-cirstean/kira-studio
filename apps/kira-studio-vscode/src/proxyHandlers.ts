/**
 * The composition SPEC §5 items 2-4 describe (G3 plan D18): `app.init`/`repo.list`/`repo.pick`
 * answered locally, `graph.loadMore`/`graph.stream` get D6's `scope`/`pageSize` injected from the
 * current settings snapshot before forwarding, everything else forwards verbatim through
 * `ConnectionManager`. Written now, not in G1 — "a version of it that only forwards would be
 * replaced wholesale by G4" (G1 §5.5) — because G3 is the first phase with enough of the server
 * side (`app.init`'s real `git` status, `repo.list`/`repo.pick`'s own ports, `graph.*`) to make a
 * non-trivial composition worth writing once rather than twice.
 *
 * G4 (D11-D14) is the "wholesale replacement" G1 forecast: `clipboard.write`, `editor.openDiff`,
 * `editor.goToFile` and `editor.resolveConflict` stop forwarding and answer from the extension's
 * own already-migrated ports, `app.init`'s four capabilities flip to `true`, and `repo.open`/
 * `repo.close` grow a side effect — maintaining the `repoId -> root` map `editor.resolveConflict`
 * needs (D13, resolving F11: `RepoID` is only the worktree root for a non-bare repo, so a host
 * method may never `join(repoId, path)` directly).
 *
 * G6 (D13/D14) closes the last gap: `review.open` stops forwarding and reveals the review sidebar
 * locally — the seventh and last host-capability method — and `repo.list` reports a real
 * `activeRepoId` (the most recently opened repository on this extension host), the review view's
 * own first consumer.
 */
import { basename, join } from 'node:path';
import type {
  Clipboard,
  Dialogs,
  DocumentRef,
  EditorIntegration,
  FileChange,
  Logger,
  WorkspaceRoots,
} from '@kira/git-core';
import type {
  GitStatus,
  RequestHandler,
  RequestKey,
  ReviewSessionSnapshot,
  ServerHandlers,
  SettingsSnapshot,
} from '@kira/git-ipc';
import type { ConnectionManager } from './connection.ts';
import { goToFile } from './goToFile.ts';
import { virtualKey } from './virtualKey.ts';

// D11: the server contract's own app.init is the webview contract's AppInitResult minus host/
// settings/capabilities (SPEC §5 item 3 assigns those to the extension) — mirrors
// internal/gitrpc/wire.go's AppInitResult field for field, cast rather than trusted at the
// webview contract's own type the way extension.ts's own probe call already does.
interface ServerAppInitResult {
  readonly contractVersion: number;
  readonly serverVersion: string;
  readonly git: GitStatus;
}

/**
 * G19 D11b: the minimal shape this file needs from `context.workspaceState` — never
 * `vscode.Memento` itself, keeping this file vscode-free (its own doc comment, above: `revealReview`/
 * `renderReviewComments`/etc. are all plain-data callbacks for exactly this reason). VS Code's
 * real `Memento` satisfies this structurally (`get`'s single-argument overload, `update`'s
 * `Thenable<void>` return already assignable to `PromiseLike<void>`), so `extension.ts` passes
 * `context.workspaceState` straight through with no adapter — and `proxyHandlers.test.ts` (or its
 * own addition) can pass an in-memory `Map`-backed stub satisfying only this shape, no real
 * `vscode` import needed either side.
 */
export interface ReviewSessionStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** G19 D11b: what's actually stored per repoId — the wire's own `ReviewSessionSnapshot` plus the
 *  one field never sent over the wire, `savedAt` (`Date.now()` at save time), which is what
 *  `review.session.load`'s own 14-day TTL is measured against. */
type StoredReviewSession = ReviewSessionSnapshot & { readonly savedAt: number };

const REVIEW_SESSION_KEY = 'kiraVersion.review.session';
/** Matches G11's own `review.db` idle-purge window — reused for consistency (a "session-level
 *  resumption" concept), not re-derived from nothing. See the plan's own §2 D11b. */
const REVIEW_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface CreateProxyHandlersDeps {
  readonly connection: ConnectionManager;
  readonly settings: () => SettingsSnapshot;
  readonly roots: WorkspaceRoots;
  readonly dialogs: Dialogs;
  readonly clipboard: Clipboard;
  readonly editor: EditorIntegration;
  readonly logger: Logger;
  // G6/D15: reveals the review sidebar, optionally targeting repoId/branch — `review.open`'s own
  // implementation. Supplied as a plain function rather than a provider instance so this file
  // never imports vscode.WebviewViewProvider; extension.ts breaks the construction cycle (the
  // provider needs `handlers`, `handlers` needs this function) with a `let` binding.
  readonly revealReview: (repoId: string, branch: string) => void;
  // G13 D9: plain-data callbacks into reviewComments.ts's controller — kept as functions, not a
  // controller instance, for the same reason revealReview is: this file never imports `vscode`.
  // Called after editor.openRangeDiff opens the branch-tip side of a diff, so its comment threads
  // render immediately rather than waiting for onDidChangeVisibleTextEditors.
  readonly renderReviewComments: (
    repoId: string,
    branchTip: string,
    path: string,
    branch: string,
  ) => void;
  // Called after a webview-side review.comment.add/remove/clear succeeds, so an editor-side thread
  // never disagrees with a sidebar-side mutation — the reverse direction (editor -> sidebar) needs
  // a real event (`refreshReviewComments`, D19) since the webview has no socket of its own to watch.
  readonly notifyCommentsMutated: (repoId: string, branch: string) => void;
  // G15 D7/D11: reviewMarking.ts's controller is the vscode-facing layer — this file reaches it
  // only as these two plain-data callbacks, the same shape renderReviewComments/
  // notifyCommentsMutated already use, so this file never imports vscode (its own doc comment,
  // above). Called right after editor.openRangeDiff opens the branch-tip side of a diff, so its
  // decorations paint immediately rather than waiting for onDidChangeVisibleTextEditors.
  readonly refreshReviewMarking: (
    repoId: string,
    branchTip: string,
    path: string,
    branch: string,
  ) => void;
  // Called after a webview-side review.mark succeeds, so an editor-side decoration never disagrees
  // with a sidebar-side mark.
  readonly notifyReviewMarked: (repoId: string, branch: string, path: string) => void;
  // G19 D11b: review.session.save/.load's own durable store — see ReviewSessionStore's own doc
  // comment for why this is a narrow structural type, not vscode.Memento itself.
  readonly reviewSessionStore: ReviewSessionStore;
}

/**
 * G21 D12/D8: `commit.detail` -> `DocumentRef` derivation for one changed file's two sides,
 * factored out of `editor.openDiff`'s own handler so it can be shared verbatim by
 * `editor.openAllChanges` (D8) — the two handlers can never disagree about which side is
 * `{kind: 'empty'}` for an added/deleted file, or about which sha the right-hand document is
 * addressed against.
 */
function documentRefsFor(
  repoId: string,
  sha: string,
  path: string,
  change: FileChange,
  baseSha: string | null,
): { left: DocumentRef; right: DocumentRef } {
  const oldPath = change.originalPath ?? path;
  const left: DocumentRef =
    change.kind === 'added' || baseSha === null
      ? { kind: 'empty', label: basename(oldPath) }
      : { kind: 'virtual', key: virtualKey(repoId, baseSha, oldPath), label: basename(oldPath) };
  const right: DocumentRef =
    change.kind === 'deleted'
      ? { kind: 'empty', label: basename(path) }
      : { kind: 'virtual', key: virtualKey(repoId, sha, path), label: basename(path) };
  return { left, right };
}

/** G21 D12: fetches `sha`'s own `commit.detail` and looks `path` up in its file list — `undefined`
 *  (not a throw) when `path` is not one of that commit's changed files, so `editor.openDiff`'s own
 *  handler can try `fallbackSha` next without exception-driven control flow, and so a genuine RPC
 *  failure (as opposed to "wrong sha") still propagates as a real rejection rather than being
 *  silently swallowed into a fallback attempt. */
async function findChangeInDetail(
  connection: ConnectionManager,
  repoId: string,
  sha: string,
  path: string,
  parentIndex: number | undefined,
  signal: AbortSignal,
): Promise<{ readonly change: FileChange; readonly baseSha: string | null } | undefined> {
  const detail = await connection.request('commit.detail', { repoId, sha, parentIndex }, signal);
  const change = detail.files.find((f) => f.path === path);
  if (!change) return undefined;
  return { change, baseSha: detail.parents[detail.parentIndex] ?? null };
}

export function createProxyHandlers(deps: CreateProxyHandlersDeps): ServerHandlers {
  const {
    connection,
    settings,
    roots,
    dialogs,
    clipboard,
    editor,
    logger,
    revealReview,
    renderReviewComments,
    notifyCommentsMutated,
    refreshReviewMarking,
    notifyReviewMarked,
    reviewSessionStore,
  } = deps;

  function forward<K extends RequestKey>(method: K): RequestHandler<K> {
    return (params, ctx) => connection.request(method, params, ctx.signal);
  }

  // D13: repo.open's own result already carries the real worktree root (or "" for a bare repo,
  // which has no checkout and therefore no possible conflicted-file path); repo.close drops the
  // entry. editor.resolveConflict is this phase's one consumer — editor.goToFile needs no entry,
  // since file.goToTarget already returns absPath from the side that knows it.
  const repoRoots = new Map<string, string>();

  // G6 D14: the most recently successfully opened repository on this extension host — a fact
  // about this window, not about the backend, so it stays entirely extension-side. repo.list's
  // own first real consumer is the review view (ReviewView.vue): with no panel-supplied target
  // and no active repo id, the palette entry point can only render "no repository".
  let activeRepoId: string | null = null;

  const requests: ServerHandlers['requests'] = {
    // G12 D6: waits for the socket to actually be up rather than failing fast — a webview panel
    // opened before Kira Studio's handshake completes (the ordinary case, not an edge case) used
    // to reject instantly and permanently (F7); now it just takes as long as the connection does.
    'app.init': async (_params, ctx) => {
      await connection.whenConnected(ctx.signal);
      const raw = await connection.request('app.init', {}, ctx.signal);
      const server = raw as unknown as ServerAppInitResult;
      return {
        host: 'vscode',
        contractVersion: server.contractVersion,
        settings: settings(),
        git: server.git,
        // D11: all four host ports are constructed and all four methods now answer.
        capabilities: {
          openInEditor: true,
          goToFile: true,
          clipboard: true,
          resolveConflict: true,
        },
      };
    },
    'repo.list': async () => {
      const candidates = await roots.list();
      return { candidates, activeRepoId };
    },
    'repo.pick': async () => {
      const path = await dialogs.pickFolder({ title: 'Open Repository' });
      return { path };
    },
    'repo.open': async (params, ctx) => {
      const result = await connection.request('repo.open', params, ctx.signal);
      if (result.kind === 'ok') {
        repoRoots.set(result.repo.repoId, result.repo.root);
        activeRepoId = result.repo.repoId;
      }
      return result;
    },
    'repo.close': async (params, ctx) => {
      repoRoots.delete(params.repoId);
      if (activeRepoId === params.repoId) {
        activeRepoId = null;
      }
      return connection.request('repo.close', params, ctx.signal);
    },
    'graph.status': forward('graph.status'),
    // G18 D6: scope/pageSize are no longer injected here — a raw request omitting them now
    // resolves this repo's own stored kiraVersion.graph.* settings server-side (the per-repo
    // dialog's own storage), the exact upgrade D6 describes. Wire shape unchanged.
    'graph.loadMore': forward('graph.loadMore'),
    'graph.refresh': forward('graph.refresh'),
    'commit.detail': forward('commit.detail'),
    'commit.fileDiff': forward('commit.fileDiff'),
    // D12: composed from commit.detail (server-cached, D7) rather than a separate fileDiff fetch
    // — a whole patch is never re-shipped just to read baseSha/change off it.
    //
    // G21 D12: gains `fallbackSha` — the stash tree's own need (F12). A stash's `-u` untracked
    // files live only in its third parent (`entry.untrackedSha`), which has no `baseSha` of its
    // own composed against the stash's real `sha`; when `path` is not among `sha`'s own changed
    // files and a `fallbackSha` was given, the whole composition is retried against it before
    // giving up — a direct mirror of the retry `state/stash.ts` already implemented for the
    // now-deleted in-webview diff path (`commit.fileDiff`), moved to the one place that now
    // needs it. Absent `fallbackSha` throws exactly as this always has.
    //
    // G21 D13: `pinned` reaches `editor.openDiff` (the port) unchanged — `undefined`/`false`
    // both mean "preview" (never a silent pin): only an explicit `true` pins.
    'editor.openDiff': async ({ repoId, sha, path, parentIndex, pinned, fallbackSha }, ctx) => {
      let found = await findChangeInDetail(connection, repoId, sha, path, parentIndex, ctx.signal);
      let effectiveSha = sha;
      if (!found && fallbackSha !== undefined) {
        found = await findChangeInDetail(
          connection,
          repoId,
          fallbackSha,
          path,
          parentIndex,
          ctx.signal,
        );
        effectiveSha = fallbackSha;
      }
      if (!found) {
        throw new Error(`editor.openDiff: ${path} is not one of commit ${sha}'s changed files`);
      }
      const { baseSha, change } = found;
      const { left, right } = documentRefsFor(repoId, effectiveSha, path, change, baseSha);

      const shortSha = effectiveSha.slice(0, 7);
      await editor.openDiff({
        left,
        right,
        title: `${basename(path)} (${shortSha}^ ↔ ${shortSha})`,
        pinned: pinned === true,
      });
      return {};
    },
    // G12 D1/D12, reshaped G13 D8: the review sidebar's own diff request — a two-revision
    // comparison for one path, not one commit's parent-child pair, so it cannot reuse
    // editor.openDiff's commit.detail composition. `status` (from review.files, the caller) says
    // which side has no blob rather than this handler re-deriving it with a second round trip.
    //
    // G13 D8: both sides are now sha-addressed (never `branch` itself) — `leftRev` is always a
    // commit sha (the merge base in `range` mode, `reviewedAtSha` in `sinceReview` mode), and the
    // right-hand document carries `branch` as its virtual key's fourth field, marking it as that
    // branch's tip and therefore commentable (`reviewComments.ts`).
    'editor.openRangeDiff': async ({
      repoId,
      branch,
      branchTip,
      leftRev,
      leftLabel,
      path,
      originalPath,
      status,
      pinned,
    }) => {
      const oldPath = originalPath ?? path;
      const left: DocumentRef =
        status === 'added'
          ? { kind: 'empty', label: basename(oldPath) }
          : {
              kind: 'virtual',
              key: virtualKey(repoId, leftRev, oldPath),
              label: basename(oldPath),
            };
      const right: DocumentRef =
        status === 'deleted'
          ? { kind: 'empty', label: basename(path) }
          : {
              kind: 'virtual',
              key: virtualKey(repoId, branchTip, path, branch),
              label: basename(path),
            };
      await editor.openDiff({
        left,
        right,
        title: `${basename(path)} (${leftLabel} ↔ ${branch})`,
        pinned: pinned === true,
      });
      // G13 D9: the right-hand document is the only commentable side (status !== 'deleted') — its
      // threads render now rather than waiting for onDidChangeVisibleTextEditors.
      // G15 D7: same reason, same seam, for the range-marking decorations.
      if (status !== 'deleted') {
        renderReviewComments(repoId, branchTip, path, branch);
        refreshReviewMarking(repoId, branchTip, path, branch);
      }
      return {};
    },
    // G21 D8: placeholder — the real vscode.changes-probing/sequenced-fallback implementation
    // lands in its own commit, after D13 (they share this CONTRACT_VERSION 24 bump and the
    // DetailActions shape). Typed and reachable now only because the contract type requires every
    // ServerHandlers key to have an implementation.
    'editor.openAllChanges': () => {
      throw new Error('editor.openAllChanges: not implemented yet (lands in G21 D8)');
    },
    // D4/D11: the server resolves the on-disk-vs-object-database decision and (for a live file)
    // the drift hunks; the line arithmetic itself stays here, over @kira/git-core's already-tested
    // mapLineAcrossDiff — never a second, unproven Go implementation of the same trickiest math.
    // G14 D9: the body itself now lives in diffToolbar.ts's exported `goToFile`, shared with the
    // diff editor's own "Go to file" toolbar button — this handler is a one-line call to it.
    'editor.goToFile': (params, ctx) => goToFile({ connection, editor }, params, ctx.signal),
    'clipboard.write': async ({ text, label }) => {
      try {
        await clipboard.writeText(text);
      } catch (err) {
        // Never the text itself (§6.4) — only the label, which is what the log line needs to be
        // useful without ever risking a whole commit message or file path in a log file.
        logger.log('warn', 'clipboard.write failed', { label, err: String(err) });
        throw err; // propagates so toWireError carries the reason to the UI — silence is the one
        // unacceptable outcome here.
      }
      logger.log('debug', 'clipboard.write', { label });
      return {};
    },
    'refs.list': forward('refs.list'),
    'status.get': forward('status.get'),
    'preflight.checkout': forward('preflight.checkout'),
    'preflight.revert': forward('preflight.revert'),
    'op.run': forward('op.run'),
    'undo.peek': forward('undo.peek'),
    'undo.run': forward('undo.run'),
    // D13: an absolute path over the repo's own root — never repoId, which is only the root for a
    // non-bare repo (F11) — refused with a clear error when the repo is unknown or bare (a bare
    // repo has no checkout and therefore cannot have a conflicted file at all).
    'editor.resolveConflict': async ({ repoId, path }) => {
      const root = repoRoots.get(repoId);
      if (!root) {
        throw new Error(
          `editor.resolveConflict: repo ${repoId} has no known worktree root (not open, or bare)`,
        );
      }
      await editor.resolveConflict({ path: join(root, path) });
      return {};
    },
    // G18 D6: baseCandidates is no longer injected here — a raw request omitting it now resolves
    // this repo's own stored kiraVersion.review.baseCandidates server-side. Wire shape unchanged.
    'review.resolveBase': forward('review.resolveBase'),
    // D13: the seventh and last host-capability method — a host action (reveal a VS Code view),
    // answered locally rather than forwarded. The server has no review.open case and answers
    // E_UNKNOWN_METHOD for anything that reaches it there.
    'review.open': async ({ repoId, branch }) => {
      revealReview(repoId, branch);
      return {};
    },
    // G11 D1/§4.3: forwarded verbatim — none of the three is a host capability, and the seventh
    // and last of those was closed above (review.open).
    'review.files': forward('review.files'),
    'review.fileDiff': forward('review.fileDiff'),
    // G15 D7: a webview-side mark (the sidebar's whole-file toggle) also refreshes every editor
    // decoration tracked for the same (repoId, branch, path) — the exact shape review.comment.add/
    // remove/clear already have below.
    'review.mark': async (params, ctx) => {
      const result = await connection.request('review.mark', params, ctx.signal);
      notifyReviewMarked(params.repoId, params.branch, params.path);
      return result;
    },
    'review.comment.list': forward('review.comment.list'),
    'review.comment.export': forward('review.comment.export'),
    // G13 D9: a webview-side add/remove/clear also re-renders every currently-tracked document
    // belonging to (repoId, branch) — the editor's own threads must never disagree with a mutation
    // the sidebar just made, and the reverse direction (editor -> sidebar) is `refreshReviewComments`
    // (D19), not this.
    'review.comment.add': async (params, ctx) => {
      const result = await connection.request('review.comment.add', params, ctx.signal);
      notifyCommentsMutated(params.repoId, params.branch);
      return result;
    },
    'review.comment.remove': async (params, ctx) => {
      const result = await connection.request('review.comment.remove', params, ctx.signal);
      notifyCommentsMutated(params.repoId, params.branch);
      return result;
    },
    'review.comment.clear': async (params, ctx) => {
      const result = await connection.request('review.comment.clear', params, ctx.signal);
      notifyCommentsMutated(params.repoId, params.branch);
      return result;
    },
    // G18 D6/F14: strategySetting is no longer injected here — a raw request omitting it now
    // resolves this repo's own stored kiraVersion.pull.strategy server-side, the same upgrade D6
    // already gives graph.loadMore/graph.stream/review.resolveBase. Wire shape unchanged.
    'remote.pullPreflight': forward('remote.pullPreflight'),
    'remote.pushPreflight': forward('remote.pushPreflight'),
    'remote.run': forward('remote.run'),
    'remote.cancel': forward('remote.cancel'),
    // G7 D4/§4.2: credential.provide is answered by the extension's own credential relay
    // (extension.ts), never proxied from the webview — the webview must never be able to answer a
    // credential prompt. ServerHandlers.requests is total over RequestKey, so this key still needs
    // an entry; a thrown handler is the way to say "impossible from here" in a total map, the same
    // shape editor.resolveConflict's own G4 precedent uses for a genuinely unreachable call.
    'credential.provide': () => {
      throw new Error(
        'credential.provide is answered by the extension, never proxied from the webview',
      );
    },
    'stash.list': forward('stash.list'),
    'stash.show': forward('stash.show'),
    'preflight.stashPop': forward('preflight.stashPop'),
    'preflight.stashBranch': forward('preflight.stashBranch'),
    'preflight.reset': forward('preflight.reset'),
    'preflight.cherryPick': forward('preflight.cherryPick'),
    'search.run': forward('search.run'),
    // G4 D3/F12: server-only, never called by the webview — plain forwarders are enough
    // (ServerHandlers.requests is total over RequestKey, so both need an entry regardless).
    'file.read': forward('file.read'),
    'file.goToTarget': forward('file.goToTarget'),
    // G18 D4: the per-repo settings dialog's own two requests — plain forwards, same as every
    // other repoId-addressed request; the server is the sole owner of this storage.
    'repoSettings.get': forward('repoSettings.get'),
    'repoSettings.set': forward('repoSettings.set'),
    // G18 D11: the migration's own git.path leg — called only by extension.ts's own one-time
    // migration routine, never proxied from the webview (ServerHandlers.requests is total over
    // RequestKey, so this key still needs an entry; a thrown handler is the same "impossible from
    // here" shape credential.provide's own precedent already uses).
    'settings.setGitPath': () => {
      throw new Error(
        'settings.setGitPath is called by the extension’s own migration routine, never proxied from the webview',
      );
    },
    // G19 D11b: a pure, local write — never reaches the Go backend, exactly like editor.openDiff
    // itself never does for its own local concerns. `session: null` clears repoId's own stored
    // entry (sent by ReviewSessionState.clearTarget(), D11a) so an explicit "go back" never
    // leaves a stale resume-point the next cold boot would silently jump back into.
    'review.session.save': async ({ repoId, session }) => {
      const current =
        reviewSessionStore.get<Record<string, StoredReviewSession | undefined>>(
          REVIEW_SESSION_KEY,
        ) ?? {};
      await reviewSessionStore.update(REVIEW_SESSION_KEY, {
        ...current,
        [repoId]: session === null ? undefined : { ...session, savedAt: Date.now() },
      });
      return {};
    },
    // G19 D11b: no commit/diff data is ever restored — only the identifiers `setTarget`/`setBase`
    // already re-ask fresh on every call, so a stale *resolution* can never be served; a snapshot
    // older than REVIEW_SESSION_TTL_MS is treated as expired (a session-level TTL, matching G11's
    // own review.db idle-purge number) and answered the same as "never saved".
    'review.session.load': async ({ repoId }) => {
      const all =
        reviewSessionStore.get<Record<string, StoredReviewSession | undefined>>(
          REVIEW_SESSION_KEY,
        ) ?? {};
      const entry = all[repoId];
      if (!entry || Date.now() - entry.savedAt > REVIEW_SESSION_TTL_MS) return { session: null };
      const { savedAt: _savedAt, ...session } = entry;
      return { session };
    },
  };

  const streams: ServerHandlers['streams'] = {
    // G18 D6: scope/pageSize are no longer injected here — see graph.loadMore's own comment
    // above; the same upgrade applies to the streaming request.
    'graph.stream': (params, ctx) =>
      connection.stream('graph.stream', params, (chunk) => ctx.emit(chunk), ctx.signal),
  };

  return { requests, streams };
}
