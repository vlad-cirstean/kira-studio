import { useMutation, useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../../bridge/control';
import { useCodeReposStore } from '../../state/coderepos';
import type {
  AddBacklogItemArgs,
  AddExistingBranchArgs,
  AddTaskRepoArgs,
  BacklogItemArgs,
  BacklogResult,
  Board,
  BranchArgs,
  CreateTaskArgs,
  FocusSessionArgs,
  FolderArgs,
  GhSyncPlan,
  GhSyncResult,
  ImportWorkflowArgs,
  LaunchStageArgs,
  LogKind,
  MoveBacklogItemArgs,
  NewWorkflowArgs,
  PathArgs,
  RecordMergeArgs,
  RefreshArgs,
  ReviewAgentLaunch,
  RunArgs,
  SaveWorkflowArgs,
  SaveWorkflowYamlArgs,
  SendArgs,
  SetPlanArgs,
  SetQueuedAfterArgs,
  SetTaskWorkflowArgs,
  StartBranchArgs,
  StartRunArgs,
  StepArgs,
  TakeOverArgs,
  Task,
  TaskArgs,
  UpdateBacklogItemArgs,
  UpdateRepoArgs,
  UpdateTaskArgs,
  ValidateWorkflowYamlArgs,
} from './wire';

// Board state is push-driven (`kira:adetask:board`, subscribed once in `ade/queries.ts`), so every
// query is `staleTime: Infinity` and a write relies on the backend's own push instead of
// invalidating. The two exceptions refetch on their own: the candidate list (`staleTime: 0`, the
// popover opens on demand) and a failed optimistic write.

export const boardKey = ['adetask', 'board'] as const;
export const prsKey = ['adetask', 'prs'] as const;
export const workflowsKey = ['adetask', 'workflows'] as const;
export const workflowYamlKey = ['adetask', 'workflowYaml'] as const;
export const logKey = (kind: LogKind, id: string) => ['adetask', 'log', kind, id] as const;
export const backlogKey = ['adetask', 'backlog'] as const;
export const reposKey = ['adetask', 'repos'] as const;
export const sessionsKey = ['adetask', 'sessions'] as const;
const candidatesKey = ['adetask', 'candidates'] as const;
export const ghSyncPlanPrefix = ['adetask', 'ghSyncPlan'] as const;
export const reviewTargetKey = (windowKey: string) =>
  ['adetask', 'reviewTarget', windowKey] as const;

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

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => control.adeTaskSessions(),
    staleTime: Number.POSITIVE_INFINITY,
  });
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
        if (from >= 0) {
          const [moved] = items.splice(from, 1);
          if (moved) items.splice(args.toIndex, 0, moved);
          queryClient.setQueryData<BacklogResult>(backlogKey, { items });
        }
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

export function useWorkflowYaml(fileName: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: [...workflowYamlKey, toValue(fileName)] as const,
    queryFn: () => control.adeTaskWorkflowYaml({ fileName: toValue(fileName) }),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: toValue(fileName) !== '',
  }));
}

/** One log from its first chunk; `onAdeTaskLog` appends to this cache (`ade/queries.ts`). */
export function useLog(kind: MaybeRefOrGetter<LogKind>, id: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: logKey(toValue(kind), toValue(id)),
    queryFn: () => control.adeTaskReadLog({ kind: toValue(kind), id: toValue(id), afterSeq: 0 }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30_000,
  }));
}

export function useValidateWorkflowYaml() {
  return useMutation({
    mutationFn: (args: ValidateWorkflowYamlArgs) => control.adeTaskValidateWorkflowYaml(args),
  });
}

/** Saves run one at a time, in call order: a debounce, a blur and an unmount can overlap, and an
 *  older text landing last would be pushed back into the editor. */
const workflowSaveScope = { id: 'ade-workflow-save' } as const;

export function useSaveWorkflow() {
  return useMutation({
    mutationFn: (args: SaveWorkflowArgs) => control.adeTaskSaveWorkflow(args),
    scope: workflowSaveScope,
  });
}

export function useSaveWorkflowYaml() {
  return useMutation({
    mutationFn: (args: SaveWorkflowYamlArgs) => control.adeTaskSaveWorkflowYaml(args),
    scope: workflowSaveScope,
  });
}

export function useImportWorkflow() {
  return useMutation({
    mutationFn: (args: ImportWorkflowArgs) => control.adeTaskImportWorkflow(args),
  });
}

export function useNewWorkflow() {
  return useMutation({ mutationFn: (args: NewWorkflowArgs) => control.adeTaskNewWorkflow(args) });
}

