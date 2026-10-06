import { describe, expect, test } from 'bun:test';
import { CommitStore } from '@kira/git-core';
import { GraphOrderState } from './graphOrder.ts';

function sha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

function commit(n: number, parents: number[]) {
  return {
    sha: sha(n),
    parents: parents.map(sha),
    author: { name: 'A', email: 'a@example.com', timestamp: 1000 - n },
    committer: { name: 'A', email: 'a@example.com', timestamp: 1000 - n },
    subject: `c${n}`,
    decoration: [],
  };
}

describe('GraphOrderState expansion survives a partial-store rebuild', () => {
  // P168 Part 18 F7: a restart-at-zero re-walk rebuilds before older branches have streamed in.
  test('expanded group keeps its key while its rows are not loaded yet', () => {
    const order = new GraphOrderState();
    order.setCollapseEnabled(true);
    order.setTips([
      { sha: sha(0), key: 'main', label: 'main' },
      { sha: sha(1), key: 'old', label: 'old' },
    ]);
    order.toggleGroup('old');

    const store = new CommitStore();
    store.appendPage([commit(0, [])]);
    order.rebuild(store, 0);

    store.appendPage([commit(1, [2]), commit(2, [3]), commit(3, [4]), commit(4, [])]);
    order.rebuild(store, 0);
    expect(order.plan.value.length).toBe(5);
  });
});
