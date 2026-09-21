// P63 §4.3/§7: ensureKeyTypes' own dedupe/supersede logic — interacting rules over an in-flight
// set plus a loadSeq guard, the "cache invalidation with interacting rules" case CLAUDE.md's own
// testing bar names. One test file, not a suite (§7's own scope: a split layout, an icon swap and
// a lookup table get nothing; this is the one thing in the plan that does).
import './support/window';

import { describe, expect, test } from 'bun:test';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';
import { restoreAfterEach } from './support/restoreAfterEach';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const {
  load: loadBrowse,
  descend: descendBrowse,
  ensureKeyTypes,
  runtime: browseRuntime,
} = await import('../../frontend/src/views/browse/state');

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Generous over the couple of microtask hops loadKeyTypes' own await chain needs (stub -> await
// control.treeKeyTypes -> the writes after it) — cheap, and avoids this file being sensitive to
// exactly how many .then()s sit between a resolved gate and the write under test.
async function flush(ticks = 10): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

async function openLoadedTab(connectionId: string, path: string): Promise<string> {
  const { id } = tabsStore.openBrowseTab(connectionId, path, { newTab: true });
  // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real TreeChildrenResult
  (control as any).treeChildren = async () => ({ nodes: [], truncated: false });
  await loadBrowse(id);
  return id;
}

describe('views/browse/state.ts — ensureKeyTypes dedupe/supersede (P63 §4.3)', () => {
  test('1. a path already known is not re-requested', async () => {
    const id = await openLoadedTab('conn-kt1', 'database:db0');
    let calls = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real bridge signature
    (control as any).treeKeyTypes = async (_cid: string, paths: string[]) => {
      calls++;
      return paths.map(() => 'string');
    };

    ensureKeyTypes(id, ['database:db0/key:a']);
    await flush();
    expect(browseRuntime[id]?.keyTypes.get('database:db0/key:a')).toBe('string');
    expect(calls).toBe(1);

    ensureKeyTypes(id, ['database:db0/key:a']);
    await Promise.resolve();
    expect(calls).toBe(1); // already known — no second call
  });

  test('2. a path already in flight is not requested twice', async () => {
    const id = await openLoadedTab('conn-kt2', 'database:db0');
    const calls: string[][] = [];
    const gate = deferred<string[]>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real bridge signature
    (control as any).treeKeyTypes = async (_cid: string, paths: string[]) => {
      calls.push(paths);
      return gate.promise;
    };

    ensureKeyTypes(id, ['database:db0/key:a']);
    ensureKeyTypes(id, ['database:db0/key:a']); // still in flight — must not start a second call

    expect(calls).toHaveLength(1);
    gate.resolve(['hash']);
    await flush();
    expect(browseRuntime[id]?.keyTypes.get('database:db0/key:a')).toBe('hash');
  });

  test('3. a response that lands after a level change is discarded', async () => {
    const id = await openLoadedTab('conn-kt3', 'database:db0');
    const gate = deferred<string[]>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real bridge signature
    (control as any).treeKeyTypes = async () => gate.promise;

    ensureKeyTypes(id, ['database:db0/key:a']);

    // The level changes (and so loadSeq bumps) while the batch above is still in flight.
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real TreeChildrenResult
    (control as any).treeChildren = async () => ({ nodes: [], truncated: false });
    await descendBrowse(id, 'database:db0/namespace:ns');

    gate.resolve(['string']);
    await flush();

    expect(browseRuntime[id]?.keyTypes.has('database:db0/key:a')).toBe(false);
  });

  test('4. a failed batch is silent and leaves rows re-fetchable', async () => {
    const id = await openLoadedTab('conn-kt4', 'database:db0');
    let calls = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real bridge signature
    (control as any).treeKeyTypes = async () => {
      calls++;
      throw new Error('E_QUERY: boom');
    };

    ensureKeyTypes(id, ['database:db0/key:a']);
    await flush();
    expect(browseRuntime[id]?.keyTypes.has('database:db0/key:a')).toBe(false);
    expect(browseRuntime[id]?.status).not.toBe('error'); // a decorative badge never raises the load strip

    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real bridge signature
    (control as any).treeKeyTypes = async (_cid: string, paths: string[]) => paths.map(() => 'set');
    ensureKeyTypes(id, ['database:db0/key:a']); // the failed path is not stuck "pending" forever
    await flush();
    expect(browseRuntime[id]?.keyTypes.get('database:db0/key:a')).toBe('set');
    expect(calls).toBe(1);
  });
});
