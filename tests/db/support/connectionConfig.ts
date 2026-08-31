import type { ConnectionSummary } from '@shared/domain/connection';

// The shape these fixtures hand straight to an adapter's Connect(), test-owned now (P2 R1: it used
// to be src/shared/protocol/engine-ops.ts's `ResolvedConnectionConfig`, the old main→engine-child
// wire type from the pre-P58 Node-engine-sidecar architecture — nothing under src/renderer or the
// Go adapters package needs this shape today, only these fixtures constructing one to pass
// in-process). `preconnect`/`preconnectSidecar` are omitted the same way the original type did:
// they govern main's own arm()/monitor decision, not anything the adapter itself reads.
export type ResolvedConnectionConfig = Omit<
  ConnectionSummary,
  'preconnect' | 'preconnectSidecar'
> & {
  password: string | null;
};
