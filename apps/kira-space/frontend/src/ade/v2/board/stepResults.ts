import type { OnFailure, StepResult } from '../wire';

// Pure mirror of Go `adewire/results.go`: the implicit results of a step with none declared.

export const DEFAULT_LOOP_MAX = 3;
export const MAX_LOOP_MAX = 10;

/** Where a result goes when it names no route. */
export function defaultRoute(ok: boolean): string {
  return ok ? 'next' : 'stop';
}

/** `done` (ok) and `failed` (not ok), the failed route derived from the legacy rule. */
export function implicitResults(stepId: string, onFailure: OnFailure | ''): StepResult[] {
  const failed: StepResult = { id: 'failed', ok: false, description: '', next: 'stop', max: 0 };
  if (onFailure.startsWith('retry ')) {
    const n = Number.parseInt(onFailure.slice(6), 10);
    if (n > 0) Object.assign(failed, { next: stepId, max: n });
  } else if (onFailure.startsWith('back:')) {
    Object.assign(failed, { next: onFailure.slice(5), max: DEFAULT_LOOP_MAX });
  }
  return [{ id: 'done', ok: true, description: '', next: 'next', max: 0 }, failed];
}
