import type {
  LineRange,
  ResultOf,
  ReviewDeltaSource,
  ReviewDiffMode,
  ReviewFileEntry,
} from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

export type ReviewFileDiffBody = ResultOf<'review.fileDiff'>['body'];

/** The (repo, branch, base) triple review.files/review.fileDiff/review.mark need — base only for
 *  the two read methods (G11 D5: review.mark carries no base at all, a write is a fact about
 *  (repo, branch, path) only). */
export interface ReviewFilesTarget {
  readonly repoId: string;
  readonly branch: string;
  readonly base: string;
}

/**
 * The review sidebar's Files pane (G11 D16) — `DetailState`'s own supersede-and-verify discipline,
 * applied to review.files/review.fileDiff/review.mark instead of commit.detail/commit.fileDiff.
 * Kept as its own class (not folded into `ReviewSessionState`) since it answers a different
 * question (which files has THIS branch's diff, and what state do they carry) than the commit
 * list does, and the two panes are mutually exclusive tabs, never shown together.
 */
export class ReviewFilesState {
  readonly files: ShallowRef<readonly ReviewFileEntry[]> = shallowRef([]);
  readonly loading: ShallowRef<boolean> = shallowRef(false);
  readonly loadError: ShallowRef<string | undefined> = shallowRef(undefined);

  /** `null` ⇒ the list is showing; a path ⇒ that file's diff has taken over the pane. */
  readonly selectedPath: ShallowRef<string | null> = shallowRef(null);
  readonly diffMode: ShallowRef<ReviewDiffMode> = shallowRef('sinceReview');
  readonly deltaSource: ShallowRef<ReviewDeltaSource | undefined> = shallowRef(undefined);
  readonly body: ShallowRef<ReviewFileDiffBody | undefined> = shallowRef(undefined);
  readonly reviewedRanges: ShallowRef<readonly LineRange[]> = shallowRef([]);
  readonly diffError: ShallowRef<string | undefined> = shallowRef(undefined);

  /** A review.mark request in flight — the two header buttons disable themselves while true
   *  rather than let a double-click race two writes against the same file. */
  readonly pending: ShallowRef<boolean> = shallowRef(false);

  readonly #bridge: BridgeClient;
  #target: ReviewFilesTarget | undefined;
  #filesController: AbortController | undefined;
  #diffController: AbortController | undefined;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  /** Called whenever the review session's own target/base changes — resets everything and, when a
   *  target is given, loads the file list. */
  setTarget(target: ReviewFilesTarget | undefined): void {
    this.#abortAll();
    this.#target = target;
    this.files.value = [];
    this.loadError.value = undefined;
    this.selectedPath.value = null;
    this.#clearDiff();
    if (target) void this.#loadFiles();
  }

  async #loadFiles(): Promise<void> {
    const target = this.#target;
    if (!target) return;
    this.#filesController?.abort();
    const controller = new AbortController();
    this.#filesController = controller;
    this.loading.value = true;
    const stillCurrent = (): boolean => this.#target === target;
    try {
      const result = await this.#bridge.request(
        'review.files',
        { repoId: target.repoId, branch: target.branch, base: target.base },
        controller.signal,
      );
      if (!stillCurrent()) return;
      this.files.value = result.files;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      if (!stillCurrent()) return;
      this.loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (stillCurrent()) this.loading.value = false;
      if (this.#filesController === controller) this.#filesController = undefined;
    }
  }

  /** Opens path's diff — a no-op re-selection of the file already open keeps its existing diff. */
  selectFile(path: string): void {
    if (this.selectedPath.value === path) return;
    this.selectedPath.value = path;
    void this.#loadDiff();
  }

  /** Returns to the file list without discarding which file was selected. */
  showList(): void {
    this.selectedPath.value = null;
  }

  setDiffMode(mode: ReviewDiffMode): void {
    if (this.diffMode.value === mode) return;
    this.diffMode.value = mode;
    if (this.selectedPath.value !== null) void this.#loadDiff();
  }

  async #loadDiff(): Promise<void> {
    const target = this.#target;
    const path = this.selectedPath.value;
    if (!target || path === null) return;
    this.#diffController?.abort();
    const controller = new AbortController();
    this.#diffController = controller;
    const mode = this.diffMode.value;
    this.diffError.value = undefined;
    const stillCurrent = (): boolean =>
      this.#target === target && this.selectedPath.value === path && this.diffMode.value === mode;
    try {
      const result = await this.#bridge.request(
        'review.fileDiff',
        { repoId: target.repoId, branch: target.branch, base: target.base, path, mode },
        controller.signal,
      );
      if (!stillCurrent()) return;
      this.deltaSource.value = result.deltaSource;
      this.body.value = result.body;
      this.reviewedRanges.value = result.reviewedRanges;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      if (!stillCurrent()) return;
      this.diffError.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.#diffController === controller) this.#diffController = undefined;
    }
  }

  #clearDiff(): void {
    this.deltaSource.value = undefined;
    this.body.value = undefined;
    this.reviewedRanges.value = [];
    this.diffError.value = undefined;
  }

  /**
   * Marks (or unmarks) path — the whole file when ranges is omitted, a sub-range otherwise (G11
   * D13). Applies the returned status to the in-memory file list directly, so the list updates
   * from the response rather than a second review.files round trip; when path is the file
   * currently open, its diff is re-fetched too (a mark can change reviewedRanges/deltaSource for
   * the very diff the user is looking at).
   */
  async mark(path: string, reviewed: boolean, ranges?: readonly LineRange[]): Promise<void> {
    const target = this.#target;
    if (!target || this.pending.value) return;
    this.pending.value = true;
    try {
      const result = await this.#bridge.request('review.mark', {
        repoId: target.repoId,
        branch: target.branch,
        path,
        reviewed,
        ...(ranges !== undefined ? { ranges } : {}),
      });
      if (this.#target !== target) return;
      this.files.value = this.files.value.map((entry) =>
        entry.change.path === path ? { ...entry, review: result.review } : entry,
      );
      if (this.selectedPath.value === path) await this.#loadDiff();
    } finally {
      if (this.#target === target) this.pending.value = false;
    }
  }

  dispose(): void {
    this.#abortAll();
  }

  #abortAll(): void {
    this.#filesController?.abort();
    this.#diffController?.abort();
  }
}
