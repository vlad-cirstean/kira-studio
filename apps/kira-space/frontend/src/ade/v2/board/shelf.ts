import type { Board, ShelveTaskArgs } from '../wire';

/** Where a task sits: on the Plan timeline, or on one of the two shelves of the Later tab. */
export type TaskShelf = 'plan' | 'later' | 'backlog';

type ShelfBoard = Pick<Board, 'tasks' | 'plan'>;

/** Backlog by flag; Later is any undated task but a review item (it keeps its auto placement). */
export function shelfOf(board: ShelfBoard, taskId: string): TaskShelf {
  if (board.plan.backlog.includes(taskId)) return 'backlog';
  const task = board.tasks.find((t) => t.id === taskId);
  if (task === undefined || task.kind === 'review') return 'plan';
  return board.plan.day[taskId] === undefined ? 'later' : 'plan';
}

/** Ids of one shelf in plan order; a live task with no plan row sorts last, on Later. */
export function shelfIds(board: ShelfBoard, shelf: TaskShelf): string[] {
  const inOrder = new Set(board.plan.order);
  const ids = [
    ...board.plan.order,
    ...board.tasks.map((t) => t.id).filter((id) => !inOrder.has(id)),
  ];
  return ids.filter((id) => shelfOf(board, id) === shelf);
}

/** The board after `ShelveTask`, placed the way the backend does: before `beforeId`, else after the last task of the shelf. */
export function withShelved<B extends ShelfBoard>(board: B, args: ShelveTaskArgs): B {
  const rest = board.plan.order.filter((id) => id !== args.taskId);
  const onShelf = new Set(shelfIds(board, args.shelf).filter((id) => id !== args.taskId));
  let at = rest.length;
  if (args.beforeId !== '') {
    const i = rest.indexOf(args.beforeId);
    if (i >= 0) at = i;
  } else {
    rest.forEach((id, i) => {
      if (onShelf.has(id)) at = i + 1;
    });
  }
  const order = [...rest.slice(0, at), args.taskId, ...rest.slice(at)];
  const keep = new Set(board.plan.backlog);
  if (args.shelf === 'backlog') keep.add(args.taskId);
  else keep.delete(args.taskId);
  const day = { ...board.plan.day };
  delete day[args.taskId];
  return {
    ...board,
    plan: { ...board.plan, order, day, backlog: order.filter((id) => keep.has(id)) },
  };
}
