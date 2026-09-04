import { describe, expect, test } from 'bun:test';
import { CommitStore } from '../src/store/commitStore';
import { octopusOf, topology } from './topology';

describe('CommitStore.layoutInput', () => {
  test('returns the requested row range and the full parent CSR', () => {
    const records = topology(['A', 'B:A', 'C:B']);
    const store = new CommitStore();
    store.appendPage(records);
    const input = store.layoutInput(0, 3);
    expect(input.from).toBe(0);
    expect(input.to).toBe(3);
    expect(input.parentOffsets).toHaveLength(4); // rowCount + 1
    expect(input.parentRows.length).toBeGreaterThan(0);
  });

  test('resolvedParentSlots accumulates across many append() calls and clears once read', () => {
    const records = octopusOf(4);
    const store = new CommitStore();
    const merge = records[0] as (typeof records)[number];
    const tips = records.slice(1, 5);
    const base = records[5] as (typeof records)[number];

    store.append(merge);
    for (const tip of tips) store.append(tip);
    store.append(base);

    const input = store.layoutInput(0, store.rowCount);
    // 4 slots from tips resolving the merge's parents, 4 more from base resolving the tips'.
    expect(input.resolvedParentSlots).toHaveLength(8);

    const second = store.layoutInput(0, store.rowCount);
    expect(second.resolvedParentSlots).toHaveLength(0);
  });

  test('layoutInput rejects an out-of-range request', () => {
    const store = new CommitStore();
    store.appendPage(topology(['A']));
    expect(() => store.layoutInput(0, 5)).toThrow();
    expect(() => store.layoutInput(-1, 1)).toThrow();
  });
});
