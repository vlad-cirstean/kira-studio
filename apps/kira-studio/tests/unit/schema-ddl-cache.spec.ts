// P12 round 1 finding #4: ensureDdl used to await its own cached pending promise and only clear
// pendingLoads on the success path — `pendingLoads.delete(connectionId)` sat after the `await`,
// so a rejection never reached it. One transient control.schemaGet failure (a backend error, a
// disconnect mid-boot) then poisoned the cache for the rest of the session: every later caller
// (console completion/diagnostics/hover, the Schema dialog) re-awaited and re-threw the same
// stale rejection, with nothing retrying and nothing surfacing to the user. This pins the fix:
// pendingLoads must clear on rejection too, so a later call gets a fresh attempt.
import './support/window';

import { describe, expect, test } from 'bun:test';

const { control } = await import('../../frontend/src/bridge/control');
const { ensureDdl, saveDdl, schemasState } = await import('../../frontend/src/state/schemas');

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

describe('state/schemas.ts — ensureDdl pending-load cache (P12 round 1 F4)', () => {
  test('a rejected load does not poison later calls for the same connection', async () => {
    const connectionId = 'conn-ensure-ddl-retry';
    delete schemasState.byConnection[connectionId];

    const first = deferred<{ connectionId: string; ddl: string; updatedAt: string }>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real schemaGet.
    (control as any).schemaGet = () => first.promise;

    // .catch is attached in the same synchronous tick ensureDdl is called, before the reject
    // below — the safe ordering for a manually-triggered rejection under bun:test.
    const failing = ensureDdl(connectionId).catch((err: unknown) => err);
    first.reject(new Error('backend unavailable'));
    const caught = await failing;
    expect((caught as Error)?.message).toBe('backend unavailable');

    // The retry must actually call schemaGet again, not re-await the same rejected promise —
    // proven by resolving this second call to a real value and getting it back.
    let secondCallCount = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real schemaGet.
    (control as any).schemaGet = () => {
      secondCallCount++;
      return Promise.resolve({ connectionId, ddl: 'create table t (id int);', updatedAt: '' });
    };

    const ddl = await ensureDdl(connectionId);
    expect(ddl).toBe('create table t (id int);');
    expect(secondCallCount).toBe(1);
    expect(schemasState.byConnection[connectionId]).toBe('create table t (id int);');
  });

  // P12 round 2 finding #14: ensureDdl wrote `schemasState.byConnection[connectionId] = ddl`
  // unconditionally after its own await — a slow initial fetch resolving *after* a faster
  // saveDdl (a real user Save) had already written fresher text overwrote the store back to the
  // stale fetched value, with nothing left to notice until the next relaunch.
  test('a slow initial fetch does not clobber a faster concurrent saveDdl (P12 round 2 F14)', async () => {
    const connectionId = 'conn-ensure-ddl-race';
    delete schemasState.byConnection[connectionId];

    const slowFetch = deferred<{ connectionId: string; ddl: string; updatedAt: string }>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real schemaGet.
    (control as any).schemaGet = () => slowFetch.promise;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real schemaSet.
    (control as any).schemaSet = (_id: string, ddlText: string) =>
      Promise.resolve({ connectionId, ddl: ddlText, updatedAt: '' });

    // The initial load starts, but its own response is left in flight.
    const loading = ensureDdl(connectionId);

    // A faster concurrent Save (e.g. the user typed and saved before the slow load returned)
    // writes fresh text straight into the store, bypassing ensureDdl/pendingLoads entirely.
    await saveDdl(connectionId, 'create table fresh (id int);');
    expect(schemasState.byConnection[connectionId]).toBe('create table fresh (id int);');

    // The slow fetch *now* resolves with the stale pre-save text — it must not overwrite the
    // fresher save, and the still-pending ensureDdl call must resolve to the fresh text too.
    slowFetch.resolve({ connectionId, ddl: 'create table stale (id int);', updatedAt: '' });
    const loaded = await loading;

    expect(schemasState.byConnection[connectionId]).toBe('create table fresh (id int);');
    expect(loaded).toBe('create table fresh (id int);');
  });
});
