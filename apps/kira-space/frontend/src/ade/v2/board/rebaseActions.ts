import type { TextPart } from '@theme/varText';
import type { BaseChoice, Branch, Run } from '../wire';
import type { BranchGraph } from './branchGraph';

// The one rule behind every rebase control: tag action, fix menu, panel header, task menu and card
// button. `rebaseActs` says which acts a branch has; `adeDialogs.act` runs one.

interface ActBase {
  id: string;
  label: TextPart[];
  /** The branch the act applies to (a stack root for a rebase onto the stack's base). */
  branchId: string;
  tip: TextPart[];
  disabled: boolean;
}

export type RebaseAct =
  | (ActBase & { kind: 'rebase'; onto: BaseChoice | null; retry: boolean })
  | (ActBase & { kind: 'queue'; withId: string })
  | (ActBase & { kind: 'changeBase'; draft: boolean })
  | (ActBase & { kind: 'abortRebase' });

export interface RebaseActInput {
  branch: Branch;
  graph: BranchGraph;
  /** `TimelineView.after`: earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  /** Runs of the branch's task. */
  runs: readonly Run[];
  /** Short name of the repo's main branch, `''` when unresolved. */
  mainName: string;
}

const part = (name: string, value: string): TextPart => ({ name, value });

/** The base a branch shows: its stacking parent, else its stored base, else main. */
export function baseOf(b: Branch, graph: BranchGraph, mainName: string): string {
  const parent = graph.parentOf.get(b.id);
  const p = parent === undefined ? undefined : graph.byBranch.get(parent);
  return p?.name || b.base || mainName || 'main';
}

/** The branch plus every created branch of mine stacked on it, depth first. */
export function stackIds(graph: BranchGraph, rootId: string): string[] {
  const out = [rootId];
  const down = (id: string): void => {
    for (const c of graph.kids.get(id) ?? []) {
      const kid = graph.byBranch.get(c);
      if (kid && kid.kind === 'mine' && kid.name !== '') {
        out.push(c);
        down(c);
      }
    }
  };
  down(rootId);
  return out;
}

function workingOn(i: RebaseActInput, rootId: string): Branch | null {
  const ids = new Set(stackIds(i.graph, rootId));
  const run = i.runs.find(
    (r) => ids.has(r.branchId) && (r.state === 'running' || r.state === 'pending'),
  );
  return run ? (i.graph.byBranch.get(run.branchId) ?? null) : null;
}

/** Why an act on `rootId` cannot start now, `null` when it can. */
function blocker(i: RebaseActInput, rootId: string, needsBase: boolean): TextPart[] | null {
  const busy = workingOn(i, rootId);
  if (busy) return ['A run is working on ', part('branch', busy.name)];
  if (needsBase) {
    const b = i.graph.byBranch.get(rootId);
    if (b?.baseMissing)
      return ['Base ', part('base', b.base), ' no longer exists. Change the base first'];
  }
  return null;
}

function baseLabel(i: RebaseActInput, id: string): TextPart {
  return part('base', baseOf(i.graph.byBranch.get(id) as Branch, i.graph, i.mainName));
}

function lastRebaseRun(i: RebaseActInput, branchId: string): Run | null {
  return i.runs
    .filter((r) => r.purpose === 'rebase' && r.branchId === branchId)
    .reduce<Run | null>((best, r) => (!best || r.attempt >= best.attempt ? r : best), null);
}

function rebaseTargets(i: RebaseActInput, rootId: string): { id: string; retry: boolean }[] {
  const b = i.branch;
  const root = i.graph.byBranch.get(rootId) as Branch;
  const conflicts = b.conflictCheck === 'done' && b.conflictsIfRebased.length > 0;
  const lastRun = lastRebaseRun(i, b.id);
  const retry =
    b.basePendingFrom !== '' || lastRun?.state === 'failed' || lastRun?.state === 'stuck';
  const targets: { id: string; retry: boolean }[] = [];
  if (retry) targets.push({ id: b.id, retry: true });
  else if (conflicts && rootId !== b.id) targets.push({ id: b.id, retry: false });
  const rootStale = root.behind > 0 || (conflicts && rootId === b.id);
  if (root.kind === 'mine' && rootStale && !(retry && rootId === b.id)) {
    targets.push({ id: rootId, retry: false });
  }
  return targets;
}

