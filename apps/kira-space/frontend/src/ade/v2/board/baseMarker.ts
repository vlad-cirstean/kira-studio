import { t } from '@theme/i18n';
import type { TextPart } from '@theme/varText';
import type { Branch } from '../wire';
import { type BranchGraph, isDraft, shortBranchName } from './branchGraph';
import { catalogParts } from './catalogParts';

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
    const vars = { base: p.name };
    const tip =
      p.kind === 'review'
        ? catalogParts('space.ade.baseMarker.startsFromOwner.tooltip', vars, { owner: p.owner })
        : catalogParts(
            outside
              ? 'space.ade.baseMarker.startsFromOtherTask.tooltip'
              : 'space.ade.baseMarker.startsFromNotMain.tooltip',
            vars,
          );
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
          tip: catalogParts('space.ade.baseMarker.startsFrom.tooltip', {
            base: b.base || mainName,
          }),
          pending,
        }
      : null;
  }
  const owner = b.baseOwner;
  return {
    label: ['⑂ ', base(shortBranchName(b.base))],
    tone: owner ? 'blue' : 'grey',
    tip: owner
      ? catalogParts('space.ade.baseMarker.startsFromOwner.tooltip', { base: b.base }, { owner })
      : catalogParts('space.ade.baseMarker.startsFromNotMain.tooltip', { base: b.base }),
    pending,
  };
}

/** Second-line context of a branch not created yet: `No branch yet · from <base>`. */
export function baseContext(b: Branch, graph: BranchGraph): string {
  if (!isDraft(b)) return '';
  const parent = graph.parentOf.get(b.id);
  const base =
    (parent !== undefined ? graph.byBranch.get(parent)?.name : undefined) || b.base || 'main';
  return t('space.ade.baseMarker.draft.label', { base });
}
