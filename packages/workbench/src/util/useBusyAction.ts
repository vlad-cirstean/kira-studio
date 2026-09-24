import { ref } from 'vue';

// P107 T1-20: the same `busy = true; try { await action() } finally { busy = false }` in-flight
// flag six settings pane call sites (ClaudeCodePane.vue x2, DatabaseMcpPane.vue x3,
// ConnectedEditorsPane.vue x1) each defined locally, to disable a checkbox/button while its own
// instant action (bypasses draft/Save, P86 §9.3) is running.
//
// Not VueUse's useAsyncState: its `execute(delay, ...args)` signature would force every call site
// to pass a throwaway delay argument, and its `state`/`error`/`isReady` fields go unused here —
// each call site's own store method already owns its result and error surfacing; only the
// in-flight flag is shared.
export function useBusyAction<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
  const busy = ref(false);
  async function run(...args: Args): Promise<void> {
    busy.value = true;
    try {
      await action(...args);
    } finally {
      busy.value = false;
    }
  }
  return { busy, run };
}
