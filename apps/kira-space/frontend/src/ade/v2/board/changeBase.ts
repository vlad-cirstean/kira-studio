import type { TextPart } from '@theme/varText';
import type { BranchRowModel, CardModel } from '../plan/usePlanModel';
import type { Board } from '../wire';
import type { BranchGraph } from './branchGraph';
import { baseOf, type RebaseAct, rebaseActs } from './rebaseActions';

/** One Change base target of a task: a branch of mine, created or not. */
export interface ChangeBaseChoice {
  branchId: string;
  /** `repo · branch`, the menu label. */
  label: string;
  /** `Change base of [branch] (now [base])`, or why it is off. */
  tip: readonly TextPart[];
  /** Menu text with the current base as a variable. */
  parts: readonly TextPart[];
  disabled: boolean;
  act: RebaseAct;
}

interface Ctx {
  graph: BranchGraph;
  after: ReadonlyMap<string, { id: string; file: string }>;
  board: Pick<Board, 'repos'>;
}

export function changeBaseChoices(card: CardModel, c: Ctx): ChangeBaseChoice[] {
  return card.rows.flatMap((row: BranchRowModel) => {
    const mainName =
      c.board.repos.find((r) => r.codeRepoId === row.branch.codeRepoId)?.mainName ?? '';
    const act = rebaseActs({
      branch: row.branch,
      graph: c.graph,
      after: c.after,
      runs: card.task.runs,
      mainName,
    }).find((a) => a.kind === 'changeBase');
    if (!act) return [];
    return [
      {
        branchId: row.id,
        label: `${row.repo} · ${row.name}`,
        tip: act.tip,
        parts: [
          `${row.repo} · ${row.name} · `,
          { name: 'base', value: baseOf(row.branch, c.graph, mainName) },
        ],
        disabled: act.disabled,
        act,
      },
    ];
  });
}
