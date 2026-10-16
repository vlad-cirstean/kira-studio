import { CommitStore } from '@kira/git-core';
import type { StreamChunkOf } from '@kira/git-ipc';
import { logError } from '@workbench/bridge/log';
import { markRaw, type ShallowRef, shallowRef } from 'vue';

export type ChunkSource = StreamChunkOf<'graph.stream'>['source'];

/** The row range a chunk just appended — `{from, to}` straight off `PackedCommitChunk`, handed
 *  back to the caller so it can do whatever comes after the append (P4's lane-layout submission;
 *  P7's review view does nothing with it at all). `undefined` when the chunk was corrupted and
 *  recovery already kicked off a fresh re-open — there is nothing for the caller to do with a
 *  range that was never actually applied. */
export interface AppliedChunkRange {
  readonly from: number;
  readonly to: number;
  /** The chunk went into the staging store of a staged restart, not the live one. */
  readonly staged?: true;
}

export interface ApplyChunkHooks {
  /** Called when this chunk triggers a restart-at-row-0 reset, *before* the reset itself runs —
   *  the caller's own chance to clear whatever it layers on top of the store (P4's lane layout;
   *  P7's `review.ts` has nothing extra to clear and omits this). Not called for a staged restart:
   *  the live store and its layout stay valid until the swap. */
  readonly onReset?: () => void;
  /** Called instead of applying the chunk when `CommitStore.appendPacked` rejects it (an
   *  out-of-order or duplicated chunk — a genuinely corrupted stream). The caller is expected to
   *  re-open its stream from row 0, mirroring the one recovery both `graphView.ts` and
   *  `review.ts` need. */
  readonly onCorrupted: (error: unknown) => void | Promise<void>;
  /** Called instead of `onCorrupted` once a re-open already failed the same way
   *  (`MAX_CONSECUTIVE_CORRUPTIONS`): the server sends the same bad chunk every time, so another
   *  re-walk only loops. The caller surfaces an error state. */
  readonly onUnrecoverable: (error: unknown) => void;
}

/** Re-opens attempted for a corrupted chunk before giving up. */
const MAX_CONSECUTIVE_CORRUPTIONS = 1;

/**
 * The chunk-application core `GraphViewState` (P4) and `ReviewSessionState` (P7) both need,
 * extracted verbatim from `GraphViewState`'s original `#applyChunk`/`#reset` (P7 W10, open
 * question 8): the reset-on-`from: 0` rule, the `appendPacked` call, the corrupted-chunk
 * recovery (log, let the caller re-open from row 0), and the `loadedRows`/`remaining`/
 * `exhausted`/`lastChunkSource`/`generation` reactive scalars. It owns a `CommitStore` and
 * nothing else — no layout, no bridge, no knowledge of what a "row" means beyond a slice of
 * that store. `GraphViewState` composes this and layers its own lane-layout submission and
 * `laneCount` on top via `ApplyChunkHooks.onReset`; the review view's `ReviewSessionState`
 * composes it with no such hook, because a range walk draws no lanes (§6.8/D41).
 *
 * With `stageRestarts`, a restart-at-row-0 chunk leaves the live store alone and starts a staging
 * store; that chunk and the rest append there. Staging is ready once it holds as many rows as the
 * live store did, or the chunk reports the history exhausted, or `finishStaging()` says the stream
 * ended (a history that shrank). `commitStaged()` then moves it into the live store in one step,
 * so the list never passes through empty.
 *
 * `store` is `markRaw`'d and never becomes reactive (§5.3) — only the scalars below are.
 * **`generation` is the mechanism that makes a reset visible to a grid or list** built on top:
 * nothing else changes when rows are dropped and re-walked from row 0 (`loadedRows` might land
 * on the same number), so every consumer that caches anything derived from the store
 * invalidates on `generation`.
 */
export class PackedStreamState {
  readonly store: CommitStore;
  readonly loadedRows: ShallowRef<number> = shallowRef(0);
  readonly remaining: ShallowRef<number> = shallowRef(0);
  readonly exhausted: ShallowRef<boolean> = shallowRef(false);
  readonly lastChunkSource: ShallowRef<ChunkSource | undefined> = shallowRef(undefined);
  readonly generation: ShallowRef<number> = shallowRef(0);
  /** Corrupted chunks since the last good one; bounds the re-open loop. */
  #corruptions = 0;
  readonly #stageRestarts: boolean;
  #staging: CommitStore | undefined;
  #stagingTarget = 0;
  #stagingReady = false;
  /** The scalars of the latest staged chunk, applied when staging commits. */
  #stagedScalars: { remaining: number; exhausted: boolean; source: ChunkSource } | undefined;

