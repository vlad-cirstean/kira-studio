// Finding 13 of the v1.2 P14 round-1 review: GrpcRequestView.vue's own watcher called loadSchema
// immediately on every keystroke of target/protoPath/descriptorMode, with no debounce and no
// supersession guard — a slow response for a stale (partial) target string could land after a
// newer one and clobber the schema. This pins the generation-id guard state.ts's loadSchema now
// has (mirroring call()'s own opId pattern) by resolving two in-flight loads out of order — the
// exact interleaving no Playwright test can force — the same technique
// tests/unit/view-state.spec.ts already established for views/browse/state.ts's own supersession
// guard.
import '@workbench/testing/unit/window';

import { afterEach, describe, expect, test } from 'bun:test';
import type { GrpcSchemaWire } from '@shared/domain/grpc';
import { deferred } from '@workbench/testing/unit/async';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
// P112: loadSchema now awaits apiIdsForTab (variables.ts) before ever reaching grpcDescribe, which
// awaits loadCollectionsTree/loadEnvironments (apiQueries.ts) — control.collectionsList/
// variablesListEnvironments are otherwise unmocked, and wailsRuntime.ts's mocked transport
// deliberately never settles an unmocked call, so loadSchema would hang before either test's own
// grpcDescribe mock is ever reached. staleTime: Infinity caches this default for the whole file —
// one resolve is enough, no afterEach restore needed (api-variables-delete-eviction.spec.ts's own
// precedent).
(
  control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
).variablesListEnvironments = async () => [];
(control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
  async () => ({ collections: [], items: [] });
const { openGrpcRequestTab, patchGrpcRequestTabState } = await import(
  '../../frontend/src/api/tabs'
);
const { useGrpcRequestViewStore } = await import('../../frontend/src/views/grpcrequest/state');
const grpcRequestViewStore = useGrpcRequestViewStore();

// control is a shared, process-wide singleton (bun test runs every spec file in one process) —
// bridge-unwrap.spec.ts reflectively calls every function it finds on it, so a method left
// monkey-patched here would leak into that file's own assertions. Captured once, restored after
// every test.
const originalGrpcDescribe = control.grpcDescribe;
afterEach(() => {
  control.grpcDescribe = originalGrpcDescribe;
});

function schemaNamed(name: string): GrpcSchemaWire {
  return { services: [{ name, methods: [] }], mode: 'proto', warnings: [] };
}

// P112: loadSchema now awaits apiIdsForTab before ever reaching grpcDescribe, so the two
// loadSchema() calls below no longer push onto `calls` synchronously the way they did before that
// await existed — a setTimeout(0) macrotask (api-variables-delete-eviction.spec.ts's own `flush`
// precedent) drains every pending microtask first, guaranteeing both calls have reached
// grpcDescribe (and pushed their own deferred) by the time it resolves, without pinning the exact
// number of ticks apiIdsForTab's own chain takes.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('views/grpcrequest/state.ts loadSchema supersession guard (finding 13)', () => {
  test('a stale response for an older load does not clobber a newer one', async () => {
    const id = openGrpcRequestTab();
    // descriptorMode 'proto' skips resolveForDescribe's own secret-resolution round trip, going
    // straight to control.grpcDescribe — the one call this test needs to control the order of.
    patchGrpcRequestTabState(id, { descriptorMode: 'proto', protoPath: '/tmp/a.proto' });

    const calls: Array<ReturnType<typeof deferred<GrpcSchemaWire>>> = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real grpcDescribe
    (control as any).grpcDescribe = () => {
      const d = deferred<GrpcSchemaWire>();
      calls.push(d);
      return d.promise;
    };

    const older = grpcRequestViewStore.loadSchema(id); // genId 1
    const newer = grpcRequestViewStore.loadSchema(id); // genId 2
    await flush();
    expect(calls).toHaveLength(2);

    // The newer call lands first; the older one resolves after it.
    calls[1]?.resolve(schemaNamed('Newer'));
    await newer;
    expect(grpcRequestViewStore.schemaRuntime[id]?.schema?.services[0]?.name).toBe('Newer');

    calls[0]?.resolve(schemaNamed('Older'));
    await older;

    // The stale response must not have overwritten the newer schema already in place.
    expect(grpcRequestViewStore.schemaRuntime[id]?.schema?.services[0]?.name).toBe('Newer');
    expect(grpcRequestViewStore.schemaRuntime[id]?.status).toBe('idle');
  });

  test('a stale failure does not error out a load that already succeeded', async () => {
    const id = openGrpcRequestTab();
    patchGrpcRequestTabState(id, { descriptorMode: 'proto', protoPath: '/tmp/b.proto' });

    const calls: Array<ReturnType<typeof deferred<GrpcSchemaWire>>> = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real grpcDescribe
    (control as any).grpcDescribe = () => {
      const d = deferred<GrpcSchemaWire>();
      calls.push(d);
      return d.promise;
    };

    const older = grpcRequestViewStore.loadSchema(id); // genId 1 — will fail
    const newer = grpcRequestViewStore.loadSchema(id); // genId 2 — will succeed
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(schemaNamed('Good'));
    await newer;
    expect(grpcRequestViewStore.schemaRuntime[id]?.status).toBe('idle');

    calls[0]?.reject(new Error('stale failure'));
    await older;

    expect(grpcRequestViewStore.schemaRuntime[id]?.status).toBe('idle');
    expect(grpcRequestViewStore.schemaRuntime[id]?.schema?.services[0]?.name).toBe('Good');
    expect(grpcRequestViewStore.schemaRuntime[id]?.error).toBeNull();
  });
});
