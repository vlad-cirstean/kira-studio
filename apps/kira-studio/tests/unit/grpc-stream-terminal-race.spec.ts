// P21 round 1 functional finding F5: a server-streaming call's messages arrive over the event
// channel (control.onGrpcCall), while the call's own CallResult returns over the control plane —
// a separate HTTP request (control.grpcCall) — with nothing ordering the two. The return path's
// own guard (`if (rt.opId !== opId) return`) assumed the terminal event always arrives first; when
// the control-plane response lands first instead, the return path used to clear rt.opId before the
// terminal event — carrying the trailing message batch and the terminal status — had been
// delivered, and the event handler's own `rt.opId !== event.callId` check then dropped it outright.
// This drives both orderings directly, the exact interleaving no Playwright test can force (the
// same technique grpc-schema-supersession.spec.ts already established for loadSchema's own race).
import './support/window';

import { afterEach, describe, expect, test } from 'bun:test';
import type { GrpcCallEvent, GrpcCallResultWire, GrpcSchemaWire } from '@shared/domain/grpc';

const { control } = await import('../../frontend/src/bridge/control');
const { openGrpcRequestTab, patchGrpcRequestTabState } = await import(
  '../../frontend/src/api/tabs'
);
const { call, runtime, schemaRuntime } = await import('../../frontend/src/views/grpcrequest/state');

const originalGrpcCall = control.grpcCall;
afterEach(() => {
  control.grpcCall = originalGrpcCall;
});

// ensureGrpcCallSubscription (state.ts) calls control.onGrpcCall exactly once ever, module-wide
// (a `subscribedToGrpcCall` flag, never reset) — the first call() in this whole test process to
// reach it is the only one that ever registers a callback. Captured once, at module scope, so
// every test below (and any earlier spec file's own call() in this shared bun test process) shares
// the same captured callback rather than each expecting its own fresh registration.
let capturedCallback: ((event: GrpcCallEvent) => void) | null = null;
// biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real onGrpcCall
(control as any).onGrpcCall = (cb: (event: GrpcCallEvent) => void) => {
  capturedCallback = cb;
  return () => {};
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function streamingSchema(): GrpcSchemaWire {
  return {
    services: [
      {
        name: 'Svc',
        methods: [
          {
            name: 'Stream',
            fullName: 'Svc/Stream',
            clientStreaming: false,
            serverStreaming: true,
            inputType: '.Req',
            outputType: '.Resp',
            requestTemplate: '{}',
          },
        ],
      },
    ],
    mode: 'proto',
    warnings: [],
  };
}

function terminalResult(): GrpcCallResultWire {
  return {
    code: 0,
    codeName: 'OK',
    statusMessage: '',
    elapsedMs: 5,
    header: [],
    trailer: [],
    messageCount: 2,
    messageBytes: 20,
  };
}

function setUpStreamingTab(): string {
  const id = openGrpcRequestTab();
  patchGrpcRequestTabState(id, { service: 'Svc', method: 'Stream' });
  schemaRuntime[id] = { status: 'idle', schema: streamingSchema(), error: null, genId: 0 };
  return id;
}

describe("a server-streaming call's terminal event race (F5)", () => {
  test('the control-plane response arriving before the terminal event does not lose the trailing batch', async () => {
    const id = setUpStreamingTab();

    const grpcCallDeferred = deferred<GrpcCallResultWire>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real grpcCall
    (control as any).grpcCall = () => grpcCallDeferred.promise;

    const callPromise = call(id);
    // Wait a tick so call() has run its synchronous setup (subscribing, setting opId/lastCallId)
    // and reached the awaited control.grpcCall.
    await Promise.resolve();
    await Promise.resolve();

    const opId = runtime[id]?.opId;
    expect(opId).toBeTruthy();

    // The control-plane response lands FIRST — the reverse of the order the code used to assume.
    grpcCallDeferred.resolve(terminalResult());
    await callPromise;
    expect(runtime[id]?.opId).toBeNull();
    expect(runtime[id]?.status).toBe('idle');

    // The terminal event — carrying the trailing batch — is delivered only now, after opId has
    // already been cleared.
    expect(capturedCallback).not.toBeNull();
    capturedCallback?.({
      callId: opId as string,
      seq: 0,
      messages: [
        { seq: 0, json: '{"n":0}', wireBytes: 10, offsetMs: 1 },
        { seq: 1, json: '{"n":1}', wireBytes: 10, offsetMs: 2 },
      ],
      done: true,
      status: terminalResult(),
    });

    // The fix: the event is still matched (via lastCallId, which opId-clearing does not touch)
    // and its messages are applied — this is exactly what used to be silently dropped.
    expect(runtime[id]?.messages).toHaveLength(2);
    expect(runtime[id]?.trueMessageCount).toBe(2);
    expect(runtime[id]?.messageBytes).toBe(20);
  });

  test('the terminal event arriving before the control-plane response still works (the order the code always handled)', async () => {
    const id = setUpStreamingTab();

    const grpcCallDeferred = deferred<GrpcCallResultWire>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real grpcCall
    (control as any).grpcCall = () => grpcCallDeferred.promise;

    const callPromise = call(id);
    await Promise.resolve();
    await Promise.resolve();
    const opId = runtime[id]?.opId;

    capturedCallback?.({
      callId: opId as string,
      seq: 0,
      messages: [{ seq: 0, json: '{"n":0}', wireBytes: 10, offsetMs: 1 }],
      done: true,
      status: terminalResult(),
    });
    expect(runtime[id]?.opId).toBeNull();
    expect(runtime[id]?.messages).toHaveLength(1);

    grpcCallDeferred.resolve(terminalResult());
    await callPromise;

    // The return path's own supersession guard bails out — the event already finalized this call.
    expect(runtime[id]?.messages).toHaveLength(1);
  });
});
