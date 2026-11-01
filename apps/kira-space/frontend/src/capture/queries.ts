import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { control } from '../bridge/control';
import type { CaptureAction } from './wire';

export const captureItemKey = (windowKey: string) => ['capture', 'item', windowKey] as const;
export const captureStatusKey = ['capture', 'status'] as const;

/** The hotkey binding state; the backend pushes every change into the cache. */
export function useCaptureStatus() {
  const queryClient = useQueryClient();
  const off = control.onCaptureStatus((state) => queryClient.setQueryData(captureStatusKey, state));
  tryOnScopeDispose(off);
  return useQuery({
    queryKey: captureStatusKey,
    queryFn: () => control.captureStatus(),
  });
}

export interface ConfirmVars {
  windowKey: string;
  itemId: string;
  action: CaptureAction;
  title: string;
}

/** Runs the chosen action; a rejection (including a failed Later patch) keeps the popup open. */
export function useConfirmCapture() {
  return useMutation({ mutationFn: (vars: ConfirmVars) => control.captureConfirm(vars) });
}

export function useDismissCapture() {
  return useMutation({ mutationFn: (windowKey: string) => control.captureDismiss(windowKey) });
}
