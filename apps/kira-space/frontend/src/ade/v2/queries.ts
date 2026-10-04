import { useMutation, useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import { control } from '../../bridge/control';
import type {
  AddBacklogItemArgs,
  AddExistingBranchArgs,
  AddTaskRepoArgs,
  BacklogItemArgs,
  BacklogResult,
  Board,
  BranchArgs,
  CreateTaskArgs,
  MoveBacklogItemArgs,
  RefreshArgs,
  SetPlanArgs,
  Task,
  UpdateBacklogItemArgs,
  UpdateTaskArgs,
} from './wire';

// Board state is push-driven (`kira:adetask:board`, subscribed once in `ade/queries.ts`), so every
// query is `staleTime: Infinity` and a write relies on the backend's own push instead of
// invalidating. The two exceptions refetch on their own: the candidate list (`staleTime: 0`, the
// popover opens on demand) and a failed optimistic write.

export const boardKey = ['adetask', 'board'] as const;
export const prsKey = ['adetask', 'prs'] as const;
const workflowsKey = ['adetask', 'workflows'] as const;
export const backlogKey = ['adetask', 'backlog'] as const;
export const reposKey = ['adetask', 'repos'] as const;
const candidatesKey = ['adetask', 'candidates'] as const;

export function useBoard() {
  return useQuery({
    queryKey: boardKey,
    queryFn: () => control.adeTaskBoard(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function usePrs() {
  return useQuery({
    queryKey: prsKey,
    queryFn: () => control.adeTaskPrs(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: workflowsKey,
    queryFn: () => control.adeTaskWorkflows(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: reposKey,
    queryFn: () => control.adeTaskRepos(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Branches that can join the plan; refetched on every open so a just-pushed branch shows. */
export function useCandidates(enabled: () => boolean) {
  return useQuery(() => ({
    queryKey: candidatesKey,
    queryFn: () => control.adeTaskCandidateBranches(),
    staleTime: 0,
    enabled: enabled(),
  }));
}

export function useBacklog() {
  return useQuery({
    queryKey: backlogKey,
    queryFn: () => control.adeTaskBacklog(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRefresh() {
  return useMutation({
    mutationKey: ['adetask', 'refresh'],
    mutationFn: (args: RefreshArgs) => control.adeTaskRefresh(args),
  });
}

export function useForcePush() {
  return useMutation({ mutationFn: (args: BranchArgs) => control.adeTaskForcePush(args) });
}

export function useCreateTask() {
  return useMutation({ mutationFn: (args: CreateTaskArgs) => control.adeTaskCreateTask(args) });
}

export function useAddExistingBranch() {
  return useMutation({
    mutationFn: (args: AddExistingBranchArgs) => control.adeTaskAddExistingBranch(args),
  });
}

export function useAddBacklogItem() {
  return useMutation({
    mutationFn: (args: AddBacklogItemArgs) => control.adeTaskAddBacklogItem(args),
  });
}

export function useAddTaskRepo() {
  return useMutation({ mutationFn: (args: AddTaskRepoArgs) => control.adeTaskAddTaskRepo(args) });
}

/** Applies a task patch to a board snapshot: a `null` field is unchanged, `clearJira` drops Jira. */
function withTaskPatch(board: Board, args: UpdateTaskArgs): Board {
  const p = args.patch;
  const tasks = board.tasks.map((t): Task => {
    if (t.id !== args.taskId) return t;
    return {
      ...t,
      title: p.title ?? t.title,
      jira: p.clearJira ? null : (p.jira ?? t.jira),
      githubUrl: p.githubUrl ?? t.githubUrl,
      est: p.est ?? t.est,
      notes: p.notes ?? t.notes,
      color: p.color ?? t.color,
      kind: p.kind ?? t.kind,
    };
  });
  return { ...board, tasks };
}

export function useUpdateTask() {
  return useMutation({
    mutationFn: (args: UpdateTaskArgs) => control.adeTaskUpdateTask(args),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: boardKey, exact: true });
      const prev = queryClient.getQueryData<Board>(boardKey);
      if (prev) queryClient.setQueryData<Board>(boardKey, withTaskPatch(prev, args));
      return { prev };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.prev) queryClient.setQueryData<Board>(boardKey, ctx.prev);
      void queryClient.invalidateQueries({ queryKey: boardKey, exact: true });
    },
  });
}

export function useUpdateBacklogItem() {
  return useMutation({
    mutationFn: (args: UpdateBacklogItemArgs) => control.adeTaskUpdateBacklogItem(args),
  });
}

export function useMoveBacklogItem() {
  return useMutation({
    mutationFn: (args: MoveBacklogItemArgs) => control.adeTaskMoveBacklogItem(args),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: backlogKey, exact: true });
      const prev = queryClient.getQueryData<BacklogResult>(backlogKey);
      if (prev) {
        const items = [...prev.items];
        const from = items.findIndex((i) => i.id === args.id);
        const [moved] = items.splice(from, 1);
        if (moved) items.splice(args.toIndex, 0, moved);
        queryClient.setQueryData<BacklogResult>(backlogKey, { items });
      }
      return { prev };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.prev) queryClient.setQueryData<BacklogResult>(backlogKey, ctx.prev);
      void queryClient.invalidateQueries({ queryKey: backlogKey, exact: true });
    },
  });
}

export function useDeleteBacklogItem() {
  return useMutation({
    mutationFn: (args: BacklogItemArgs) => control.adeTaskDeleteBacklogItem(args),
  });
}

export function usePromoteBacklogItem() {
  return useMutation({
    mutationFn: (args: BacklogItemArgs) => control.adeTaskPromoteBacklogItem(args),
  });
}

/** Applies a plan write to a board snapshot the way the backend does: `order` replaces, a `null`
 *  day sends the task to Later. */
function withPlan(board: Board, args: SetPlanArgs): Board {
  const day = { ...board.plan.day };
  for (const [id, iso] of Object.entries(args.days)) {
    if (iso === null) delete day[id];
    else day[id] = iso;
  }
  return { ...board, plan: { ...board.plan, order: args.order, day } };
}

export function useSetPlan() {
  return useMutation({
    mutationFn: (args: SetPlanArgs) => control.adeTaskSetPlan(args),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: boardKey, exact: true });
      const prev = queryClient.getQueryData<Board>(boardKey);
      if (prev) queryClient.setQueryData<Board>(boardKey, withPlan(prev, args));
      return { prev };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.prev) queryClient.setQueryData<Board>(boardKey, ctx.prev);
      void queryClient.invalidateQueries({ queryKey: boardKey, exact: true });
    },
  });
}
