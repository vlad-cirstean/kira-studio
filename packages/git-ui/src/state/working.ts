import type { ResultOf } from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

export type FileChange = ResultOf<'working.detail'>['files'][number];

export type FileListMode = 'tree' | 'flat';

/**
 * P7 (item 2): the uncommitted-changes strip's own click-through selection — independent of
 * `SelectionState` (no row, no sha: the working tree is not a graph row, and SPEC's own rejected-
 * pseudo-row note is why it never will be) the same way `StashState` is independent of it. `App.vue`
 * clears this whenever a real commit/stash gets selected, and clears the other two whenever this
 * one is selected — mirroring the mutual-exclusion `App.vue`'s own `selection.sha` watch already
 * does between `DetailState`/`StashState`.
 */
export class WorkingDetailState {
  readonly selected: ShallowRef<boolean> = shallowRef(false);
  readonly files: ShallowRef<readonly FileChange[]> = shallowRef([]);
  readonly error: ShallowRef<string | undefined> = shallowRef(undefined);

  /** An index into `files.value`, or `-1` when no file is selected — mirrors `DetailState.
   *  selectedFile` exactly. */
  readonly selectedFile: ShallowRef<number> = shallowRef(-1);

  readonly listMode: ShallowRef<FileListMode> = shallowRef('tree');
  readonly filter: ShallowRef<string> = shallowRef('');

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  #requestController: AbortController | undefined;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
  }

  /** `selected(true)` requests `working.detail` immediately; `selected(false)` (a real commit/
   *  stash getting selected instead, or the pane closing) aborts any in-flight request and clears
   *  the file list — re-selecting the strip later always re-fetches rather than showing stale
   *  data. */
  select(selected: boolean): void {
    this.#requestController?.abort();
    this.selected.value = selected;
    this.files.value = [];
    this.error.value = undefined;
    this.selectedFile.value = -1;
    if (selected) void this.#requestDetail();
  }

  selectFile(index: number): void {
    this.selectedFile.value = index;
  }

  setListMode(mode: FileListMode): void {
    this.listMode.value = mode;
  }

  setFilter(text: string): void {
    this.filter.value = text;
  }

  /** Re-fetches without changing `selected` — the strip's own count already updates live off
   *  `OpsState.statusSummary` on every `repo.changed`; this lets `App.vue` additionally refresh the
   *  open pane's own file list on the same signal, so it never goes stale while left open across an
   *  external edit or a stage/unstage in another tool. */
  refresh(): void {
    if (this.selected.value) void this.#requestDetail();
  }

  async #requestDetail(): Promise<void> {
    const repoId = this.#repoId;
    if (!repoId) return;
    const controller = new AbortController();
    this.#requestController = controller;
    const stillCurrent = (): boolean => this.selected.value && this.#repoId === repoId;
    try {
      const result = await this.#bridge.request('working.detail', { repoId }, controller.signal);
      if (!stillCurrent()) return;
      this.files.value = result.files;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      if (!stillCurrent()) return;
      this.error.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.#requestController === controller) this.#requestController = undefined;
    }
  }

  dispose(): void {
    this.#requestController?.abort();
  }
}
