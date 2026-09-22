/**
 * One control-channel snapshot: the args that produce it, and the response, verbatim — the
 * `tests/ipc/support/types.ts` `ControlSnapshot` type Kira Studio's own `tests/ui/` fixture tier
 * uses, ported alone. Kira Space has no bulk-data port/stream protocol of its own (no data grid —
 * `PortSnapshot`/`LogicalPage` and the rest of that file are data-grid specific, so nothing here
 * needs them) and no backend capture/replay tier (`tests/ipc/`) to share this type with, so it
 * lives directly under `tests/ui/support/` rather than a sibling `tests/ipc/support/`.
 */
export interface ControlSnapshot<T = unknown> {
  /** A value from tests/ui/support/ipcChannels.ts's IPC map. */
  channel: string;
  /** Exactly what the renderer sends — used by the frontend half to match a request to a
   *  snapshot when a channel has more than one; a channel with exactly one snapshot answers
   *  regardless of its args. Optional because JSON.stringify drops an `undefined`-valued key
   *  entirely, so a channel captured with no args at all has no `args` key in the committed
   *  fixture. */
  args?: unknown;
  /** Optional for the same reason `args` is — a channel that resolves `void` captures
   *  `response: undefined`, which JSON.stringify drops from the committed fixture. */
  response?: T;
  /** When set, mockRuntime.ts answers this snapshot as a failed bound call instead of a 200 —
   *  `control.ts`'s `unwrap` reads `.cause.code`/`.cause.message` off the thrown error. Mutually
   *  exclusive with `response`. */
  error?: { code: string; message: string; details?: unknown };
}
