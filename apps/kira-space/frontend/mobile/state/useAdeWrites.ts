import { withShelved } from '@ade/board/shelf';
import { boardKey, sessionsKey } from '@ade/readQueries';
import type { Board, Shelf } from '@ade/wire';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { optimisticUpdate } from '@workbench/behaviour/optimistic';
import type { CodedError } from '@workbench/bridge/codedError';
import { adeWriter } from '../api/adeWriter';
import { useAuthStore } from './auth';

/** A new key per user intent: a retry of the same intent reuses it, so the server runs it once. */
// `crypto.randomUUID` is undefined on a plain-HTTP origin; `getRandomValues` is not.
export const newIntentKey = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

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

  const captureTask = useMutation({
    mutationFn: (v: { title: string; key: string }) => adeWriter.captureTask(v.title, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey),
  });

  type ShelveVars = { taskId: string; shelf: Shelf; beforeId: string; key: string };
  const shelveOptimistic = optimisticUpdate<Board, ShelveVars>(queryClient, boardKey, withShelved, {
    invalidate: 'settled',
  });
  const shelveTask = useMutation({
    mutationFn: (v: ShelveVars) => adeWriter.shelveTask(v.taskId, v.shelf, v.beforeId, v.key),
    retry,
    ...shelveOptimistic,
    onError: (err, v, ctx) => {
      shelveOptimistic.onError(err, v, ctx);
      onError(err);
    },
  });

  const setTaskStep = useMutation({
    mutationFn: (v: {
      taskId: string;
      fromStepId: string;
      stepId: string;
      key: string;
      notes?: string;
    }) => adeWriter.setTaskStep(v.taskId, v.fromStepId, v.stepId, v.key, v.notes),
    retry,
    onError,
    onSettled: () => invalidate(boardKey),
  });

  const startRun = useMutation({
    mutationFn: (v: { taskId: string; fromStepId: string; key: string }) =>
      adeWriter.startRun(v.taskId, v.fromStepId, v.key),
    retry,
    onError,
    onSettled: () => invalidate(boardKey, sessionsKey),
  });

  const launchStep = useMutation({
    mutationFn: (v: { taskId: string; fromStepId: string; key: string }) =>
      adeWriter.launchStep(v.taskId, v.fromStepId, v.key),
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
    captureTask,
    shelveTask,
    setTaskStep,
    startRun,
    launchStep,
    sendReply,
    takeOver,
  };
}
