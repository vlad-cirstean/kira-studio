import type { ResultOf } from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

export type CommitDetail = ResultOf<'commit.detail'>;

export type FileListMode = 'tree' | 'flat';

/**
 * `docs/plans/P5.md` W7: the detail pane's state machine, kept out of any SFC so W13 can test
 * the transitions directly and a later phase can mount the same components in a sidebar. Every
 * field is `shallowRef` (§5.3) — `detail` payloads are plain data, never made reactive
 * themselves.
 *
 * G21 D12: `mode`/`diff`/`diffError`/`showTree()` and the `commit.fileDiff` fetch are gone — the
 * graph tree opens VS Code's own native diff editor now (`DetailPane.vue`'s own wiring to
 * `actions.openInEditor`), so this class no longer owns an embedded diff to drive. `selectedFile`
 * survives: it still drives the tree's own selected-row highlight and file cursor, both still
 * meaningful with no diff attached to them.
 *
 * **Sequencing.** Selecting a new commit aborts any in-flight `commit.detail` — one request per
 * kind, exactly as `GraphViewState` already does for its own streams. Aborting alone is not
 * enough (an abort racing a resolution can still resolve), so every response additionally
 * checks, right before committing itself to a ref, that the sha/parentIndex it was requested for
 * is still the one currently selected — a response for anything else is dropped in silence, not
 * rendered.
 */
export class DetailState {
  readonly sha: ShallowRef<string | null> = shallowRef(null);
  readonly parentIndex: ShallowRef<number> = shallowRef(0);
  readonly detail: ShallowRef<CommitDetail | undefined> = shallowRef(undefined);
  readonly error: ShallowRef<string | undefined> = shallowRef(undefined);

  /** An index into `detail.value.files`, or `-1` when no file is selected. */
  readonly selectedFile: ShallowRef<number> = shallowRef(-1);

  readonly listMode: ShallowRef<FileListMode> = shallowRef('tree');
  readonly filter: ShallowRef<string> = shallowRef('');

  /** W10's copy/"Go to file" outcome text — fed into `App.vue`'s single shared live region
   *  alongside the load-more/refresh announcements it already carries. A plain string, not a
   *  queue: a second announcement while the first is still being read simply replaces it, the
   *  same trade-off the existing live region already makes. */
  readonly announcement: ShallowRef<string> = shallowRef('');

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  #detailController: AbortController | undefined;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  /** Called whenever the active repo changes — `commit.detail` needs a `repoId`, and this class
   *  does not otherwise track which repo it belongs to. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
  }

  /**
   * Selects a different commit (`SelectionState`'s own sha, mirrored here by the caller):
   * resets `parentIndex` to 0 and clears `selectedFile` — the file you were looking at may not
   * exist in the other commit's tree at all, and carrying a stale selection across is confusing
   * even with no diff attached to it. Selecting the *same* sha again is P4's toggle and never
   * reaches this method (callers only invoke it on an actual change).
   */
  select(sha: string | null): void {
    this.#detailController?.abort();
    this.sha.value = sha;
    this.parentIndex.value = 0;
    this.detail.value = undefined;
    this.error.value = undefined;
    this.selectedFile.value = -1;
    if (sha !== null) void this.#requestDetail();
  }

  /** Re-requests the detail for the *same* commit against a different parent (merges only) —
   *  the file list is per-parent, so `selectedFile` resets exactly as a commit change does, but
   *  `sha` itself is untouched. */
  setParentIndex(index: number): void {
    if (this.parentIndex.value === index) return;
    this.parentIndex.value = index;
    this.selectedFile.value = -1;
    void this.#requestDetail();
  }

  /** Moves the file cursor (a click, `Enter`, or arrow-nav in `FileTree.vue`) — the tree's own
   *  selected-row highlight follows this, independent of whether the row's own click also opened
   *  a native diff (`DetailPane.vue`'s own `actions.openInEditor` call, driven by the tree's
   *  `openFile` emit, G21 D13). */
  selectFile(index: number): void {
    this.selectedFile.value = index;
  }

  setListMode(mode: FileListMode): void {
    this.listMode.value = mode;
  }

  setFilter(text: string): void {
    this.filter.value = text;
  }

  announce(text: string): void {
    this.announcement.value = text;
  }

  async #requestDetail(): Promise<void> {
    const repoId = this.#repoId;
    const sha = this.sha.value;
    if (!repoId || !sha) return;
    const controller = new AbortController();
    this.#detailController = controller;
    const parentIndex = this.parentIndex.value;
    const stillCurrent = (): boolean =>
      this.sha.value === sha && this.parentIndex.value === parentIndex;
    try {
      const result = await this.#bridge.request(
        'commit.detail',
        { repoId, sha, parentIndex },
        controller.signal,
      );
      if (!stillCurrent()) return;
      this.detail.value = result;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      if (!stillCurrent()) return;
      this.error.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.#detailController === controller) this.#detailController = undefined;
    }
  }

  dispose(): void {
    this.#detailController?.abort();
  }
}
