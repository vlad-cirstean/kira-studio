import { describe, expect, test } from 'bun:test';
import type { ResultOf } from '@kira/git-ipc';
import { deferred, sleep } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import { FakeTransport } from '../testing/fakeTransport.ts';
import { WorkingDetailState } from './working.ts';

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
    await sleep();

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
    await sleep();
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
    await sleep();
    working.select(false);
    working.select(true);
    await sleep();

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
    await sleep();
    expect(transport.calls.length).toBe(0);

    working.select(true);
    await sleep();
    expect(transport.calls.length).toBe(1);

    working.refresh();
    await sleep();
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
    await sleep();

    expect(working.error.value).toBeDefined();
    expect(working.files.value).toEqual([]);
  });
});
