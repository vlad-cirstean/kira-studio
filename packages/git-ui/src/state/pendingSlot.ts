import { type ShallowRef, shallowRef } from 'vue';

/**
 * P107 I2-23: `ops.ts`'s six confirm-dialog quadruples (Checkout, Revert, Reset, CherryPick,
 * ForcePush, StashPop) each hand-rolled this exact shape — a `pending` ref a dialog component
 * watches to render itself, a stashed Promise resolver, an `ask()` that sets `pending` and awaits
 * the user's choice, and a `resolve()` the dialog's own buttons call once they have one.
 */
export interface PendingSlot<P, R> {
  readonly pending: ShallowRef<P | undefined>;
  /** Sets `pending` and returns a Promise that settles once `resolve()` (or `abandon()`) is
   *  called. A second `ask()` before the first resolves replaces `pending` but leaves the first
   *  Promise pending forever — same as every original `#confirmX`, none of which guarded against
   *  that case. */
  ask(value: P): Promise<R>;
  resolve(result: R): void;
  /** F6: clears `pending` and settles whatever `ask()` is in flight with `cancelValue`, exactly
   *  like `resolve(cancelValue)` — named separately so a caller reads "this dialog no longer
   *  applies" (a repo switch, disposal) rather than "the user chose this". Nothing else ever
   *  settles that Promise on its own: without this, a switch mid-dialog leaves it pending
   *  forever, the stale dialog stays open over the new repo, and `busy` never clears. A no-op
   *  when nothing is pending. */
  abandon(cancelValue: R): void;
}

export function createPendingSlot<P, R>(): PendingSlot<P, R> {
  const pending: ShallowRef<P | undefined> = shallowRef(undefined);
  let resolveFn: ((result: R) => void) | undefined;

  function settle(result: R): void {
    pending.value = undefined;
    const resolve = resolveFn;
    resolveFn = undefined;
    resolve?.(result);
  }

  return {
    pending,
    ask(value: P): Promise<R> {
      pending.value = value;
      return new Promise((resolve) => {
        resolveFn = resolve;
      });
    },
    resolve: settle,
    abandon: settle,
  };
}
