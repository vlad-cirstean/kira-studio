import { QueryClient } from '@tanstack/vue-query';

// P98: exported so non-component code can invalidate (P99's migration target) — main.ts hands it
// to VueQueryPlugin rather than letting the plugin construct its own.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every query in this app resolves over the Wails bridge to the local Go process, not the
      // network: a failure is a real backend/engine error (bad SQL, dead connection), not a
      // transient one worth repeating.
      retry: false,
      // The app is a desktop window whose data changes when the user acts or the backend pushes
      // (control.on*Changed), never because the window regained focus.
      refetchOnWindowFocus: false,
    },
  },
});
