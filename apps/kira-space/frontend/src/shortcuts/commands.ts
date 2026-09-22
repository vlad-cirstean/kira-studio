// Kira Studio's own shortcuts/commands.ts, ported verbatim — a tiny per-id registry the active
// view's own component registers into on mount and unregisters on unmount.
const handlers = new Map<string, () => void>();

export function registerCommand(id: string, handler: () => void): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

// A no-op, not an error, when nothing has registered for `id` — matches every other
// "nothing to do here" affordance in the app.
export function runCommand(id: string): void {
  handlers.get(id)?.();
}
