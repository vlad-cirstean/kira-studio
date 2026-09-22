import { QueryClient } from '@tanstack/vue-query';

// P98: exported so non-component code can invalidate (P99's migration target) — main.ts hands it
// to VueQueryPlugin rather than letting the plugin construct its own.
//
// P99 §5.5 query key convention: a flat `[domain, ...ids]` tuple — `['schema', connectionId]`
// (state/schemas.ts), `['maskRules', connectionId]` (state/maskRules.ts). Keep new query keys to
// this shape rather than inventing a second one.
//
// P103 Part 4 (§10 audit): byte-identical in both apps; Part 1 named it a Tier-A candidate but kept
// it duplicated alongside pinia.ts (P103 Part 1/2 results), reasoning by analogy from a real,
// demonstrated hazard: hoisting the *Pinia instance* collided both apps' same-named stores when
// `bun test` runs both apps' specs in one shared module cache. Re-examined here rather than taken
// on faith: Kira Space has zero `useQuery`/`useMutation` call sites today (only main.ts wires
// `VueQueryPlugin`, per P98's bootstrap-only scope) — a shared cache has nothing of Kira Space's to
// collide with, unlike Pinia's store registry, which both apps populate with the same ids
// (`'tabs'`, `'settings'`, ...). Verified, not assumed: `bun run test:unit` clean (1535/0) with this
// file hoisted and every consumer repointed. `pinia.ts` itself stays duplicated — its own hazard is
// still real and unchanged; see its own comment.
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
