import { describe, expect, test } from "bun:test";
import type {
  LayoutChunk,
  LayoutFrontier,
  LayoutInput,
  LayoutRequest,
  LayoutResponse,
} from "../../../packages/core/src/index.ts";
import {
  createLayoutClient,
  LayoutClientStaleError,
  type WorkerLike,
} from "../../../packages/ui/src/graph/layoutClient.ts";

/**
 * P4 W4's own "Done when": `layoutClient.ts` threads the frontier from one response into the
 * next request without exposing it to callers; `reset()` discards the tracked frontier and
 * causes a response for a request issued before the reset to be dropped rather than applied;
 * `dispose()` rejects any submit() still pending and refuses further submits. None of this
 * needs a real `Worker` — `WorkerLike` is exactly the seam that lets a fake stand in.
 */

/** A `WorkerLike` fully under the test's control: `postMessage` records the request instead of
 *  handing it to a real worker, and the test decides when (and with what) to reply by calling
 *  `respond()` — modelling the asynchronous, message-passing nature of a real worker without
 *  requiring one. */
function fakeWorker(): {
  worker: WorkerLike;
  sent: LayoutRequest[];
  respond(response: LayoutResponse): void;
  fail(message: string): void;
  terminated: boolean;
} {
  const sent: LayoutRequest[] = [];
  let terminated = false;
  const worker: WorkerLike = {
    postMessage(message: unknown) {
      sent.push(message as LayoutRequest);
    },
    onmessage: null,
    onerror: null,
    terminate() {
      terminated = true;
    },
  };
  return {
    worker,
    sent,
    respond(response: LayoutResponse) {
      worker.onmessage?.({ data: response } as MessageEvent<LayoutResponse>);
    },
    fail(message: string) {
      worker.onerror?.({ message } as ErrorEvent);
    },
    get terminated() {
      return terminated;
    },
  };
}

/** Minimal stand-ins good enough to round-trip through the client — `layoutClient.ts` never
 *  inspects the shape of `input`/`chunk`/`frontier`, only threads them, so these do not need to
 *  be real layout output. */
function stubInput(): LayoutInput {
  return {
    from: 0,
    to: 1,
    parentOffsets: new Uint32Array(0),
    parentRows: new Int32Array(0),
    resolvedParentSlots: new Uint32Array(0),
  };
}

function stubChunk(tag: number): LayoutChunk {
  return {
    from: 0,
    to: 1,
    laneOf: new Uint32Array([tag]),
    colorOf: new Uint32Array([tag]),
    edges: new Uint32Array(0),
    edgeIndex: new Uint32Array([0, 0]),
    patches: new Uint32Array(0),
    laneCount: 1,
    maxEdgeSpan: 0,
    transfer: [],
  };
}

function stubFrontier(tag: number): LayoutFrontier {
  return { tag } as unknown as LayoutFrontier;
}

describe("createLayoutClient", () => {
  test("submit() sends frontier: undefined on the first request", () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    void client.submit(stubInput());

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.frontier).toBeUndefined();
    expect(fake.sent[0]?.sequence).toBe(0);
  });

  test("a response's frontier is threaded into the next submit()'s request, hidden from the caller", async () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    const first = client.submit(stubInput());
    fake.respond({ sequence: 0, chunk: stubChunk(1), frontier: stubFrontier(1) });
    const chunk1 = await first;
    expect(chunk1).toEqual(stubChunk(1));

    void client.submit(stubInput());
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]?.frontier).toEqual(stubFrontier(1));
  });

  test("reset() discards the tracked frontier so the next submit() starts fresh", async () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    const first = client.submit(stubInput());
    fake.respond({ sequence: 0, chunk: stubChunk(1), frontier: stubFrontier(1) });
    await first;

    client.reset();
    void client.submit(stubInput());

    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]?.frontier).toBeUndefined();
  });

  test("a response for a request issued before an intervening reset() is dropped, not applied", async () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    const stale = client.submit(stubInput());
    client.reset();
    const fresh = client.submit(stubInput());

    // The worker (slow, or just reordered) answers the pre-reset request after the reset.
    fake.respond({ sequence: 0, chunk: stubChunk(1), frontier: stubFrontier(1) });
    await expect(stale).rejects.toBeInstanceOf(LayoutClientStaleError);

    // The stale response must not have overwritten the frontier the fresh request should see.
    fake.respond({ sequence: 1, chunk: stubChunk(2), frontier: stubFrontier(2) });
    await fresh;

    void client.submit(stubInput());
    expect(fake.sent[2]?.frontier).toEqual(stubFrontier(2));
  });

  test("dispose() rejects a still-pending submit() and refuses further submits", async () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    const pending = client.submit(stubInput());
    client.dispose();

    await expect(pending).rejects.toThrow(/disposed/);
    expect(fake.terminated).toBe(true);
    await expect(client.submit(stubInput())).rejects.toThrow(/dispose/);
  });

  test("a worker error rejects every still-pending submit()", async () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    const a = client.submit(stubInput());
    const b = client.submit(stubInput());
    fake.fail("boom");

    await expect(a).rejects.toThrow(/boom/);
    await expect(b).rejects.toThrow(/boom/);
  });

  test("sequence numbers increase across resets rather than restarting", () => {
    const fake = fakeWorker();
    const client = createLayoutClient(() => fake.worker);

    void client.submit(stubInput());
    client.reset();
    void client.submit(stubInput());

    expect(fake.sent[0]?.sequence).toBe(0);
    expect(fake.sent[1]?.sequence).toBe(1);
  });
});
