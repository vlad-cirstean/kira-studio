import type { CommitStore } from '@kira/git-core';
import { type ShallowRef, shallowRef } from 'vue';

/**
 * §3.1's selection state, deferred by P3 to P4 W5. Stored **by sha as well as row**, because
 * §6.2 requires refresh to preserve selection and a re-walk renumbers every row — `row` is a
 * position in the *current* layout, `sha` is the commit itself, and only the latter survives a
 * reset unaided.
 *
 * `select(row)` is what a click/keyboard-nav handler calls, resolving `sha` from `store`
 * immediately. `selectBySha(sha)` is the re-resolution path a reset triggers: called against
 * the store once it holds rows again (after a refresh's re-walk, or a rehydration), it looks the
 * sha back up and moves `row` to wherever it now lives. When the sha is not found — it fell
 * below the loaded range, or it is genuinely gone from history — selection clears outright
 * rather than leaving `row` pointing at whatever commit now happens to occupy that index:
 * silently selecting a *different* commit at the same row would be the worst available
 * behaviour in a tool whose next phase attaches destructive actions to the selected row.
 *
 * Takes `store` directly rather than a `GraphViewState` — this class only ever reads row/sha
 * lookups off it, and staying decoupled from `GraphViewState` matches the plan's own sketch,
 * where neither state class references the other; a component (W11's `App.vue`) is what wires
 * "the store reset, re-resolve the previous selection" between them.
 */
export class SelectionState {
  readonly row: ShallowRef<number> = shallowRef(-1);
  readonly sha: ShallowRef<string | null> = shallowRef(null);

  readonly #store: CommitStore;

  constructor(store: CommitStore) {
    this.#store = store;
  }

  /** Selects a loaded row by index. Out of range (including an empty store) clears instead of
   *  throwing — a stale row index from before a reset is a normal input here, not a bug. */
  select(row: number): void {
    if (row < 0 || row >= this.#store.rowCount) {
      this.clear();
      return;
    }
    this.row.value = row;
    this.sha.value = this.#store.shaAt(row);
  }

  /** Re-resolves a previously selected sha against the store's *current* rows — the path a
   *  reset's aftermath uses. Returns whether it found the commit; on a miss it clears rather
   *  than leaving `row` pointing at row `-1`'s old, no-longer-meaningful sha. */
  selectBySha(sha: string): boolean {
    const row = this.#store.rowOfSha(sha);
    if (row === -1) {
      this.clear();
      return false;
    }
    this.row.value = row;
    this.sha.value = sha;
    return true;
  }

  clear(): void {
    this.row.value = -1;
    this.sha.value = null;
  }
}
