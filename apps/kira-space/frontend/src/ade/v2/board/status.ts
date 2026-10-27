import type { Branch, Task, TaskStatusDef } from '../wire';
import type { TaskProgress } from './progress';

/** The task's stored status; an id missing from the set shows as the first status of the kind's default category. */
export function statusOf(task: Task, statuses: readonly TaskStatusDef[]): TaskStatusDef {
  const found = statuses.find((s) => s.id === task.statusId);
  if (found) return found;
  const category = task.kind === 'review' ? 'review' : 'todo';
  return (
    statuses.find((s) => s.category === category) ?? {
      id: task.statusId,
      name: task.statusId,
      tone: 'grey',
      category,
    }
  );
}

/** A stuck or failed run, or a failed worktree setup. Not a status: it shows beside the status. */
export function blocked(task: Task, progress: TaskProgress, branches: readonly Branch[]): boolean {
  if (task.kind !== 'task' || !progress.hasWorkflow || progress.finished) return false;
  return progress.bad || branches.some((b) => b.setup?.state === 'failed');
}
