// P76 §12.1 — the one earned unit test for this phase: blameLine.ts's controller (extracted from
// blameAnnotation.ts) holds two rules that have each already produced a real bug once (the file's
// own comments at the fix sites record both): the `line === lastLine` early return must precede
// `cancelPending` (5a — otherwise a same-line cursor move cancels its own in-flight request and
// nothing restarts it), and an ABORTED request must never be cached as a miss (5b — otherwise fast
// arrowing through lines accumulates permanently blame-less lines). `repo.changed` invalidation
// interacts with both. Drives the controller end to end with a plain fake cursor and a fake
// Transport — no Monaco import, per the controller's own `BlameCursorSource` narrowing.
import { describe, expect, test } from 'bun:test';
import type { ResultOf, Transport } from '../../../../packages/git-ipc/src/index.ts';
import {
  type BlameLineControllerDeps,
  createBlameLineController,
} from '../../frontend/src/views/repo/blameLine';

type BlameResult = ResultOf<'blame.line'>;
const UNCOMMITTED_SHA = '0'.repeat(40);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// blameLine.ts's own DEBOUNCE_MS (150) is private — wait comfortably past it rather than importing
// or duplicating the literal.
async function pastDebounce(): Promise<void> {
  await sleep(180);
}

function fakeCursor() {
  let position: { lineNumber: number } | null = null;
  let listener: (() => void) | undefined;
  return {
    // Structurally satisfies `BlameCursorSource` (getPosition/onDidChangeCursorPosition) without
    // importing monaco-editor — the controller only ever reads `.lineNumber` and calls the
    // listener with no arguments of its own.
    source: {
      getPosition: () => position,
      onDidChangeCursorPosition: (cb: () => void) => {
        listener = cb;
        return { dispose: () => (listener = undefined) };
      },
    } as unknown as BlameLineControllerDeps['cursor'],
    moveTo(line: number): void {
      position = { lineNumber: line };
      listener?.();
    },
  };
}

interface PendingCall {
  readonly line: number;
  resolve(result: BlameResult): void;
  reject(err: unknown): void;
}

/** A fake Transport answering `repo.open` immediately (ensureRepoOpen's own hold) and `blame.line`
 *  per call, left to the test to resolve/reject/abort. `repo.changed` is a real pub/sub so the
 *  controller's own subscription can be driven directly. */
function fakeTransport(): {
  transport: Transport;
  calls: PendingCall[];
  emitRepoChanged: (repoId: string) => void;
} {
  const calls: PendingCall[] = [];
  const repoChangedHandlers = new Set<(payload: { repoId: string; kind: string }) => void>();
  const transport = {
    request: (async (method: string, params: unknown) => {
      if (method === 'repo.open') return undefined;
      if (method === 'blame.line') {
        const { line } = params as { line: number };
        // No automatic abort -> reject wiring here, deliberately: the test drives
        // resolve()/reject() itself, including resolving an already-cancelled request
        // successfully (the real-world race `if (line === lastLine)` guards against on the
        // success path, not only via a transport that rejects on abort).
        return new Promise<BlameResult>((resolve, reject) => {
          calls.push({ line, resolve, reject });
        });
      }
      throw new Error(`fakeTransport: unexpected request ${method}`);
      // biome-ignore lint/suspicious/noExplicitAny: matching Transport['request']'s generic shape
    }) as any,
    on: ((method: string, handler: (payload: { repoId: string; kind: string }) => void) => {
      if (method !== 'repo.changed') throw new Error(`fakeTransport: unexpected event ${method}`);
      repoChangedHandlers.add(handler);
      return () => repoChangedHandlers.delete(handler);
      // biome-ignore lint/suspicious/noExplicitAny: matching Transport['on']'s generic shape
    }) as any,
    stream: (async () => {
      throw new Error('fakeTransport: stream not used');
      // biome-ignore lint/suspicious/noExplicitAny: matching Transport['stream']'s generic shape
    }) as any,
    dispose(): void {},
  } satisfies Transport;
  return {
    transport,
    calls,
    emitRepoChanged: (repoId: string) => {
      for (const h of repoChangedHandlers) h({ repoId, kind: 'refsChanged' });
    },
  };
}

function result(sha: string): BlameResult {
  return { sha, author: 'Ada', authorTimeSeconds: 1_700_000_000, summary: 'a commit' };
}

