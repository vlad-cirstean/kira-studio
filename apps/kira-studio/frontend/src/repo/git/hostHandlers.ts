/**
 * C10 §5 (S11) — the native counterpart to `apps/kira-studio-vscode/src/proxyHandlers.ts`'s local
 * arm: the handful of methods this host answers itself rather than forwarding over the git
 * stream. `transport.ts` (S12) is the thing that actually decides "local or forward" per request;
 * this file only supplies the local side, keyed by method name and total over nothing — an absent
 * key here means "forward", which is `transport.ts`'s own correct default (a method a later
 * contract version adds is forwarded, never silently dropped).
 *
 * §5.1's identity trap, read literally: `CodeRepo.ID` (`code_repos.id`, what every native tab/
 * workspace call speaks) and `gitclient.RepoSummary.RepoID` (what `git-ui`/every `gitrpc` method
 * speaks) are never equal and never interchangeable. `gitRepoIdFor`/`codeRepoIdFor` are the only
 * mapping this app has — both over `codeReposState.records`, both returning `undefined` on a
 * miss rather than guessing, exact rather than heuristic because `RepoSummary.repoId` is already
 * stored from the same `gitclient.Identify` call `repo.open` itself runs (C5's import).
 */
import { mapLineAcrossDiff } from '@kira/git-core';
import type {
  EventKey,
  EventPayload,
  FileChange,
  GitStatus,
  ParamsOf,
  RequestKey,
  ResultOf,
  ReviewSessionSnapshot,
  Transport,
} from '@kira/git-ipc';
import { control } from '../../bridge/control';
import { codeRepoRecord, codeReposState } from '../../state/coderepos';
import { layoutState, toggleProjectPanel } from '../../state/layout';
import {
  openRepoCommitDiffTab,
  openRepoDiffTab,
  openRepoFileTab,
  openRepoReviewDiffTab,
} from '../../state/repoTabs';
import { activateTab } from '../../state/tabs';
import { setRepoSearchView } from '../state/search';
import { loadReviewSession, pinnedGraphTabId, saveReviewSession } from './reviewSession';

// C11 §8.2/§8.4 (S13): review.open's own cold-mount hand-off. The local event bus (S4) only
// reaches a `transport.on('review.target', ...)` subscriber that already exists — a first-ever
// activation of the Review segment mounts ReviewView.vue AFTER review.open has already fired (the
// segment switch below triggers a Vue re-render, which runs on the next tick, by which time this
// synchronous handler has already returned), so the event it emits would otherwise be dropped on
// the floor. RepoReviewView.vue's own mount (S13) consumes this once, as `MountOptions.target`,
// exactly the role `panelView.ts`'s own bootstrap-island `#pendingUiAction` plays for the graph.
const pendingReviewTargetByCodeRepoId = new Map<string, { repoId: string; branch: string }>();

/** Consumed once — a later mount of the same segment (switch to Files and back, no new
 *  review.open in between) starts on whatever branch ReviewView.vue was already showing, which is
 *  its own state (`state/review.ts`) to keep, not a second stale target this would otherwise keep
 *  handing back. */
export function takePendingReviewTarget(
  codeRepoId: string,
): { repoId: string; branch: string } | null {
  const target = pendingReviewTargetByCodeRepoId.get(codeRepoId) ?? null;
  pendingReviewTargetByCodeRepoId.delete(codeRepoId);
  return target;
}

// P62 §4.5: the blame annotation's own click-through ("Open Blame Commit in Graph") hits the
// identical race — a repo-file tab can be active before the pinned graph tab has ever mounted, so
// emitting `ui.action` straight onto the transport would have nothing listening. Mirrors
// `pendingReviewTargetByCodeRepoId` above exactly: stashed here, consumed once by
// `RepoGraphView.vue`'s own mount as `MountOptions.pendingUiAction`. P75 §2.3:
// the review row's "Open in graph" (`graph.revealCommit`, below) hits the same race and shares
// this one stash rather than a second copy of it.
const pendingBlameRevealByCodeRepoId = new Map<string, { repoId: string; sha: string }>();

// P75 §2.3: no longer exported — blameAnnotation.ts's own revealBlameCommit is gone, replaced by
// one `graph.revealCommit` request this file now answers itself (below), reusing this same stash.
function stashPendingBlameReveal(
  codeRepoId: string,
  target: { repoId: string; sha: string },
): void {
  pendingBlameRevealByCodeRepoId.set(codeRepoId, target);
}

/** Consumed once — a later remount of the graph tab (switch away and back, no new reveal in
 *  between) starts wherever the graph already was, not replaying a stale target. */
