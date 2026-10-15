import type { StepResult } from '../wire';

// Pure mirror of Go `adewire/results.go`: the default results of a step with none declared.

export const DEFAULT_MAX_RETURNS = 3;
export const MAX_RETURNS = 10;

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

/** `done` (ok, next) and `failed` (not ok, stop). */
export function defaultResults(): StepResult[] {
  return [
    { id: 'done', ok: true, description: '', next: 'next', loop: false },
    { id: 'failed', ok: false, description: '', next: 'stop', loop: false },
  ];
}
