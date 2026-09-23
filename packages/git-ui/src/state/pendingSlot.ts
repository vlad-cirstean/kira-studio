import { type ShallowRef, shallowRef } from 'vue';

/**
 * P107 I2-23: `ops.ts`'s six confirm-dialog quadruples (Checkout, Revert, Reset, CherryPick,
 * ForcePush, StashPop) each hand-rolled this exact shape — a `pending` ref a dialog component
 * watches to render itself, a stashed Promise resolver, an `ask()` that sets `pending` and awaits
 * the user's choice, and a `resolve()` the dialog's own buttons call once they have one.
 */
export interface PendingSlot<P, R> {
  readonly pending: ShallowRef<P | undefined>;
  /** Sets `pending` and returns a Promise that settles once `resolve()` is called. A second
   *  `ask()` before the first resolves replaces `pending` but leaves the first Promise pending
   *  forever — same as every original `#confirmX`, none of which guarded against that case. */
  ask(value: P): Promise<R>;
  resolve(result: R): void;
}

export function createPendingSlot<P, R>(): PendingSlot<P, R> {
  const pending: ShallowRef<P | undefined> = shallowRef(undefined);
  let resolveFn: ((result: R) => void) | undefined;

  return {
    pending,
    ask(value: P): Promise<R> {
      pending.value = value;
      return new Promise((resolve) => {
        resolveFn = resolve;
      });
    },
    resolve(result: R): void {
      pending.value = undefined;
      const resolve = resolveFn;
      resolveFn = undefined;
      resolve?.(result);
    },
  };
}
