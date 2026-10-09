import type { TextPart } from '@theme/varText';
import type { Run } from '../wire';
import type { BranchGraph } from './branchGraph';
import { type RebaseAct, rebaseActs } from './rebaseActions';

/** The branch row's right-click menu (mockup `branchMenu`): what can be fixed on a created mine
 *  branch, one item per fix. */

export type FixItem =
  | { id: string; kind: 'merge'; label: string; target: string }
  | { id: string; kind: 'act'; label: string; act: RebaseAct; hint: readonly TextPart[] }
  | { id: string; kind: 'forcePush'; label: string };

export interface FixInput {
  branchId: string;
  graph: BranchGraph;
  /** The repo's integration branches. */
  targets: readonly string[];
  /** `TimelineView.after`: earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  unpushed: Readonly<Record<string, boolean>>;
  runs: readonly Run[];
  /** Short name of the repo's main branch, `''` when unresolved. */
  mainName: string;
}

const plain = (parts: readonly TextPart[]): string =>
  parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');

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
  const acts = rebaseActs({
    branch: b,
    graph: i.graph,
    after: i.after,
    runs: i.runs,
    mainName: i.mainName,
  });
  for (const act of acts) {
    out.push({ id: `ade-fix-${act.id}`, kind: 'act', label: plain(act.label), act, hint: act.tip });
  }
  if (i.unpushed[b.id])
    out.push({ id: 'ade-fix-force-push', kind: 'forcePush', label: 'Force push' });
  return out;
}
