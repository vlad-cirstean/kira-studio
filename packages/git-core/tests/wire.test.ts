import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { CommitRecord } from '../src/model/commit';
import { CommitStore, packedTransferList } from '../src/store/commitStore';
import { fan, octopusOf, topology } from './topology';

/** Every row's accessors must match between two stores holding the same commits. */
function expectSameContents(a: CommitStore, b: CommitStore): void {
  expect(b.rowCount).toBe(a.rowCount);
  for (let row = 0; row < a.rowCount; row++) {
    expect(b.shaAt(row)).toBe(a.shaAt(row));
    expect(b.subjectAt(row)).toBe(a.subjectAt(row));
    expect(b.authorAt(row)).toEqual(a.authorAt(row));
    expect(b.committerAt(row)).toEqual(a.committerAt(row));
    expect(Array.from(b.parentsOf(row))).toEqual(Array.from(a.parentsOf(row)));
    expect(b.decorationAt(row)).toEqual(a.decorationAt(row));
    expect(b.commitAt(row)).toEqual(a.commitAt(row));
  }
}

const SHAPES: readonly (readonly [name: string, records: CommitRecord[]])[] = [
  ['linear + a merge', topology(['A', 'B:A', 'C:A', 'D:B,C'])],
  ['a fan of branches', fan(5, 3)],
  ['a 3-parent octopus', octopusOf(3)],
  ['a 12-parent octopus', octopusOf(12)],
];

describe('CommitStore wire format — packSlice/appendPacked', () => {
  for (const [name, records] of SHAPES) {
    test(`round-trips ${name} through a single packed chunk`, () => {
      const source = new CommitStore();
      source.appendPage(records);

      const chunk = source.packSlice(0, source.rowCount, 0);
      const receiver = new CommitStore();
      const result = receiver.appendPacked(chunk);

      expect(result.from).toBe(0);
      expect(result.to).toBe(source.rowCount);
      expectSameContents(source, receiver);
    });
  }

  test('page-by-page packing equals one-shot packing', () => {
    const records = fan(8, 6);
    const source = new CommitStore();
    source.appendPage(records);

    const oneShot = new CommitStore();
    oneShot.appendPacked(source.packSlice(0, source.rowCount, 0));

    const pageByPage = new CommitStore();
    const mid = Math.floor(source.rowCount / 2);
    const firstChunk = source.packSlice(0, mid, 0);
    pageByPage.appendPacked(firstChunk);
    const secondChunk = source.packSlice(mid, source.rowCount, firstChunk.dictionary.length);
    pageByPage.appendPacked(secondChunk);

    expectSameContents(oneShot, pageByPage);
    expectSameContents(source, pageByPage);
  });

  test("a page boundary that splits a child from its not-yet-loaded parent still resolves once the parent's page lands", () => {
    // --topo-order emits a child before its parent; packing the child alone must leave that
    // parent slot unresolved on the receiver until the parent's own chunk arrives, exactly like
    // `appendPage`'s own page-boundary behaviour.
    const records = topology(['A', 'B:A']); // records[0] = B (child), records[1] = A (parent)
    const source = new CommitStore();
    source.appendPage(records);

    const receiver = new CommitStore();
    const firstChunk = source.packSlice(0, 1, 0);
    const first = receiver.appendPacked(firstChunk);
    expect(Array.from(receiver.parentsOf(0))).toEqual([-1]);
    expect(first.resolvedParentSlots).toHaveLength(0);
    expect(receiver.commitAt(0).parents).toEqual([records[1]?.sha as string]);

    const second = receiver.appendPacked(source.packSlice(1, 2, firstChunk.dictionary.length));
    expect(second.resolvedParentSlots).toEqual(Uint32Array.from([0]));
    expect(Array.from(receiver.parentsOf(0))).toEqual([1]);
    expectSameContents(source, receiver);
  });

  test('structuredClone with packedTransferList round-trips and detaches every source buffer', () => {
    const source = new CommitStore();
    source.appendPage(octopusOf(4));
    const chunk = source.packSlice(0, source.rowCount, 0);
    const transfer = packedTransferList(chunk);
    expect(transfer).toHaveLength(7);

    const cloned = structuredClone(chunk, { transfer });
    for (const buffer of transfer) expect(buffer.byteLength).toBe(0);

    const receiver = new CommitStore();
    receiver.appendPacked(cloned);
    expectSameContents(source, receiver);
  });

  test("appendPacked throws when a chunk's dictionaryBase doesn't match the receiver's interner", () => {
    const source = new CommitStore();
    source.appendPage(fan(3, 3));
    const chunk = source.packSlice(0, source.rowCount, 0);
    const receiver = new CommitStore();
    const mismatched = { ...chunk, dictionaryBase: chunk.dictionaryBase + 1 };
    expect(() => receiver.appendPacked(mismatched)).toThrow(/dictionaryBase/);
  });

  test("appendPacked throws when a chunk doesn't start where the receiver's rows end", () => {
    const source = new CommitStore();
    source.appendPage(fan(4, 4));
    const receiver = new CommitStore();
    const firstChunk = source.packSlice(0, 4, 0);
    receiver.appendPacked(firstChunk);
    const staleChunk = source.packSlice(4, 8, firstChunk.dictionary.length);
    const outOfOrder = { ...staleChunk, from: staleChunk.from + 1 };
    expect(() => receiver.appendPacked(outOfOrder)).toThrow(/chunks must be applied in order/);
  });

  test('a sha-256 store round-trips through packSlice/appendPacked', () => {
    function sha256For(name: string): string {
      return createHash('sha256').update(`wire-fixture-sha256:${name}`).digest('hex');
    }
    const identity = {
      name: 'Kira Fixture',
      email: 'fixture@kira-version.test',
      timestamp: 1_700_000_000,
    };
    const records: CommitRecord[] = [
      {
        sha: sha256For('B'),
        parents: [sha256For('A')],
        author: identity,
        committer: identity,
        subject: 'B',
        decoration: [{ kind: 'branch', name: 'main', isHead: true }],
      },
      {
        sha: sha256For('A'),
        parents: [],
        author: identity,
        committer: identity,
        subject: 'A',
        decoration: [],
      },
    ];
    const source = new CommitStore();
    source.appendPage(records);

    const chunk = source.packSlice(0, source.rowCount, 0);
    expect(chunk.shaWidthBytes).toBe(32);
    const receiver = new CommitStore();
    receiver.appendPacked(chunk);
    expectSameContents(source, receiver);
  });
});
