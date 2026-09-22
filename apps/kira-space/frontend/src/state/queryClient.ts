import { QueryClient } from '@tanstack/vue-query';

// P98: exported so non-component code can invalidate (P99's migration target) — main.ts hands it
// to VueQueryPlugin rather than letting the plugin construct its own.
//
// P99 §5.5 query key convention: a flat `[domain, ...ids]` tuple — `['schema', connectionId]`
// (state/schemas.ts), `['maskRules', connectionId]` (state/maskRules.ts). Keep new query keys to
// this shape rather than inventing a second one.
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
