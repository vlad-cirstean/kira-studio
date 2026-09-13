import { describe, expect, test } from 'bun:test';
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { WorkingDetailState } from './working.ts';

/** Same fake `Transport` shape `pr.test.ts`/`repoSettings.test.ts` already establish — request()
 *  is scripted per call via `onRequest`, deferred resolution controlled by the test itself (needed
 *  for the stale-response case below). */
class FakeTransport implements Transport {
  onRequest: (method: RequestKey, params: unknown) => unknown = () => {
    throw new Error('unscripted request');
  };
  readonly calls: Array<{ method: RequestKey; params: unknown }> = [];
  #handlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  request<K extends RequestKey>(method: K, params: ParamsOf<K>): Promise<ResultOf<K>> {
    this.calls.push({ method, params });
    return Promise.resolve(this.onRequest(method, params) as ResultOf<K>);
  }

  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    return () => set?.delete(wrapped);
  }

  emit<K extends EventKey>(method: K, payload: EventPayload<K>): void {
    for (const handler of this.#handlers.get(method) ?? []) handler(payload);
  }

  stream<K extends StreamKey>(
    _method: K,
    _params: StreamParamsOf<K>,
    _onChunk: (chunk: StreamChunkOf<K>) => void,
  ): Promise<void> {
    return Promise.reject(new Error('not used by these tests'));
  }

  dispose(): void {}
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function tick(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const REPO = '/repos/a';
const oneFile = {
  kind: 'modified' as const,
  path: 'a.txt',
  originalPath: undefined,
  similarity: undefined,
  additions: 1,
  deletions: 0,
  isBinary: false,
};

describe('WorkingDetailState', () => {
  test('select(true) requests working.detail and populates files', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    working.setRepoId(REPO);
    transport.onRequest = () => ({ files: [oneFile] });

    working.select(true);
    await tick();

    expect(working.selected.value).toBe(true);
    expect(working.files.value).toEqual([oneFile]);
    expect(transport.calls).toEqual([{ method: 'working.detail', params: { repoId: REPO } }]);
  });

  test('select(false) clears files and selected immediately, without waiting on any in-flight request', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    working.setRepoId(REPO);
    const first = deferred<ResultOf<'working.detail'>>();
    transport.onRequest = () => first.promise;

    working.select(true);
    working.select(false);

    expect(working.selected.value).toBe(false);
    expect(working.files.value).toEqual([]);

    first.resolve({ files: [oneFile] });
    await tick();
    // The late resolution of the aborted request must never repopulate files after select(false).
    expect(working.files.value).toEqual([]);
  });

  test('re-selecting after a deselect issues a fresh request rather than reusing stale data', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    working.setRepoId(REPO);
    transport.onRequest = () => ({ files: [oneFile] });

    working.select(true);
    await tick();
    working.select(false);
    working.select(true);
    await tick();

    expect(working.files.value).toEqual([oneFile]);
    expect(transport.calls.length).toBe(2);
  });

  test('refresh() re-fetches only while selected', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    working.setRepoId(REPO);
    transport.onRequest = () => ({ files: [oneFile] });

    working.refresh();
    await tick();
    expect(transport.calls.length).toBe(0);

    working.select(true);
    await tick();
    expect(transport.calls.length).toBe(1);

    working.refresh();
    await tick();
    expect(transport.calls.length).toBe(2);
  });

  test('selectFile moves the file cursor', () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    expect(working.selectedFile.value).toBe(-1);
    working.selectFile(2);
    expect(working.selectedFile.value).toBe(2);
  });

  test('a request error surfaces on error and leaves files empty', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const working = new WorkingDetailState(bridge);
    working.setRepoId(REPO);
    transport.onRequest = () => {
      throw new Error('boom');
    };

    working.select(true);
    await tick();

    expect(working.error.value).toBeDefined();
    expect(working.files.value).toEqual([]);
  });
});