export function useUpdateRepo() {
  return useMutation({ mutationFn: (args: UpdateRepoArgs) => control.adeTaskUpdateRepo(args) });
}

export function useAddFolder() {
  return useMutation({ mutationFn: (args: FolderArgs) => control.adeTaskAddFolder(args) });
}

export function useSetFolderWatch() {
  return useMutation({ mutationFn: (args: FolderArgs) => control.adeTaskSetFolderWatch(args) });
}

export function useRemoveFolder() {
  return useMutation({ mutationFn: (args: PathArgs) => control.adeTaskRemoveFolder(args) });
}

/** Imports one repo by path, then refreshes the settings list and the shared code repo list. */
export function useImportRepo() {
  return useMutation({
    mutationFn: async (path: string) => {
      const repo = await control.codeWorkspaceImportRepo(path);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reposKey, exact: true }),
        useCodeReposStore().hydrateCodeRepos(),
      ]);
      return repo;
    },
  });
}

export function useSetTaskWorkflow() {
  return useMutation({
    mutationFn: (args: SetTaskWorkflowArgs) => control.adeTaskSetTaskWorkflow(args),
  });
}

export function useStartRun() {
  return useMutation({ mutationFn: (args: StartRunArgs) => control.adeTaskStartRun(args) });
}

export function useApprove() {
  return useMutation({ mutationFn: (args: StepArgs) => control.adeTaskApprove(args) });
}

export function useRetryRun() {
  return useMutation({ mutationFn: (args: RunArgs) => control.adeTaskRetryRun(args) });
}

export function useStageDone() {
  return useMutation({ mutationFn: (args: TaskArgs) => control.adeTaskStageDone(args) });
}

export function useRetrySetup() {
  return useMutation({ mutationFn: (args: BranchArgs) => control.adeTaskRetrySetup(args) });
}

export function useOpenReviewWindow() {
  return useMutation({ mutationFn: (args: BranchArgs) => control.adeTaskOpenReviewWindow(args) });
}

export function useTakeOver() {
  return useMutation({ mutationFn: (args: TakeOverArgs) => control.adeTaskTakeOver(args) });
}

export function useLaunchStage() {
  return useMutation({ mutationFn: (args: LaunchStageArgs) => control.adeTaskLaunchStage(args) });
}

export function useStartBranch() {
  return useMutation({ mutationFn: (args: StartBranchArgs) => control.adeTaskStartBranch(args) });
}

export function useSend() {
  return useMutation({ mutationFn: (args: SendArgs) => control.adeTaskSend(args) });
}

export function useStopRun() {
  return useMutation({ mutationFn: (args: RunArgs) => control.adeTaskStopRun(args) });
}

export function useRecordMerge() {
  return useMutation({ mutationFn: (args: RecordMergeArgs) => control.adeTaskRecordMerge(args) });
}

export function useSetQueuedAfter() {
  return useMutation({
    mutationFn: (args: SetQueuedAfterArgs) => control.adeTaskSetQueuedAfter(args),
  });
}

export function useArchiveRisk() {
  return useMutation({ mutationFn: (args: TaskArgs) => control.adeTaskArchiveRisk(args) });
}

export function useArchiveTask() {
  return useMutation({ mutationFn: (args: TaskArgs) => control.adeTaskArchiveTask(args) });
}

export function useFocusSession() {
  return useMutation({ mutationFn: (args: FocusSessionArgs) => control.adeTaskFocusSession(args) });
}

/** The task's review agent and where it runs; a sessions push refetches it. */
export function useReviewAgent(taskId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: ['adetask', 'reviewAgent', taskId] as const,
    queryFn: () => control.adeTaskReviewAgent({ taskId: toValue(taskId) }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useLaunchReviewAgent() {
  return useMutation({
    mutationFn: (args: TaskArgs): Promise<ReviewAgentLaunch> =>
      control.adeTaskLaunchReviewAgent(args),
  });
}

/** What a GitHub sync would do for the branch; re-asked on focus, mark and popover open, not on board pushes (each load pages the PR's files). */
export function useGhSyncPlan(branchId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: ['adetask', 'ghSyncPlan', branchId] as const,
    queryFn: (): Promise<GhSyncPlan> =>
      control.adeTaskGitHubSyncPlan({ branchId: toValue(branchId) }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useGitHubSyncApply() {
  return useMutation({
    mutationFn: (args: BranchArgs): Promise<GhSyncResult> => control.adeTaskGitHubSyncApply(args),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ghSyncPlanPrefix }),
  });
}
