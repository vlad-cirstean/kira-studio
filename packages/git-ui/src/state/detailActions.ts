import type { GoToFileOutcome } from '@kira/git-ipc';
import type { BridgeClient } from '../bridge/client.ts';
import { copyToClipboard } from './clipboardActions.ts';

/**
 * P5 W10's single bundle of "things the detail pane's components can *do*", passed down as one
 * prop rather than threading `BridgeClient` + `DetailState.announce` separately through
 * `CommitMeta.vue`/`FileTree.vue`/`DiffView.vue`.
 */
export interface DetailActions {
  /** Copies `text` via `clipboard.write` and feeds the resulting announcement into the shared
   *  live region — fire-and-forget from the caller's own perspective (a button click handler),
   *  since every copy site's feedback is the same live-region text plus its own local ~1.5s
   *  inline confirmation, never a value the caller needs to await. */
  copy(text: string, message: string): void;
  /** Feeds the "Open in editor"/"Go to file" outcome text into the same shared live region
   *  `copy`'s own announcements use — kept as a separate method (rather than routing through
   *  `copy`) because these are not clipboard outcomes and should never be confused for one in a
   *  test asserting which `clipboard.write` calls happened. */
  announce(text: string): void;
  /** "Open in editor" — hands the same two blobs to the host's native diff.
   *
   *  `pinned` is required, not optional — the caller (`FileTree.vue`'s `openFile` emit)
   *  always knows which of the two this is; no default is applied here, so a call site that
   *  forgets it is a type error, never a silent pin. `fallbackSha` (optional — only
   *  `StashDetailPane.vue` ever has one to give) carries `entry.untrackedSha` through to
   *  `editor.openDiff`'s own retry (the untracked-stash-file case). */
  openInEditor(params: {
    sha: string;
    path: string;
    originalPath: string | undefined;
    parentIndex: number;
    pinned: boolean;
    fallbackSha?: string;
  }): Promise<void>;
  /** "Open all changes" — the bulk call site, always pinned/multi-diff in spirit
   *  (never regressed by the per-file preview/pin split). One host round trip composes and
   *  opens every changed file at once; the outcome is returned (not merely fire-and-forget like
   *  `openInEditor`) so the caller can announce it — the remaining problem (i), a run
   *  where some files silently fail to open, is what makes an awaited, inspectable result matter
   *  here specifically. */
  /** P75 §1.2: `parentIndex` is optional — a collapsed row has none to give (nothing has been
   *  picked yet), matching the contract's own `parentIndex?: number`; the host default (parent 0)
   *  answers exactly as an unexpanded row would have shown. */
  openAllChanges(params: {
    sha: string;
    parentIndex?: number;
  }): Promise<{ opened: number; failed: number; mode: 'multiDiff' | 'tabs' }>;
  /** "Go to file" — `rev`/`path`/`line` are already resolved; this method only makes the
   *  request and returns the outcome, it does not compute `rev`/`line` itself. No caller remains
   *  after `DiffView.vue` was deleted (the one place that knew which side of the diff the cursor
   *  was on) — kept, unreachable, rather than torn out along with a contract method
   *  (`editor.goToFile`). */
  goToFile(params: { rev: string; path: string; line: number }): Promise<GoToFileOutcome>;
  /** P74 §3.3: opens a change request in the external browser, never in place — the renderer never
   *  supplies a URL (`changeRequest.openExternal`'s own doc comment); it names the PR by number and the host
   *  composes/opens the URL itself. */
  openChangeRequest(params: { number: number }): Promise<void>;
  /** Opens an arbitrary URL found in a commit message body (`linkify.ts`) in the
   *  external browser. Unlike `openChangeRequest`, this URL is genuinely renderer-supplied — it is
   *  the untrusted commit message text itself, not something the host composes — so each host
   *  validates the URL's own shape rather than trusting it outright. */
  openExternalLink(url: string): Promise<void>;
  /** Reveals and selects `sha` in the graph — review-row-only today
   *  (`ReviewCommitRow.vue`'s "Open in graph"), implemented in every bundle because
   *  `DetailActions` is one interface, the same way `openChangeRequest` is.
   *  `revealed: false` is a real answer (no pinned graph tab / repo not known to this window),
   *  not a stub — callers announce it. */
  revealInGraph(params: { sha: string }): Promise<{ revealed: boolean }>;
}

/**
 * `announce` is a plain sink rather than a `DetailState` instance (P115 H6): `App.vue`'s own
 * `DetailState` and `ReviewSessionState`'s own `announcement` ref are the two live regions this
 * bundle can feed, and this factory needs only the one method either exposes.
 */
export function createDetailActions(
  bridge: BridgeClient,
  announce: (text: string) => void,
  repoId: () => string | undefined,
): DetailActions {
  return {
    copy(text, message) {
      void copyToClipboard(bridge, text, message).then((outcome) => {
        announce(outcome.message);
      });
    },
    announce(text) {
      announce(text);
    },
    async openInEditor({ sha, path, originalPath, parentIndex, pinned, fallbackSha }) {
      const repo = repoId();
      if (!repo) return;
      await bridge.request('editor.openDiff', {
        repoId: repo,
        sha,
        path,
        ...(originalPath !== undefined ? { originalPath } : {}),
        parentIndex,
        pinned,
        ...(fallbackSha !== undefined ? { fallbackSha } : {}),
      });
    },
    async openAllChanges({ sha, parentIndex }) {
      const repo = repoId();
      if (!repo) throw new Error('createDetailActions: openAllChanges called with no active repo');
      return bridge.request('editor.openAllChanges', { repoId: repo, sha, parentIndex });
    },
    async goToFile({ rev, path, line }) {
      const repo = repoId();
      if (!repo) throw new Error('createDetailActions: goToFile called with no active repo');
      return bridge.request('editor.goToFile', { repoId: repo, rev, path, line });
    },
    async openChangeRequest({ number }) {
      const repo = repoId();
      if (!repo)
        throw new Error('createDetailActions: openChangeRequest called with no active repo');
      await bridge.request('changeRequest.openExternal', { repoId: repo, number });
    },
    async openExternalLink(url) {
      await bridge.request('link.openExternal', { url });
    },
    async revealInGraph({ sha }) {
      const repo = repoId();
      if (!repo) return { revealed: false };
      return bridge.request('graph.revealCommit', { repoId: repo, sha });
    },
  };
}
