import { describe, expect, test } from 'bun:test';
import { CommitStore, identityRowPlan, type LayoutChunk } from '@kira/git-core';
import { readSlice } from './graphColumn.ts';
import { type EdgeSegment, LayoutStore } from './layoutStore.ts';

// P168 Part 18 F1: grouped mode publishes a new plan before its layout lands.
describe('readSlice', () => {
  test('draws no lane while the layout belongs to an older plan', () => {
    const store = new CommitStore();
    store.appendPage([
      {
        sha: 'a'.repeat(40),
        parents: [],
        author: { name: 'A', email: 'a@example.com', timestamp: 1 },
        committer: { name: 'A', email: 'a@example.com', timestamp: 1 },
        subject: 's',
        decoration: [],
      },
    ]);
    const layout = new LayoutStore();
    const chunk: LayoutChunk = {
      from: 0,
      to: 1,
      laneOf: new Uint32Array([1]),
      colorOf: new Uint32Array(1),
      edges: new Uint32Array(0),
      edgeIndex: new Uint32Array(2),
      patches: new Uint32Array(0),
      laneCount: 2,
      maxEdgeSpan: 0,
      transfer: [],
    };
    layout.append(chunk);
    const plan = identityRowPlan(1);
    const reusable: EdgeSegment[] = [];
    expect(readSlice(layout, store, plan, 0, reusable, true).lane).toBe(1);
    expect(readSlice(layout, store, plan, 0, reusable, false).lane).toBeUndefined();
  });
});
