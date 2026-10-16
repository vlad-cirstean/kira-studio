import type { Board, Branch } from '../wire';

/** The task's created own branches whose prepare script runs or failed: a launch on them waits or is refused. */
export function blockingSetups(
  board: Pick<Board, 'branches'> | null | undefined,
  taskId: string,
  branchIds?: readonly string[],
): Branch[] {
  if (!board) return [];
  return board.branches.filter(
    (b) =>
      b.taskId === taskId &&
      b.kind === 'mine' &&
      b.name !== '' &&
      (branchIds === undefined || branchIds.includes(b.id)) &&
      (b.setup?.state === 'running' || b.setup?.state === 'failed'),
  );
}

/** The run note a pending run carries while its branch's setup holds it back. */
export const WAITING_SETUP_NOTES: readonly string[] = [
  'waiting for worktree setup',
  'worktree setup failed',
];
