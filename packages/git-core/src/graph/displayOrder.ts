import FlatQueue from 'flatqueue';
import { assert } from '../lib/assert.ts';
import type { LayoutInput } from './types.ts';

/**
 * P347: the display order of the graph. The store holds commits in `git log --date-order`
 * (children before parents, newest first among what is ready). This projection keeps that order
 * and changes it in one case only: sibling chains forking from the same commit that interleave
 * in date order are made contiguous, so each branch reads as one run at that spot.
 *
 * A *chain* is a maximal run of rows linked by first-parent edges where each parent has exactly
 * one child. A commit with two or more children, or a merge's second parent, starts a new chain.
 * Chains whose bottom has the same first parent (the *fork key*) are siblings. Rule: a sibling
 * that starts while another is open finishes before the other resumes. Starting a chain is never
 * blocked, so a recent tip still shows at its own date.
 *
 * Priority is the store row index, so with no interleaving siblings the output equals store
 * order. Output is always a topological order of the loaded rows: every parent after its child.
 *
 * Not final on arrival: when a page loads a chain bottom's unloaded parent and that parent has a
 * single child, two chains merge and can become siblings under a different key. Only rows next
 * to the loaded boundary move. The grid repaints wholesale on every plan publish.
 */

interface Chains {
  readonly count: number;
  readonly chainOf: Int32Array;
  readonly top: Int32Array;
  readonly bottom: Int32Array;
}

function firstParentRowOf(input: LayoutInput, row: number): number {
  const { parentOffsets, parentRows } = input;
  return parentOffsets[row] < parentOffsets[row + 1] ? parentRows[parentOffsets[row]] : -2;
}

function buildChains(input: LayoutInput, childCount: Int32Array): Chains {
  const rowCount = input.to;
  const chainOf = new Int32Array(rowCount).fill(-1);
  const top = new Int32Array(rowCount);
  const bottom = new Int32Array(rowCount);
  let count = 0;
  for (let row = 0; row < rowCount; row++) {
    if (chainOf[row] !== -1) continue;
    const chain = count++;
    top[chain] = row;
    let last = row;
    chainOf[last] = chain;
    for (;;) {
      const parent = firstParentRowOf(input, last);
      if (parent < 0 || childCount[parent] !== 1 || chainOf[parent] !== -1) break;
      chainOf[parent] = chain;
      last = parent;
    }
    bottom[chain] = last;
  }
  return { count, chainOf, top, bottom };
}

/** Fork key per chain: the fork row index, or `rowCount + n` for an unloaded fork sha, or `-1`
 *  for a root. Returns the key space size as well. */
function forkKeys(
  input: LayoutInput,
  chains: Chains,
  firstParentSha: (row: number) => string | undefined,
): { chainKey: Int32Array; keyCount: number } {
  const rowCount = input.to;
  const chainKey = new Int32Array(chains.count).fill(-1);
  const shaKeys = new Map<string, number>();
  for (let chain = 0; chain < chains.count; chain++) {
    const bottom = chains.bottom[chain];
    const parent = firstParentRowOf(input, bottom);
    if (parent >= 0) {
      chainKey[chain] = parent;
      continue;
    }
    if (parent !== -1) continue;
    const sha = firstParentSha(bottom);
    if (sha === undefined) continue;
    let id = shaKeys.get(sha);
    if (id === undefined) {
      id = rowCount + shaKeys.size;
      shaKeys.set(sha, id);
    }
    chainKey[chain] = id;
  }
  return { chainKey, keyCount: rowCount + shaKeys.size };
}

/** `firstParentSha(row)` is called only for a chain whose bottom's first parent is unloaded. */
export function localTopoOrder(
  input: LayoutInput,
  firstParentSha: (row: number) => string | undefined,
): Int32Array {
  const rowCount = input.to;
  const { parentOffsets, parentRows } = input;
  const order = new Int32Array(rowCount);
  if (rowCount === 0) return order;

  const childCount = new Int32Array(rowCount);
  for (let slot = parentOffsets[0]; slot < parentOffsets[rowCount]; slot++) {
    const parent = parentRows[slot];
    if (parent >= 0) childCount[parent]++;
  }

  const chains = buildChains(input, childCount);
  const { chainOf, top: chainTop, bottom: chainBottom } = chains;
  const { chainKey, keyCount } = forkKeys(input, chains, firstParentSha);

  const keyTop = new Int32Array(keyCount).fill(-1);
  const stackBelow = new Int32Array(chains.count).fill(-1);
  const parked = new Int32Array(chains.count).fill(-1);
  const remaining = childCount.slice();
  // A parked row re-enters the heap each time its chain becomes the stack top again, so the
  // heap has no static size bound.
  const ready = new FlatQueue<number>();
  for (let row = 0; row < rowCount; row++) {
    if (remaining[row] === 0) ready.push(row, row);
  }

  let emitted = 0;
  for (let row = ready.pop(); row !== undefined; row = ready.pop()) {
    const chain = chainOf[row];
    const key = chainKey[chain];
    if (key >= 0 && row !== chainTop[chain] && keyTop[key] !== chain) {
      parked[chain] = row;
      continue;
    }

    order[emitted++] = row;
    if (key >= 0 && row === chainTop[chain]) {
      stackBelow[chain] = keyTop[key];
      keyTop[key] = chain;
    }
    if (key >= 0 && row === chainBottom[chain]) {
      assert(keyTop[key] === chain, 'displayOrder: closing chain is not the stack top');
      const below = stackBelow[chain];
      keyTop[key] = below;
      if (below >= 0 && parked[below] >= 0) {
        ready.push(parked[below], parked[below]);
        parked[below] = -1;
      }
    }

    for (let slot = parentOffsets[row]; slot < parentOffsets[row + 1]; slot++) {
      const parent = parentRows[slot];
      if (parent >= 0 && --remaining[parent] === 0) ready.push(parent, parent);
    }
  }

  assert(emitted === rowCount, `displayOrder: emitted ${emitted} of ${rowCount} rows`);
  return order;
}
