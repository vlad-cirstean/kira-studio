import { QueryClient } from '@tanstack/vue-query';

// Query key convention: a flat `[domain, ...ids]` tuple — `['schema', connectionId]`,
// `['maskRules', connectionId]`. Keep new keys to this shape.
//
// One factory, two profiles. Both treat cached data as fresh forever (`staleTime: Infinity`): reads
// are push-invalidated (Wails events on desktop, SSE on the phone), so a mount never refetches.
// A query that must refetch on mount (a poll, a preview of local state) says `staleTime: 0` itself.
//
// - desktop (`remote: false`): every query resolves over the Wails bridge to the local Go process,
//   so a failure is a real backend error, not a transient one worth repeating; window focus changes
//   nothing.
// - remote (`remote: true`, the phone UI over HTTP): one retry, and a refocus or reconnect refetches.
export function createQueryClient({ remote }: { remote: boolean }): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: remote
        ? {
            retry: 1,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            staleTime: Number.POSITIVE_INFINITY,
          }
        : {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
    },
  });
}

// The desktop app's client, exported so non-component code (Pinia store bodies, signal installers)
// can invalidate; main.ts hands it to VueQueryPlugin rather than letting the plugin construct its own.
export const queryClient = createQueryClient({ remote: false });
