import type { Tone } from '../board/actions';
import type { BranchGraph } from '../board/branchGraph';
import { type RebaseAct, rebaseActs } from '../board/rebaseActions';
import type { Branch, Run } from '../wire';

// Branch panel header actions beyond Force push and Retry setup (mockup `acts2`): the rebase acts,
// re-merge a stale target, start an agent.

export type HeaderAction =
  | { kind: 'rebase'; label: string; tone: Tone; act: RebaseAct }
  | { kind: 'remerge'; label: string; tone: Tone; target: string }
  | { kind: 'start'; label: string; tone: 'claude' }
  | { kind: 'automation'; label: string; tone: 'grey' }
  | { kind: 'review'; label: string; tone: 'grey' }
  | { kind: 'created'; label: string; tone: 'grey' };

export interface HeaderInput {
  branch: Branch;
  graph: BranchGraph;
  /** `TimelineView.after`: the earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  hadSession: boolean;
  runs: readonly Run[];
  mainName: string;
}

const plain = (parts: readonly (string | { value: string })[]): string =>
  parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');

const ACT_TONE: Record<RebaseAct['kind'], Tone> = {
  rebase: 'amber',
  queue: 'red',
  changeBase: 'grey',
  abortRebase: 'red',
};

export function headerActions(i: HeaderInput): HeaderAction[] {
  const b = i.branch;
  const review: HeaderAction = { kind: 'review', label: 'Review code', tone: 'grey' };
  const acts = rebaseActs({
    branch: b,
    graph: i.graph,
    after: i.after,
    runs: i.runs,
    mainName: i.mainName,
  });
  const asHeader = (a: RebaseAct): HeaderAction => ({
    kind: 'rebase',
    label: plain(a.label),
    tone: ACT_TONE[a.kind],
    act: a,
  });
  if (b.name === '') {
    return [
      { kind: 'created', label: 'Created when the pipeline runs', tone: 'grey' },
      ...acts.map(asHeader),
    ];
  }
  if (b.kind !== 'mine' || b.mergedIntoMain) return [review];
  const out: HeaderAction[] = acts.map(asHeader);
  for (const g of b.integration) {
    if (g.status === 'stale') {
      out.push({
        kind: 'remerge',
        label: `Re-merge into ${g.target}`,
        tone: 'amber',
        target: g.target,
      });
    }
  }
  const setupOk = b.setup === null || b.setup.state === 'ready';
  if (!i.hadSession && setupOk) out.push({ kind: 'start', label: '▶ Start agent', tone: 'claude' });
  out.push({ kind: 'automation', label: 'Run automation…', tone: 'grey' }, review);
  return out;
}
