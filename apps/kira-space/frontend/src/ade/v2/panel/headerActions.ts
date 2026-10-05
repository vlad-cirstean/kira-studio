import type { Tone } from '../board/actions';
import { type BranchGraph, shortBranchName } from '../board/branchGraph';
import type { Branch } from '../wire';

// Branch panel header actions beyond Force push and Retry setup (mockup `acts2`): rebase onto main
// or a branch, queue after a conflicting review branch, re-merge a stale target, start an agent.

export type HeaderAction =
  | { kind: 'rebaseMain'; label: string; tone: Tone; rootId: string }
  | { kind: 'rebaseOnto'; label: string; tone: Tone; ontoId: string }
  | { kind: 'queueAfter'; label: string; tone: Tone; withId: string }
  | { kind: 'remerge'; label: string; tone: Tone; target: string }
  | { kind: 'start'; label: string; tone: 'claude' }
  | { kind: 'review'; label: string; tone: 'grey' }
  | { kind: 'created'; label: string; tone: 'grey' };

export interface HeaderInput {
  branch: Branch;
  graph: BranchGraph;
  /** `TimelineView.after`: the earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  hadSession: boolean;
}

export function headerActions(i: HeaderInput): HeaderAction[] {
  const b = i.branch;
  if (b.name === '') {
    return [{ kind: 'created', label: 'Created when the pipeline runs', tone: 'grey' }];
  }
  const review: HeaderAction = { kind: 'review', label: 'Review code', tone: 'grey' };
  if (b.kind !== 'mine' || b.mergedIntoMain) return [review];
  const out: HeaderAction[] = [];
  const rootId = i.graph.rootOf(b.id);
  const root = i.graph.byBranch.get(rootId);
  if (root?.kind === 'mine' && root.behind > 0) {
    out.push({ kind: 'rebaseMain', label: 'Rebase onto main', tone: 'amber', rootId });
  }
  const follow = i.after.get(b.id);
  const followName = follow ? i.graph.byBranch.get(follow.id)?.name : undefined;
  if (follow && followName) {
    out.push({
      kind: 'rebaseOnto',
      label: `Rebase onto ${shortBranchName(followName)}`,
      tone: 'amber',
      ontoId: follow.id,
    });
  }
  const conf = i.graph.conflicts.get(b.id)?.[0];
  const confName = conf ? i.graph.byBranch.get(conf.with)?.name : undefined;
  if (conf && confName) {
    out.push({
      kind: 'queueAfter',
      label: `Queue after ${shortBranchName(confName)}`,
      tone: 'red',
      withId: conf.with,
    });
  }
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
  out.push(review);
  return out;
}