export function takePendingBlameReveal(codeRepoId: string): { repoId: string; sha: string } | null {
  const target = pendingBlameRevealByCodeRepoId.get(codeRepoId) ?? null;
  pendingBlameRevealByCodeRepoId.delete(codeRepoId);
  return target;
}

/** git's own well-known empty-tree object id — `<sha>:<path>` against it always resolves to
 *  `file.read`'s existing `{kind: 'missing'}` classification (the path never existed in an empty
 *  tree), which is exactly the rendering a root commit's added file needs on its left side. Used
 *  instead of a `null` "left" revision so `repoDiffTabStateSchema`'s own `left === null` sentinel
 *  stays reserved for C6's HEAD-vs-worktree comparison alone — a commit diff, root commit
 *  included, always supplies a real (if synthetic) left revision. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `code_repos.id` -> the git `repoId` git-ui and every `gitrpc` method actually speak, or
 *  `undefined` if this app has no record of that repository (never guessed). */
export function gitRepoIdFor(codeRepoId: string): string | undefined {
  return codeRepoRecord(codeRepoId)?.repoId;
}

/** The reverse of `gitRepoIdFor` — a git `repoId` (from an inbound `editor.*` request's own
 *  params) back to the `code_repos.id` every native tab/workspace call needs, or `undefined`. */
export function codeRepoIdFor(gitRepoId: string): string | undefined {
  return codeReposState.records.find((r) => r.repoId === gitRepoId)?.id;
}

// D11's own shape, ported: the Go server's real app.init result is only these three fields
// (handlers.go's handleAppInit) — host/settings/capabilities are composed entirely host-side
// (S3's own doc comment: neither crosses the Go wire). Contract['app.init']['result'] describes
// the *client-visible* shape after that composition, which is why this is its own narrower local
// type rather than trusting ResultOf<'app.init'> for what the raw stream actually returns — the
// exact same move proxyHandlers.ts's own ServerAppInitResult makes for the identical reason.
interface ServerAppInitResult {
  readonly contractVersion: number;
  readonly serverVersion: string;
  readonly git: GitStatus;
}

async function findChangeInDetail(
  remoteRequest: Transport['request'],
  gitRepoId: string,
  sha: string,
  path: string,
  parentIndex: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ readonly change: FileChange; readonly baseSha: string | null } | undefined> {
  const detail = await remoteRequest(
    'commit.detail',
    { repoId: gitRepoId, sha, parentIndex },
    signal,
  );
  const change = detail.files.find((f) => f.path === path);
  if (!change) return undefined;
  return { change, baseSha: detail.parents[detail.parentIndex] ?? null };
}

export interface HostHandlersDeps {
  /** The underlying git-stream transport's own `request` — the one seam this file needs to reach
   *  the Go server for `app.init`'s base fields and `editor.openDiff`'s `commit.detail` lookup.
   *  Never the split `Transport` `transport.ts` builds around this file (that would be circular);
   *  `transport.ts` constructs the remote client first and passes its `request` in here. */
  readonly remoteRequest: Transport['request'];
  /** This transport's own repo workspace — `code_repos.id`, never the git repoId — so
   *  `repo.list`'s `activeRepoId` can report which repository this particular mounted graph is
   *  for (one transport per repo workspace, §8). */
  readonly codeRepoId: string;
  /** C11 §8.1: this transport's own local event emitter — `review.open`'s handler is the one host
   *  handler that pushes an event with no caller needing to know whether anything was listening.
   *  P75 §2.3: typed `boolean`, matching `transport.ts`'s own `local.emit` (returning since P68) —
   *  `graph.revealCommit`'s handler needs that to decide between "delivered live" and "stash for
   *  the next cold mount", the same distinction the blame-reveal handler this absorbs already
   *  needed. */
  readonly emitLocal: <K extends EventKey>(method: K, payload: EventPayload<K>) => boolean;
}

type HostHandler<K extends RequestKey> = (
  params: ParamsOf<K>,
  signal?: AbortSignal,
) => Promise<ResultOf<K>>;

/** Partial, not total (unlike `ServerHandlers`) — an absent key here means "forward", the correct
 *  default for a method this file has simply never heard of, never a silently dropped one. */
export type HostHandlers = Partial<{ [K in RequestKey]: HostHandler<K> }>;

// 8b (P68 review): named readOnlyRefusal until this rename — a boundary (a3753dd5 deliberately
// purged "read-only" wording from gitstream.go's own comments) that no longer applies to any of
// this function's 4 call sites below, each of which refuses for an unrelated reason (no native
// caller, needs a merge editor, no native meaning).
function refuseLocally<K extends RequestKey>(method: K, reason: string): HostHandler<K> {
  return async () => {
    throw new Error(`hostHandlers: ${method} ${reason}`);
  };
}

