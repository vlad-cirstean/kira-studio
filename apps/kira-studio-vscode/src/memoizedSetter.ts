/**
 * G30 round-1 performance review, finding #10 — the pure skip-on-unchanged logic beneath
 * `reviewMarking.ts`'s own `setInReviewDiffContext`/`setReviewSelectionContext`. Imports nothing
 * from `vscode`, which is what lets it run under plain `bun test` (the same "importable and
 * testable with no extension host" split `reviewRanges.ts`'s own doc comment already establishes
 * for this file's sibling).
 */

/** Wraps a setter so a call is skipped whenever `value` is `===` the last one actually passed
 *  through — `updateContextKeys` (reviewMarking.ts) used to call VS Code's own `setContext`
 *  command unconditionally on every editor selection change (a drag-select or multi-cursor move
 *  can fire that many times a second), even when the value hadn't changed at all; each call
 *  crosses the extension host's own IPC boundary. The first call is never skipped (`hasRun` starts
 *  false, so even a first value of `undefined` still reaches `set` once). */
export function memoizedSetter<T>(set: (value: T) => void): (value: T) => void {
  let last: T | undefined;
  let hasRun = false;
  return (value: T): void => {
    if (hasRun && last === value) return;
    hasRun = true;
    last = value;
    set(value);
  };
}
