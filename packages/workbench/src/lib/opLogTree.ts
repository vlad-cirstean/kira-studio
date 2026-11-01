export interface OpTreeRow<R> {
  record: R;
  depth: number;
  /** Has a parent op that is not in the list: the row keeps its "Via <tool>" note. */
  viaParent: boolean;
}

export const MAX_OP_DEPTH = 3;

/** Orders a newest-first record list as a tree: a child sits under its parent, oldest child first,
 *  indented one step per level (capped at `MAX_OP_DEPTH`). A child whose parent is not in the list,
 *  or whose parent chain loops, stays top-level. Every record appears exactly once. */
export function orderOpTree<R extends { id: string; startedAt: string }>(
  records: readonly R[],
  parentOf: ((r: R) => string | null) | undefined,
): OpTreeRow<R>[] {
  if (!parentOf) return records.map((record) => ({ record, depth: 0, viaParent: false }));

  const byId = new Map(records.map((r) => [r.id, r]));
  const parentIdOf = (r: R): string | null => {
    const id = parentOf(r);
    return id && id !== r.id && byId.has(id) ? id : null;
  };

  // A record on a cycle never reaches a root; the newest member of each cycle becomes one.
  const inCycle = new Set<string>();
  for (const start of records) {
    const seen = new Set<string>();
    let cur: R | undefined = start;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const pid = parentIdOf(cur);
      cur = pid === null ? undefined : byId.get(pid);
    }
    if (cur && cur.id === start.id) inCycle.add(start.id);
  }
  const roots = new Set<string>();
  for (const r of records) {
    if (!inCycle.has(r.id)) continue;
    const members: R[] = [];
    let cur: R | undefined = r;
    do {
      members.push(cur);
      const pid: string | null = parentIdOf(cur);
      cur = pid === null ? undefined : byId.get(pid);
    } while (cur && cur.id !== r.id);
    // records is newest first, so the lowest index is the newest member.
    const newest = members.reduce((a, b) => (records.indexOf(a) <= records.indexOf(b) ? a : b));
    roots.add(newest.id);
  }

  const children = new Map<string, R[]>();
  const top: R[] = [];
  for (const r of records) {
    const pid = parentIdOf(r);
    if (pid === null || roots.has(r.id)) top.push(r);
    else children.set(pid, [...(children.get(pid) ?? []), r]);
  }

  const out: OpTreeRow<R>[] = [];
  const visit = (r: R, depth: number): void => {
    out.push({ record: r, depth, viaParent: depth === 0 && (parentOf(r) ?? '') !== '' });
    const kids = (children.get(r.id) ?? [])
      .slice()
      .reverse()
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    for (const kid of kids) visit(kid, Math.min(depth + 1, MAX_OP_DEPTH));
  };
  for (const r of top) visit(r, 0);
  return out;
}