  constructor(options: { readonly stageRestarts?: boolean } = {}) {
    this.store = markRaw(new CommitStore());
    this.#stageRestarts = options.stageRestarts ?? false;
  }

  /** The staged history once it is complete enough to replace the live one; `undefined` while it
   *  still streams in (or when no restart is staged). */
  get pendingStore(): CommitStore | undefined {
    return this.#stagingReady ? this.#staging : undefined;
  }

  /** The stream ended: whatever staging holds is the whole history. Returns whether a staged
   *  history now waits to be committed. */
  finishStaging(): boolean {
    if (this.#staging === undefined) return false;
    this.#stagingReady = true;
    return true;
  }

  discardStaging(): void {
    this.#staging = undefined;
    this.#stagingReady = false;
    this.#stagedScalars = undefined;
  }

  /** Moves the ready staging store into the live one and applies the scalars its last chunk
   *  carried. `publish` runs after the swap and before `generation` bumps, so a synchronous
   *  `generation` watcher never sees a plan longer than the store. */
  commitStaged(publish: () => void): void {
    const staging = this.#staging;
    if (staging === undefined || !this.#stagingReady) return;
    const scalars = this.#stagedScalars;
    this.discardStaging();
    this.store.replaceWith(staging);
    this.loadedRows.value = this.store.rowCount;
    if (scalars) {
      this.remaining.value = scalars.remaining;
      this.exhausted.value = scalars.exhausted;
      this.lastChunkSource.value = scalars.source;
    }
    publish();
    this.generation.value++;
  }

  /** Clears every loaded row and bumps `generation`. Callable directly (P7's `review.ts` resets
   *  on every `setTarget`/`setBase`, not only on a restart-at-zero chunk); `applyChunk` also
   *  calls this internally when it detects the restart-at-zero condition itself. */
  reset(): void {
    this.#corruptions = 0;
    this.discardStaging();
    this.#clear();
  }

  #clear(): void {
    this.store.clear();
    this.loadedRows.value = 0;
    this.remaining.value = 0;
    this.exhausted.value = false;
    this.lastChunkSource.value = undefined;
    this.generation.value++;
  }

  async applyChunk(
    chunk: StreamChunkOf<'graph.stream'>,
    hooks: ApplyChunkHooks,
  ): Promise<AppliedChunkRange | undefined> {
    if (chunk.from === 0 && this.store.rowCount > 0) {
      if (this.#stageRestarts) {
        this.#staging = new CommitStore();
        this.#stagingTarget = this.store.rowCount;
        this.#stagingReady = false;
      } else {
        hooks.onReset?.();
        this.#clear();
      }
    }

    const staging = this.#staging;
    try {
      (staging ?? this.store).appendPacked(chunk.commits);
    } catch (error) {
      // A genuinely corrupted stream (§5.5's store asserts are the right place to catch this
      // and the wrong place to recover from it): log it and let the caller re-open from row 0
      // instead of leaving an unhandled rejection and a half-populated list on screen.
      this.discardStaging();
      this.#corruptions++;
      if (this.#corruptions > MAX_CONSECUTIVE_CORRUPTIONS) {
        logError('packedStream', 'appendPacked failed again, giving up', error);
        hooks.onUnrecoverable(error);
        return undefined;
      }
      logError('packedStream', 'appendPacked failed, re-opening from row 0', error);
      await hooks.onCorrupted(error);
      return undefined;
    }
    this.#corruptions = 0;

    if (staging !== undefined) {
      this.#stagedScalars = {
        remaining: chunk.remaining,
        exhausted: chunk.exhausted,
        source: chunk.source,
      };
      if (staging.rowCount >= this.#stagingTarget || chunk.exhausted) this.#stagingReady = true;
      return { from: chunk.commits.from, to: chunk.commits.to, staged: true };
    }

    this.loadedRows.value = this.store.rowCount;
    this.remaining.value = chunk.remaining;
    this.exhausted.value = chunk.exhausted;
    this.lastChunkSource.value = chunk.source;
    return { from: chunk.commits.from, to: chunk.commits.to };
  }

  /** G16 D7: terminal state from a `graph.status` request, applied after a load's resync
   *  re-stream — not a chunk, so deliberately not folded into `applyChunk`, which would drag the
   *  reset-on-`from === 0` logic somewhere it does not belong. This is what closes F7's
   *  zero-chunk hole: a re-stream that emits nothing (because the client already holds every row
   *  the host has) never calls `applyChunk` at all, so `exhausted`/`remaining` would otherwise be
   *  stuck at whatever the last real chunk said. */
  applyStatus(remaining: number, exhausted: boolean): void {
    this.remaining.value = remaining;
    this.exhausted.value = exhausted;
  }
}
