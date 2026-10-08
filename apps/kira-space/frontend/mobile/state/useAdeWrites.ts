import { withMovedItem } from '@ade/backlogOrder';
import { backlogKey, boardKey, sessionsKey } from '@ade/readQueries';
import type { BacklogResult } from '@ade/wire';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { CodedError } from '@workbench/bridge/codedError';
import { adeWriter } from '../api/adeWriter';
import { useAuthStore } from './auth';

/** A new key per user intent: a retry of the same intent reuses it, so the server runs it once. */
export const newIntentKey = (): string => crypto.randomUUID();

const PERMISSION_CODES = new Set(['E_WRITE_OFF', 'E_AGENT_INPUT_OFF']);

/** The phone's write mutations. Reads stay push-driven; a write only refreshes what it changed. */
export function useAdeWrites() {
  const queryClient = useQueryClient();
  const auth = useAuthStore();
  const invalidate = (...keys: (readonly string[])[]) => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey, exact: true });
  };
  // A lost response is retried with the same key; any other failure is the user's to retry.
  const retry = (count: number, err: unknown) =>
    count < 2 && (err as CodedError).code === 'E_NETWORK';
  const onError = (err: unknown) => {
    // The desktop may have switched a permission off since the phone last asked.
    if (PERMISSION_CODES.has((err as CodedError).code ?? '')) void auth.refreshMe();
  };

  const addBacklogItem = useMutation({
    mutationFn: (v: { text: string; key: string }) => adeWriter.addBacklogItem(v.text, v.key),
    retry,
    onError,
    onSettled: () => invalidate(backlogKey),
  });

  const moveBacklogItem = useMutation({
    mutationFn: (v: { id: string; toIndex: number; key: string }) =>
      adeWriter.moveBacklogItem(v.id, v.toIndex, v.key),
    retry,
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: backlogKey, exact: true });
      const prev = queryClient.getQueryData<BacklogResult>(backlogKey);
      if (prev) queryClient.setQueryData<BacklogResult>(backlogKey, withMovedItem(prev, v));
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData<BacklogResult>(backlogKey, ctx.prev);
      onError(err);
    },
    onSettled: () => invalidate(backlogKey),
  });

  const setTaskStage = useMutation({
    mutationFn: (v: { taskId: string; fromStageId: string; stageId: string; key: string }) =>
      adeWriter.setTaskStage(v.taskId, v.fromStageId, v.stageId, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey),
  });

  const startRun = useMutation({
    mutationFn: (v: { taskId: string; fromStageId: string; key: string }) =>
      adeWriter.startRun(v.taskId, v.fromStageId, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey, sessionsKey),
  });

  const launchStage = useMutation({
    mutationFn: (v: { taskId: string; fromStageId: string; key: string }) =>
      adeWriter.launchStage(v.taskId, v.fromStageId, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey, sessionsKey),
  });

  const sendReply = useMutation({
    mutationFn: (v: { sessionId: string; message: string; key: string }) =>
      adeWriter.sendReply(v.sessionId, v.message, v.key),
    retry,
    onError,
  });

  const takeOver = useMutation({
    mutationFn: (v: { sessionId: string; key: string }) => adeWriter.takeOver(v.sessionId, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey, sessionsKey),
  });

  return {
    addBacklogItem,
    moveBacklogItem,
    setTaskStage,
    startRun,
    launchStage,
    sendReply,
    takeOver,
  };
}