function rebaseBaseActs(i: RebaseActInput, rootId: string): RebaseAct[] {
  const b = i.branch;
  return rebaseTargets(i, rootId).map((t) => {
    const why = blocker(i, t.id, true);
    let id = 'rebase-base';
    if (t.retry) id = 'rebase-retry';
    else if (t.id === b.id && rootId !== b.id) id = 'rebase-self';
    return {
      kind: 'rebase',
      id,
      label: [t.retry ? 'Retry rebase onto ' : 'Rebase onto ', baseLabel(i, t.id)],
      branchId: t.id,
      onto: null,
      retry: t.retry,
      tip: why ?? [
        'Rebase ',
        part('branch', (i.graph.byBranch.get(t.id) as Branch).name),
        ' onto ',
        baseLabel(i, t.id),
      ],
      disabled: why !== null,
    };
  });
}

function followAct(i: RebaseActInput): RebaseAct[] {
  const b = i.branch;
  const follow = i.after.get(b.id);
  const followName = follow ? i.graph.byBranch.get(follow.id)?.name : undefined;
  if (!follow || !followName) return [];
  const why = blocker(i, b.id, false);
  return [
    {
      kind: 'rebase',
      id: 'rebase-onto',
      label: ['Rebase onto ', part('base', followName)],
      branchId: b.id,
      onto: { ref: '', branchId: follow.id },
      retry: false,
      tip: why ?? ['Shares ', follow.file, ' with ', part('base', followName), '; rebase onto it'],
      disabled: why !== null,
    },
  ];
}

function queueAct(i: RebaseActInput, rootId: string): RebaseAct[] {
  const conf = i.graph.conflicts.get(i.branch.id)?.[0];
  const confBranch = conf ? i.graph.byBranch.get(conf.with) : undefined;
  if (!conf || !confBranch) return [];
  const why = blocker(i, rootId, false);
  const label: TextPart[] = ['Queue after ', part('base', confBranch.name)];
  const tip = why ?? [
    'Conflicts with ',
    part('base', confBranch.name),
    `: ${conf.files.join(', ')}`,
  ];
  if (confBranch.kind === 'review') {
    return [
      {
        kind: 'queue',
        id: 'queue',
        label,
        branchId: rootId,
        withId: conf.with,
        tip,
        disabled: why !== null,
      },
    ];
  }
  return [
    {
      kind: 'rebase',
      id: 'queue',
      label,
      branchId: rootId,
      onto: { ref: '', branchId: conf.with },
      retry: false,
      tip,
      disabled: why !== null,
    },
  ];
}

function baseActs(i: RebaseActInput): RebaseAct[] {
  const b = i.branch;
  const draft = b.name === '';
  const nowOn = baseOf(b, i.graph, i.mainName);
  const cbWhy = draft ? null : blocker(i, i.graph.rootOf(b.id), false);
  const out: RebaseAct[] = [
    {
      kind: 'changeBase',
      id: 'change-base',
      label: ['Change base…'],
      branchId: b.id,
      draft,
      tip: cbWhy ?? [
        'Change base of ',
        part('branch', draft ? 'the new branch' : b.name),
        ' (now ',
        part('base', nowOn),
        ')',
      ],
      disabled: cbWhy !== null,
    },
  ];
  if (!draft && b.rebaseInProgress) {
    out.push({
      kind: 'abortRebase',
      id: 'abort-rebase',
      label: ['Abort rebase'],
      branchId: b.id,
      tip: ['Run git rebase --abort in ', part('branch', b.name)],
      disabled: workingOn(i, b.id) !== null,
    });
  }
  return out;
}

export function rebaseActs(i: RebaseActInput): RebaseAct[] {
  const b = i.branch;
  if (b.kind !== 'mine' || b.mergedIntoMain) return [];
  if (b.name === '') return baseActs(i);
  const rootId = i.graph.rootOf(b.id);
  return [...rebaseBaseActs(i, rootId), ...followAct(i), ...queueAct(i, rootId), ...baseActs(i)];
}
