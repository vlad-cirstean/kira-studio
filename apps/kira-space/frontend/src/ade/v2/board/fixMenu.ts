import type { BranchGraph } from './branchGraph';

/** The branch row's right-click menu (mockup `branchMenu`): what can be fixed on a created mine
 *  branch, one item per fix. */

export type FixItem =
  | { id: string; kind: 'merge'; label: string; target: string }
  | { id: string; kind: 'rebaseMain'; label: string; rootId: string }
  | { id: string; kind: 'rebaseOnto'; label: string; onto: string }
  | { id: string; kind: 'forcePush'; label: string };

export interface FixInput {
  branchId: string;
  graph: BranchGraph;
  /** The repo's integration branches. */
  targets: readonly string[];
  /** `TimelineView.after`: earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  unpushed: Readonly<Record<string, boolean>>;
}

/** `null` for a draft or a branch that is not mine: those get no menu. */
export function fixItems(i: FixInput): FixItem[] | null {
  const b = i.graph.byBranch.get(i.branchId);
  if (!b || b.name === '' || b.kind !== 'mine') return null;
  const out: FixItem[] = [];
  for (const target of i.targets) {
    const status = b.integration.find((x) => x.target === target)?.status ?? 'not merged';
    if (status === 'merged') continue;
    out.push({
      id: `ade-fix-merge-${target}`,
      kind: 'merge',
      label: status === 'stale' ? `Re-merge into ${target} (stale)` : `Merge into ${target}`,
      target,
    });
  }
  const rootId = i.graph.rootOf(b.id);
  const root = i.graph.byBranch.get(rootId);
  if (root && root.kind === 'mine' && root.behind > 0) {
    out.push({ id: 'ade-fix-rebase-main', kind: 'rebaseMain', label: 'Rebase onto main', rootId });
  }
  const a = i.after.get(b.id);
  if (a) {
    const name = i.graph.byBranch.get(a.id)?.name ?? a.id;
    out.push({
      id: 'ade-fix-rebase-onto',
      kind: 'rebaseOnto',
      label: `Rebase onto ${name}`,
      onto: a.id,
    });
  }
  if (i.unpushed[b.id])
    out.push({ id: 'ade-fix-force-push', kind: 'forcePush', label: 'Force push' });
  return out;
}
