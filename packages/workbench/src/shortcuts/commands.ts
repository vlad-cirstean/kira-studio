// D11: a tiny per-id registry the active view's own component registers into while active and
// unregisters when it deactivates or unmounts. Exactly one of DataView.vue/DefinitionView.vue/
// ConsoleView.vue is ever active at a time (MainView.vue renders the active tab only; a kept-alive
// view deactivates), so "run the active tab's own Find/Refresh/Run/Run all" falls out for free
// with no active-tab-kind branching here.
const handlers = new Map<string, () => void>();

export function registerCommand(id: string, handler: () => void): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

// A no-op, not an error, when nothing has registered for `id` (e.g. Find on a definition tab, which
// has no search box) — matches every other "nothing to do here" affordance in the app.
export function runCommand(id: string): void {
  handlers.get(id)?.();
}
