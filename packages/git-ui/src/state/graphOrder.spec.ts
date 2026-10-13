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

describe('GraphOrderState tips that run ahead of the store', () => {
  // P278: refs reload before the graph re-walks, so a tip can name a commit the store lacks.
  const main = (n: number) => ({ sha: sha(n), key: 'branch:main', label: 'main' });
  const side = (n: number) => ({ sha: sha(n), key: 'ref:side', label: 'side' });

  function loaded(withHead = false): CommitStore {
    const store = new CommitStore();
    store.appendPage([
      ...(withHead ? [commit(99, [0])] : []),
      commit(0, [1]),
      commit(1, [2]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, []),
      commit(10, [11]),
      commit(11, [12]),
      commit(12, [13]),
      commit(13, [14]),
      commit(14, []),
    ]);
    return store;
  }

  function build(tips: ReturnType<typeof main>[], store: CommitStore, collapse = true) {
    const order = new GraphOrderState();
    order.setCollapseEnabled(collapse);
    order.setTips(tips);
    order.rebuild(store, 0);
    return order;
  }

  test('HEAD moved past the loaded history keeps its group expanded on the old sha', () => {
    const store = loaded();
    const order = build([main(0), side(10)], store);
    const before = order.plan.value.length;

    order.setTips([main(99), side(10)]);
    order.rebuild(store, 0);
    expect(order.plan.value.length).toBe(before);
    expect(order.plan.value.entryAt(4).kind).toBe('commit');
  });

  test('HEAD adopts the new sha once the store holds it', () => {
    const store = loaded();
    const order = build([main(0), side(10)], store);
    order.setTips([main(99), side(10)]);
    order.rebuild(store, 0);

    const rewalked = loaded(true);
    order.rebuild(rewalked, 0);
    expect(order.plan.value.storeRowAt(0)).toBe(rewalked.rowOfSha(sha(99)));
  });

  test('a moved side branch keeps its rows grouped', () => {
    const store = loaded();
    const order = build([main(0), side(10)], store);

    order.setTips([main(0), side(77)]);
    order.rebuild(store, 0);
    const plan = order.plan.value;
    expect(plan.groupKeyAt(plan.containingDisplayRow(store.rowOfSha(sha(12))))).toBe('ref:side');
  });

  test('a detached HEAD changing key keeps the old sha for group 0', () => {
    const store = loaded();
    const order = build([{ sha: sha(0), key: 'detached:a', label: 'a' }], store);
    const before = order.plan.value.length;

    order.setTips([{ sha: sha(99), key: 'detached:b', label: 'b' }]);
    order.rebuild(store, 0);
    expect(order.plan.value.length).toBe(before);
    expect(order.plan.value.entryAt(0).kind).toBe('commit');
  });

  test('a tip the store lacks, with no earlier sha, stays an empty group', () => {
    const store = loaded();
    const order = build([main(0), side(88)], store);
    expect(order.plan.value.length).toBeGreaterThan(0);
    expect(order.plan.value.storeRowAt(0)).toBe(0);
  });
});
