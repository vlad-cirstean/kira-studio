import type { TextPart } from '@theme/varText';
import type { BranchRowModel, CardModel } from '../plan/usePlanModel';
import type { Task } from '../wire';
import type { BranchGraph } from './branchGraph';

// One rule for every Review code control: hidden, disabled with a reason, or enabled with a preview.

export interface ReviewChoice {
  branchId: string;
  /** `repo · branch`, the row's own menu label. */
  label: string;
  disabled: boolean;
  /** The reason when disabled, else what the click opens. */
  tip: readonly TextPart[];
}

/** The branch the review diffs against: its stacking parent, else its base, else `main`. */
export function baseNameOf(row: BranchRowModel, graph: BranchGraph): string {
  const parent = graph.parentOf.get(row.branch.id);
  return (parent ? graph.byBranch.get(parent)?.name : '') || row.branch.base || 'main';
}

export function reviewChoice(
  row: BranchRowModel,
  task: Task,
  graph: BranchGraph,
): ReviewChoice | null {
  const b = row.branch;
  if (b.kind === 'parked') return null;
  const base: TextPart = { name: 'base', value: baseNameOf(row, graph) };
  const branch: TextPart = { name: 'branch', value: b.name };
  const choice = (disabled: boolean, tip: readonly TextPart[]): ReviewChoice => ({
    branchId: row.id,
    label: `${row.repo} · ${row.name}`,
    disabled,
    tip,
  });
  if (b.name === '') return choice(true, ['Create the branch first']);
  if (b.ahead === 0 && b.dirty.length > 0) {
    return choice(true, [
      'Only uncommitted changes on ',
      branch,
      '. Commit them to review against ',
      base,
      '.',
    ]);
  }
  if (b.ahead === 0) return choice(true, ['No commits on top of ', base, ' yet']);
  const working = task.runs.some((r) => r.branchId === row.id && r.state === 'running');
  const tip: TextPart[] = ['Review ', branch, ' against ', base];
  if (working) tip.push('\nAn agent is still working: the review updates as it commits');
  return choice(false, tip);
}

export function reviewChoices(card: CardModel, graph: BranchGraph): ReviewChoice[] {
  return card.rows.flatMap((row) => reviewChoice(row, card.task, graph) ?? []);
}

/** Tooltip of a task-level control: the branch's own tip when there is one, else a prompt to pick. */
export function taskReviewTip(choices: readonly ReviewChoice[]): readonly TextPart[] {
  return choices.length === 1 ? choices[0].tip : ['Pick a branch to review'];
}