describe('blameLine.ts createBlameLineController', () => {
  test('a same-line cursor move while a request is in flight: one call, still resolves', async () => {
    const { transport, calls } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-a',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(5);
    await pastDebounce();
    expect(calls).toHaveLength(1);
    cursor.moveTo(5); // same line, request already in flight — must not cancel it (5a)

    calls[0]?.resolve(result('aaa'));
    await sleep(10);

    expect(calls).toHaveLength(1);
    expect(controller.state.value).toEqual({ kind: 'resolved', line: 5, ...result('aaa') });
    controller.dispose();
  });

  test('a later line supersedes an earlier one: the earlier late response never becomes state', async () => {
    const { transport, calls } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-b',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(1);
    await pastDebounce();
    expect(calls).toHaveLength(1);
    cursor.moveTo(2); // cancels line 1's in-flight request
    await pastDebounce();
    expect(calls).toHaveLength(2);

    calls[1]?.resolve(result('bbb')); // line 2 resolves first
    await sleep(10);
    calls[0]?.resolve(result('aaa')); // line 1's late response arrives after
    await sleep(10);

    expect(controller.state.value).toEqual({ kind: 'resolved', line: 2, ...result('bbb') });
    controller.dispose();
  });

  test('an aborted request is not cached: revisiting the line issues a new request', async () => {
    const { transport, calls } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-c',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(3);
    await pastDebounce();
    expect(calls).toHaveLength(1);
    cursor.moveTo(4); // aborts line 3's request (its AbortController.signal.aborted is now true)
    // The transport eventually reports the cancellation as a rejection — 5b: since the request
    // was aborted, this must NOT be cached as a resolved miss.
    calls[0]?.reject(new DOMException('aborted', 'AbortError'));
    await pastDebounce();
    calls[1]?.resolve(result('ddd'));
    await sleep(10);

    cursor.moveTo(3); // revisit — a cached null would skip this silently
    await pastDebounce();

    expect(calls).toHaveLength(3);
    expect(calls[2]?.line).toBe(3);
    calls[2]?.resolve(result('ccc'));
    await sleep(10);
    expect(controller.state.value).toEqual({ kind: 'resolved', line: 3, ...result('ccc') });
    controller.dispose();
  });

  test('a genuine RPC failure is cached as a miss: revisiting issues none, state is none', async () => {
    const { transport, calls } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-d',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(6);
    await pastDebounce();
    expect(calls).toHaveLength(1);
    calls[0]?.reject(new Error('boom')); // a real failure, not an abort
    await sleep(10);
    expect(controller.state.value).toEqual({ kind: 'none' });

    cursor.moveTo(7);
    await pastDebounce();
    cursor.moveTo(6); // revisit — cached miss, no new request
    await sleep(10);

    expect(calls).toHaveLength(2); // only line 7's own call, never a second line-6 call
    expect(controller.state.value).toEqual({ kind: 'none' });
    controller.dispose();
  });

  test('repo.changed for this repo clears and re-resolves; for another repo is a no-op', async () => {
    const { transport, calls, emitRepoChanged } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-e',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(9);
    await pastDebounce();
    calls[0]?.resolve(result('eee1'));
    await sleep(10);
    expect(controller.state.value).toEqual({ kind: 'resolved', line: 9, ...result('eee1') });

    emitRepoChanged('some-other-repo');
    await sleep(10);
    expect(calls).toHaveLength(1); // untouched — a different repo's event is a no-op

    emitRepoChanged('repo-e');
    await pastDebounce();
    expect(calls).toHaveLength(2); // cache cleared, cursor's own line re-resolved
    calls[1]?.resolve(result('eee2'));
    await sleep(10);
    expect(controller.state.value).toEqual({ kind: 'resolved', line: 9, ...result('eee2') });
    controller.dispose();
  });

  test('the all-zero sha resolves to uncommitted, never resolved', async () => {
    const { transport, calls } = fakeTransport();
    const cursor = fakeCursor();
    const controller = createBlameLineController({
      transport,
      gitRepoId: 'repo-f',
      path: 'a.ts',
      cursor: cursor.source,
    });

    cursor.moveTo(8);
    await pastDebounce();
    calls[0]?.resolve(result(UNCOMMITTED_SHA));
    await sleep(10);

    expect(controller.state.value).toEqual({ kind: 'uncommitted', line: 8 });
    controller.dispose();
  });
});
