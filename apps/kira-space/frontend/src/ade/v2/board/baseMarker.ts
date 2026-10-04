import type { Branch } from '../wire';
import { type BranchGraph, isDraft, shortBranchName } from './branchGraph';

export interface BaseMarker {
  /** `⑂` for a base inside the same task, else `⑂ <base without its first path segment>`. */
  label: string;
  /** Blue when the base is someone else's branch, else grey. */
  tone: 'grey' | 'blue';
  tip: string;
}

/** Mockup v2 line 1818: nothing when the branch starts from main. */
export function baseMarker(b: Branch, graph: BranchGraph, mainName: string): BaseMarker | null {
  const parent = graph.parentOf.get(b.id);
  const p = parent === undefined ? undefined : graph.byBranch.get(parent);
  if (p) {
    const outside = p.taskId !== b.taskId;
    const tip =
      `starts from ${p.name}` +
      (p.kind === 'review' ? ` (${p.owner}’s branch)` : outside ? ' (another task)' : '') +
      ', not main';
    return {
      label: outside ? `⑂ ${shortBranchName(p.name)}` : '⑂',
      tone: p.kind === 'review' ? 'blue' : 'grey',
      tip,
    };
  }
  if (b.base === '' || b.base === mainName) return null;
  const owner = b.baseOwner;
  return {
    label: `⑂ ${shortBranchName(b.base)}`,
    tone: owner ? 'blue' : 'grey',
    tip: `starts from ${b.base}${owner ? ` (${owner}’s branch)` : ''}, not main`,
  };
}

/** Second-line context of a branch not created yet: `no branch yet · from <base>`. */
export function baseContext(b: Branch, graph: BranchGraph): string {
  if (!isDraft(b)) return '';
  const parent = graph.parentOf.get(b.id);
  const base =
    (parent !== undefined ? graph.byBranch.get(parent)?.name : undefined) || b.base || 'main';
  return `no branch yet · from ${base}`;
}
