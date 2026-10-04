import type { Branch, Task, TaskStatus } from '../wire';
import type { TaskProgress } from './progress';

/** Derived, never stored (D10). `Blocked` is not a workflow status, so it is not on the wire (W8). */
export type DerivedStatus = TaskStatus | 'Blocked';

export const BLOCKED_PANEL_TEXT = 'Blocked · follows the workflow: a step is stuck or failed';

export interface StatusInput {
  task: Task;
  progress: TaskProgress;
  branches: readonly Branch[];
  /** The task has any session, running or stopped. */
  hasSessions: boolean;
}

/** SPEC2 §5: finished -> Done; stuck/failed run or failed worktree setup -> Blocked; first stage with
 *  nothing started -> To do; else the current stage's configured status. */
export function deriveStatus(i: StatusInput): DerivedStatus {
  const { task, progress } = i;
  if (task.kind === 'review') return 'In review';
  if (task.kind === 'parked' || !progress.hasWorkflow) return 'To do';
  if (progress.finished) return 'Done';
  if (progress.bad) return 'Blocked';
  if (i.branches.some((b) => b.setup?.state === 'failed')) return 'Blocked';
  const untouched = progress.steps.every((s) => s.state === 'pending');
  if (progress.stageIndex === 0 && !i.hasSessions && untouched) return 'To do';
  return progress.stage?.status ?? 'In progress';
}
