import type { TextPart } from '@theme/varText';
import type { Branch } from '../wire';
import { type BranchGraph, isDraft, shortBranchName } from './branchGraph';

export interface BaseMarker {
  /** `⑂` for a base inside the same task, else `⑂ <base without its first path segment>`. */
  label: TextPart[];
  /** Blue when the base is someone else's branch, else grey. */
  tone: 'grey' | 'blue';
  tip: TextPart[];
  /** The base changed and no verified rebase has moved the branch onto it yet. */
  pending: boolean;
}

const base = (value: string): TextPart => ({ name: 'base', value });

/** Mockup v2 line 1818: nothing when the branch starts from main. */
export function baseMarker(b: Branch, graph: BranchGraph, mainName: string): BaseMarker | null {
  const pending = b.basePendingFrom !== '';
  const parent = graph.parentOf.get(b.id);
  const p = parent === undefined ? undefined : graph.byBranch.get(parent);
  if (p) {
    const outside = p.taskId !== b.taskId;
    const tip: TextPart[] = [
      'starts from ',
      base(p.name),
      p.kind === 'review' ? ` (${p.owner}’s branch)` : outside ? ' (another task)' : '',
      ', not main',
    ];
    return {
      label: outside ? ['⑂ ', base(shortBranchName(p.name))] : ['⑂'],
      tone: p.kind === 'review' ? 'blue' : 'grey',
      tip,
      pending,
    };
  }
  if (b.base === '' || b.base === mainName) {
    return pending
      ? {
          label: ['⑂ ', base(b.base || mainName)],
          tone: 'grey',
          tip: ['starts from ', base(b.base || mainName)],
          pending,
        }
      : null;
  }
  const owner = b.baseOwner;
  return {
    label: ['⑂ ', base(shortBranchName(b.base))],
    tone: owner ? 'blue' : 'grey',
    tip: ['starts from ', base(b.base), owner ? ` (${owner}’s branch)` : '', ', not main'],
    pending,
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