export function createHostHandlers(deps: HostHandlersDeps): HostHandlers {
  return {
    'app.init': async (_params, signal) => {
      const server = (await deps.remoteRequest(
        'app.init',
        {},
        signal,
      )) as unknown as ServerAppInitResult;
      return {
        host: 'kira',
        contractVersion: server.contractVersion,
        // G14 D6's own VS Code "workbench.tree.indent" mirror has no native equivalent — 8 is
        // VS Code's own default (the same literal codec.test.ts's own fixture uses), which is all
        // git-ui's file tree actually needs: a plausible indent, not a live-synced setting.
        settings: { 'workbench.tree.indent': 8 },
        git: server.git,
        capabilities: {
          openInEditor: true,
          goToFile: true,
          clipboard: true,
          // This app has no merge editor — the user's own stated carve-out
          // (docs/v1.6/plans/P67e-git-relax-read-only.md): conflicts surface through the
          // conflict banner instead, resolved in the user's own external editor. Layer 2
          // (editor.resolveConflict throwing, below) covers it regardless.
          resolveConflict: false,
          // "Open in New Window" (vscode.openFolder) has no native meaning: there is no second
          // window to open a worktree into. worktree.openWindow throws below regardless
          // (layer 2).
          openWorktreeWindow: false,
          // Running the worktree prepare script is arbitrary shell execution with no
          // human-approval gate anywhere in this codebase — a security boundary, not a
          // file-editing one, so it stays refused even though write is now true.
          runPrepareScript: false,
          // P67e: the native mount now admits every git operation that writes through git
          // itself (fetch/pull/push/force-push, merge/rebase as pull strategies, undo, restack,
          // stash, worktree add/remove) — this is the one flag the UI actually branches on to
          // show every such write affordance uniformly.
          write: true,
          // P74 §3.3: GitHubService.OpenPullRequestURL/BrowserManager.OpenURL always exists.
          openExternal: true,
        },
      };
    },

    // Bug fix (live-reported): one transport is already bound to exactly one repo workspace
    // (this file's own class doc comment, "one transport per repo workspace") — unlike VS Code's
    // multi-root case candidates/activeRepoId were designed for, there is no real ambiguity to
    // resolve here. Returning every imported repo made `App.vue`'s bootstrap() candidates loop
    // (which tries each in import order and stops at the first that opens, never reading
    // activeRepoId) open whichever repo was imported first, not this transport's own — the graph
    // appeared "stuck" on that first repo whenever a different repo's tab mounted for the first
    // time. Scoping candidates to this transport's own repo makes the loop open the right one
    // unconditionally, with no change needed to the shared (VS Code too) bootstrap logic itself.
    'repo.list': async () => {
      const own = codeRepoRecord(deps.codeRepoId);
      const candidates = own ? [{ path: own.root, label: own.name }] : [];
      return { candidates, activeRepoId: gitRepoIdFor(deps.codeRepoId) ?? null };
    },

    // §6.1: extends repo-diff (S8's revision pair) rather than forking it. `editor.openAllChanges`
    // below shares this same composition per file.
    'editor.openDiff': async (params, signal) => {
      const { repoId: gitRepoId, sha, path, parentIndex, pinned, fallbackSha } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.openDiff: unknown git repoId ${gitRepoId}`);
      }
      let found = await findChangeInDetail(
        deps.remoteRequest,
        gitRepoId,
        sha,
        path,
        parentIndex,
        signal,
      );
      let effectiveSha = sha;
      if (!found && fallbackSha !== undefined) {
        found = await findChangeInDetail(
          deps.remoteRequest,
          gitRepoId,
          fallbackSha,
          path,
          parentIndex,
          signal,
        );
        effectiveSha = fallbackSha;
      }
      if (!found) {
        throw new Error(
          `hostHandlers: editor.openDiff: ${path} is not one of commit ${sha}'s changed files`,
        );
      }
      const leftRev = found.baseSha ?? EMPTY_TREE_SHA;
      const leftLabel = found.baseSha ? found.baseSha.slice(0, 7) : 'empty tree';
      const rightLabel = effectiveSha.slice(0, 7);
      // C5's preview/permanent split (§6.1): pinned:false is C5's own default preview slot;
      // only an explicit true pins.
      openRepoCommitDiffTab(
        codeRepoId,
        path,
        leftRev,
        effectiveSha,
        { left: leftLabel, right: rightLabel },
        pinned === true,
      );
      return {};
    },

    // §6.1: "N tabs instead" of a single multi-diff editor (§13) — the native workspace has none.
    // Always mode: 'tabs', matching detailActions.ts's own existing result shape (`:54`).
    'editor.openAllChanges': async (params, signal) => {
      const { repoId: gitRepoId, sha, parentIndex } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        return { opened: 0, failed: 0, mode: 'tabs' };
      }
      const detail = await deps.remoteRequest(
        'commit.detail',
        { repoId: gitRepoId, sha, parentIndex },
        signal,
      );
      const baseSha = detail.parents[detail.parentIndex] ?? null;
      const leftRev = baseSha ?? EMPTY_TREE_SHA;
      const leftLabel = baseSha ? baseSha.slice(0, 7) : 'empty tree';
      const rightLabel = sha.slice(0, 7);
      // P74 §5.2: every changed file opens as a preview tab, not a permanent one (`pinned:
      // true`'s own comment before this covered only "N tabs instead of one multi-diff editor",
      // never "as preview tabs" — this repo's own git blame at 3e9a9a7a shows it was never
      // revisited once the preview cohort existed to ask for). The first file (no `previewCohort`)
      // evicts whatever preview cohort/slot preceded it; every file after that joins the cohort
      // the first one just started, rather than each replacing the last (`openTab`'s own
      // `previewCohort` doc comment).
      detail.files.forEach((change, index) => {
        openRepoCommitDiffTab(
          codeRepoId,
          change.path,
          leftRev,
          sha,
          { left: leftLabel, right: rightLabel },
          false,
          index > 0,
        );
      });
      return { opened: detail.files.length, failed: 0, mode: 'tabs' };
    },

    // §6.3: exactly C6's own comparison — no revision fields, no new code path.
    'editor.openWorkingDiff': async (params) => {
      const { repoId: gitRepoId, path } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.openWorkingDiff: unknown git repoId ${gitRepoId}`);
      }
      openRepoDiffTab(codeRepoId, path);
      return {};
    },

    'clipboard.write': async ({ text }) => {
      await navigator.clipboard.writeText(text);
      return {};
    },

    // C11 §8.2/§7.5: the review sidebar's own diff request — a two-revision comparison, not one
    // commit's parent-child pair. `right` is always `branchTip` and `left` is always `leftRev`
    // (the merge base in range mode, the file's own reviewedAtSha in sinceReview mode, §7.2) —
    // neither `status` nor `originalPath` need special-casing here the way the extension's own
    // handler needs them: `file.read` already answers `{kind: 'missing'}` for a path that does not
    // exist at a given revision (an added file's left side, a deleted file's right side) rather
    // than erroring, and RepoDiffView.vue's existing toDiffSide already renders that as empty
    // content — a deleted file's diff comes out as a pure "left revision, read-only" (all
    // deletions, nothing added), matching the file.read classification C6 already renders, with no
    // new branch. (A renamed file's left-side read against the new `path` at the old revision has
    // the same gap openRepoCommitDiffTab already has — out of this phase's scope, not a
    // regression.)
    'editor.openRangeDiff': async (params) => {
      const { repoId: gitRepoId, branch, branchTip, leftRev, leftLabel, path, pinned } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.openRangeDiff: unknown git repoId ${gitRepoId}`);
      }
      openRepoReviewDiffTab(
        codeRepoId,
        path,
        leftRev,
        branchTip,
        { left: leftLabel, right: branch },
        { branch, branchTip, leftLabel },
        pinned === true,
      );
      return {};
    },

    // C11 §8.2/§5.3: the panel webview's own entry point — reveal the review segment on this
    // branch. `repo/state/search.ts` is the existing native precedent for "which segment of the
    // panel is active" (Files/Search, C7 D9); `review` joins it as this phase's third value (S14
    // builds the panel's own template branch for it). Always ensures the panel itself is visible —
    // a collapsed panel showing "Review branch changes" doing nothing would be a worse experience
    // than the affordance not existing.
    'review.open': async ({ repoId: gitRepoId, branch }) => {
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: review.open: unknown git repoId ${gitRepoId}`);
      }
      pendingReviewTargetByCodeRepoId.set(codeRepoId, { repoId: gitRepoId, branch });
      setRepoSearchView(codeRepoId, 'review');
      if (!layoutState.panel.project.visible) toggleProjectPanel();
      deps.emitLocal('review.target', { repoId: gitRepoId, branch });
      return {};
    },

    // P75 §2.3: the review row's own "Open in graph" — replaces the old VS Code-only `command:`
    // URI anchor. Absorbs P62 §4.5's blameAnnotation.ts::revealBlameCommit body verbatim (this
    // file already owns the pending-reveal map that logic stashes into): emit live first, stash
    // only if nothing was listening (Group 6, P68 review — stashing unconditionally left a
    // pending entry no mount ever consumed, replaying a stale target on the graph tab's next
    // remount). `revealed: false` for a codeRepoId or graph-tab miss is a real answer, not a stub
    // — the caller announces it.
    'graph.revealCommit': async ({ repoId: gitRepoId, sha }) => {
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) return { revealed: false };
      const graphTabId = pinnedGraphTabId(codeRepoId);
      if (!graphTabId) return { revealed: false };
      const target = { repoId: gitRepoId, sha };
      if (!deps.emitLocal('ui.action', { action: 'revealCommit', target })) {
        stashPendingBlameReveal(codeRepoId, target);
      }
      activateTab(graphTabId);
      return { revealed: true };
    },

    // C11 §8.3: answered entirely inside this host, never reaching Go (§3.3) — the durable half of
    // "back to branch selection", through the pinned repo-graph tab's own state
    // (`repo/git/reviewSession.ts`). A codeRepoId miss (repository not open in this window) is a
    // silent no-op for save (nothing to persist through) and answers `session: null` for load
    // (nothing to resume), the same posture reviewSession.ts's own functions take.
    'review.session.save': async ({ repoId: gitRepoId, session }) => {
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId !== undefined) saveReviewSession(codeRepoId, session);
      return {};
    },
    'review.session.load': async ({ repoId: gitRepoId }) => {
      const codeRepoId = codeRepoIdFor(gitRepoId);
      const session = codeRepoId === undefined ? null : loadReviewSession(codeRepoId);
      return { session: session as ReviewSessionSnapshot | null };
    },

    // P74 §3.3: requests pr.browserUrl over the git socket, then hands the URL (when non-null) to
    // GitHubService.OpenPullRequestURL — the one Go-side path that ever opens the OS browser. A
    // null url (github disabled, or no GitHub remote) is a silent no-op: the caller already gated
    // the button on this very lookup resolving in the first place.
    'pr.openExternal': async ({ repoId, number }, signal) => {
      const result = await deps.remoteRequest('pr.browserUrl', { repoId, number }, signal);
      if (result.url !== null) await control.githubOpenPullRequestUrl(result.url);
      return {};
    },

    // P79 finding 4: linkify.ts's own message-body URL, opened through LinkService.OpenExternal
    // — the same "one Go-side path that ever opens the OS browser" shape pr.openExternal above
    // uses, except this URL is untrusted renderer-visible content already (the commit message
    // itself), so Go-side validation checks the URL's own shape, never a known-host allowlist.
    // Answered entirely here (no repoId, no socket round trip) rather than forwarded — Go's
    // gitrpc has no case for it at all.
    'link.openExternal': async ({ url }) => {
      await control.linkOpenExternal(url);
      return {};
    },

    // P74 §7.2: file.goToTarget (Go-served) already resolves the live-vs-historical decision;
    // this handler only composes its three outcomes onto the tab helpers this file already
    // imports. `mapLineAcrossDiff` is `goToFile.ts`'s own algorithm (G4 D11) — reused verbatim,
    // never re-derived.
    'editor.goToFile': async (params, signal) => {
      const { repoId: gitRepoId, rev, path, line } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.goToFile: unknown git repoId ${gitRepoId}`);
      }
      const target = await deps.remoteRequest(
        'file.goToTarget',
        { repoId: gitRepoId, rev, path },
        signal,
      );
      switch (target.kind) {
        case 'live': {
          const finalLine =
            target.hunks !== null ? mapLineAcrossDiff(target.hunks, line, 'old') : line;
          openRepoFileTab(codeRepoId, path, { preview: true, reveal: { line: finalLine } });
          return { kind: 'liveFile', path, line: finalLine };
        }
        case 'historical': {
          openRepoFileTab(codeRepoId, target.path, {
            preview: true,
            rev: target.rev,
            reveal: { line },
          });
          return { kind: 'virtualBlob', path: target.path, rev: target.rev, line };
        }
        case 'unavailable':
          return target;
      }
    },

    'editor.resolveConflict': refuseLocally(
      'editor.resolveConflict',
      'needs a merge editor this window does not have; resolve the files in your own editor, then Continue',
    ),
    'settings.setGitPath': refuseLocally(
      'settings.setGitPath',
      "writes the global git path, which this app's own Settings dialog already owns",
    ),
    'worktree.openWindow': refuseLocally(
      'worktree.openWindow',
      'has no native meaning: there is no second window to open a worktree into',
    ),
  };
}
