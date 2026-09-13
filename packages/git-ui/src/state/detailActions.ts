import type { GoToFileOutcome, ResultOf } from '@kira/git-ipc';
import type { BridgeClient } from '../bridge/client.ts';
import { copyToClipboard } from './clipboardActions.ts';
import type { DetailState } from './detail.ts';

export type Capabilities = ResultOf<'app.init'>['capabilities'];

/**
 * P5 W10's single bundle of "things the detail pane's components can *do*", passed down as one
 * prop rather than threading `BridgeClient` + `capabilities` + `DetailState.announce` separately
 * through `CommitMeta.vue`/`FileTree.vue`/`DiffView.vue`. `capabilities` is read once per render
 * (it never changes after `app.init` resolves for a given session — a host does not grow a port
 * mid-session), which is why every one of them gates on `actions.capabilities.*` directly rather
 * than through another accessor.
 */
export interface DetailActions {
  readonly capabilities: Capabilities;
  /** Copies `text` via `clipboard.write` and feeds the resulting announcement into the shared
   *  live region — fire-and-forget from the caller's own perspective (a button click handler),
   *  since every copy site's feedback is the same live-region text plus its own local ~1.5s
   *  inline confirmation, never a value the caller needs to await. */
  copy(text: string, whatCopied: string): void;
  /** Feeds W10's "Open in editor"/"Go to file" outcome text into the same shared live region
   *  `copy`'s own announcements use — kept as a separate method (rather than routing through
   *  `copy`) because these are not clipboard outcomes and should never be confused for one in a
   *  test asserting which `clipboard.write` calls actually happened. */
  announce(text: string): void;
  /** "Open in editor" (§6.4/D14a's sibling action) — hands the same two blobs to the host's
   *  native diff. A no-op (never called) when `capabilities.openInEditor` is false; callers gate
   *  the button on that themselves rather than this method re-checking it.
   *
   *  G21 D13: `pinned` is required, not optional — the caller (`FileTree.vue`'s `openFile` emit)
   *  always knows which of the two this is; no default is applied here, so a call site that
   *  forgets it is a type error, never a silent pin. G21 D12: `fallbackSha` (optional — only
   *  `StashDetailPane.vue` ever has one to give) carries `entry.untrackedSha` through to
   *  `editor.openDiff`'s own retry (F12's untracked-stash-file case). */
  openInEditor(params: {
    sha: string;
    path: string;
    originalPath: string | undefined;
    parentIndex: number;
    pinned: boolean;
    fallbackSha?: string;
  }): Promise<void>;
  /** G21 D8 (item 8): "Open all changes" — the bulk call site, always pinned/multi-diff in spirit
   *  (never regressed by D13's own per-file preview/pin split). One host round trip composes and
   *  opens every changed file at once; the outcome is returned (not merely fire-and-forget like
   *  `openInEditor`) so the caller can announce it — item 8's own remaining problem (i), a run
   *  where some files silently fail to open, is what makes an awaited, inspectable result matter
   *  here specifically. */
  openAllChanges(params: {
    sha: string;
    parentIndex: number;
  }): Promise<{ opened: number; failed: number; mode: 'multiDiff' | 'tabs' }>;
  /** "Go to file" (D14a) — `rev`/`path`/`line` are exactly the algorithm at the top of the plan
   *  already resolved; this method only makes the request and returns the outcome, it does not
   *  compute `rev`/`line` itself. No caller remains after G21 D12 deleted `DiffView.vue` (the one
   *  place that knew which side of the diff the cursor was on) — kept, unreachable, rather than
   *  torn out along with a contract method (`editor.goToFile`) this phase's own plan never asked
   *  to remove. */
  goToFile(params: { rev: string; path: string; line: number }): Promise<GoToFileOutcome>;
}

export function createDetailActions(
  bridge: BridgeClient,
  detailState: DetailState,
  capabilities: Capabilities,
  repoId: () => string | undefined,
): DetailActions {
  return {
    capabilities,
    copy(text, whatCopied) {
      void copyToClipboard(bridge, text, whatCopied).then((outcome) => {
        detailState.announce(outcome.message);
      });
    },
    announce(text) {
      detailState.announce(text);
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
  };
}
