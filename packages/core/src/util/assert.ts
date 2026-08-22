/**
 * Invariant checks for code that has already validated its input. An `assert` failure is a
 * bug in this codebase, never a reaction to user data or git output — those get a typed
 * result or a `GitError` instead (see packages/git/src/errors.ts).
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function assertDefined<T>(value: T | undefined | null, message: string): T {
  assert(value !== undefined && value !== null, message);
  return value;
}

/** Exhaustiveness check for a `switch` over a union — a type error if a case is missing. */
export function assertNever(value: never, message = "unreachable case"): never {
  throw new AssertionError(`${message}: ${JSON.stringify(value)}`);
}
