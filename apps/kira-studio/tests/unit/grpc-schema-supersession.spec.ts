// Finding 13 of the v1.2 P14 round-1 review: GrpcRequestView.vue's own watcher called loadSchema
// immediately on every keystroke of target/protoPath/descriptorMode, with no debounce and no
// supersession guard — a slow response for a stale (partial) target string could land after a
// newer one and clobber the schema. This pins the generation-id guard state.ts's loadSchema now
// has (mirroring call()'s own opId pattern) by resolving two in-flight loads out of order — the
// exact interleaving no Playwright test can force — the same technique
// tests/unit/view-state.spec.ts already established for views/browse/state.ts's own supersession
// guard.
import './support/window';

import { afterEach, describe, expect, test } from 'bun:test';
import type { GrpcSchemaWire } from '@shared/domain/grpc';

const { control } = await import('../../frontend/src/bridge/control');
const { openGrpcRequestTab, patchGrpcRequestTabState } = await import(
  '../../frontend/src/api/tabs'
);
const { loadSchema, schemaRuntime } = await import('../../frontend/src/views/grpcrequest/state');

// control is a shared, process-wide singleton (bun test runs every spec file in one process) —
// bridge-unwrap.spec.ts reflectively calls every function it finds on it, so a method left
// monkey-patched here would leak into that file's own assertions. Captured once, restored after
// every test.
const originalGrpcDescribe = control.grpcDescribe;
afterEach(() => {
  control.grpcDescribe = originalGrpcDescribe;
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function schemaNamed(name: string): GrpcSchemaWire {
  return { services: [{ name, methods: [] }], mode: 'proto', warnings: [] };
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

    const older = loadSchema(id); // genId 1
    const newer = loadSchema(id); // genId 2
    expect(calls).toHaveLength(2);

    // The newer call lands first; the older one resolves after it.
    calls[1]?.resolve(schemaNamed('Newer'));
    await newer;
    expect(schemaRuntime[id]?.schema?.services[0]?.name).toBe('Newer');

    calls[0]?.resolve(schemaNamed('Older'));
    await older;

    // The stale response must not have overwritten the newer schema already in place.
    expect(schemaRuntime[id]?.schema?.services[0]?.name).toBe('Newer');
    expect(schemaRuntime[id]?.status).toBe('idle');
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

    const older = loadSchema(id); // genId 1 — will fail
    const newer = loadSchema(id); // genId 2 — will succeed
    calls[1]?.resolve(schemaNamed('Good'));
    await newer;
    expect(schemaRuntime[id]?.status).toBe('idle');

    calls[0]?.reject(new Error('stale failure'));
    await older;

    expect(schemaRuntime[id]?.status).toBe('idle');
    expect(schemaRuntime[id]?.schema?.services[0]?.name).toBe('Good');
    expect(schemaRuntime[id]?.error).toBeNull();
  });
});
