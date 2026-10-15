import type { OnFailure, StepResult } from '../wire';

// Pure mirror of Go `adewire/results.go`: the implicit results of a step with none declared.

export const DEFAULT_MAX_RETURNS = 3;
export const MAX_RETURNS = 10;

/** The return limit of a step that sets none: 0 (no limit) for a review step. */
export function defaultMaxReturns(review: boolean): number {
  return review ? 0 : DEFAULT_MAX_RETURNS;
}

/** The limit a legacy rule implies: `retry N` gives N, anything else the default. */
export function legacyMaxReturns(onFailure: OnFailure | '', review = false): number {
  if (onFailure.startsWith('retry ')) {
    const n = Number.parseInt(onFailure.slice(6), 10);
    if (n > 0) return n;
  }
  return defaultMaxReturns(review);
}

/** Where a result goes when it names no route. */
export function defaultRoute(ok: boolean): string {
  return ok ? 'next' : 'stop';
}

/** The results a new review step starts with: approved moves on, rejected stops the run. */
export function reviewDefaultResults(): StepResult[] {
  return [
    { id: 'approved', ok: true, description: '', next: 'next', loop: false },
    { id: 'rejected', ok: false, description: '', next: 'stop', loop: false },
  ];
}

function sameResults(a: readonly StepResult[], b: readonly StepResult[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The step still has the results a fresh prompt step starts with. */
export function hasImplicitResults(stepId: string, results: readonly StepResult[]): boolean {
  return sameResults(results, implicitResults(stepId, 'stop'));
}

/** The step still has the results a fresh review step starts with. */
export function hasReviewDefaultResults(results: readonly StepResult[]): boolean {
  return sameResults(results, reviewDefaultResults());
}

/** `done` (ok) and `failed` (not ok), the failed route derived from the legacy rule. */
export function implicitResults(stepId: string, onFailure: OnFailure | ''): StepResult[] {
  const failed: StepResult = {
    id: 'failed',
    ok: false,
    description: '',
    next: 'stop',
    loop: false,
  };
  if (onFailure.startsWith('retry ')) {
    const n = Number.parseInt(onFailure.slice(6), 10);
    if (n > 0) Object.assign(failed, { next: stepId, loop: true });
  } else if (onFailure.startsWith('back:')) {
    Object.assign(failed, { next: onFailure.slice(5), loop: true });
  }
  return [{ id: 'done', ok: true, description: '', next: 'next', loop: false }, failed];
}
