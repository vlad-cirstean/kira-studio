import type { Page } from '@playwright/test';
import type { GraphStreamChunkFixture } from './graphStreamFixture';

// repo/git/transport.ts speaks the native git JSON-RPC protocol (@kira/git-ipc's rpc.ts) over a
// Wails Stream — an entirely different wire (and mocking mechanism, `window._wails.streamFactory`)
// than mockRuntime.ts's `control.*` Call endpoint or mockStream.ts's own FlatBuffers bulk-data
// protocol, and one this repo has no existing mock for (C10 never added a UI test for its own
// graph mount for the identical reason). installGitStreamMock below is a minimal, purpose-built
// stand-in — real enough to answer the three requests this shallow path actually needs
// (app.init, repo.list, refs.list) and silent (never crashing, just never resolving) for every
// other method, which is exactly what a real bootstrap() tolerates: review.session.load and
// review.resolveBase are awaited but never block the branch picker from rendering.
//
// P67b §3/§9: moved out of repo-workspace.spec.ts (its original, sole caller) so
// repo-graph-lifecycle.spec.ts can drive the same socket double for its two bug-regression cases.
// The socket's own `readyState`/`onopen` timing is the one thing both bugs hinge on:
//  - it starts CONNECTING (0) and flips to OPEN (1) only after a real macrotask (`setTimeout`),
//    the same "Stream() returns before the handshake completes" ordering the real WailsSocket has
//    (§3's own root cause) — an opened-synchronously double would make bug 2's regression pass
//    vacuously regardless of whether streamChannel.ts's open-ack gate is present.
//  - `send()` now THROWS on a CONNECTING socket, mirroring `@wailsio/runtime`'s own
//    `WailsSocket.send` (§3's root-cause quote) — without this, the pre-fix `post` (a bare
//    `socket.send(...)`) would silently succeed against this double even though the real socket
//    throws, which is the same vacuous-pass risk from the opposite direction.
// P76 §12.2: `extraResults` is optional and additive — merged into `resultByMethod` only for a
// caller that passes it, so `repo-graph-lifecycle.spec.ts`'s own bootstrap() (and every other
// existing caller) keeps hanging on every method beyond the three above exactly as before. Adding
// `repo.open`/`blame.line` globally would let bootstrap() proceed past a point it currently hangs
// at, a behavior change for specs that never asked for it (P74/P75 both recorded this mock's own
// missing graph.stream/commit.detail as a known gap — this stays additive for the same reason).
export async function installGitStreamMock(
  page: Page,
  gitRepoId: string,
  extraResults?: Record<string, unknown>,
  // P92 item 5: pre-encoded `graph.stream` chunks, built by `graphStreamFixture.ts`'s
  // `buildGraphStreamChunk` — real `commit.detail`/`file.read` stay on `extraResults` (plain
  // req/res), only `graph.stream`'s own streamed, binary-carrying shape needs this separate path.
  // Delivered in order on any `graph.stream` open, then an `end` frame; still additive like
  // `extraResults` — a caller that omits this keeps hanging on `graph.stream` exactly as before
  // (§10's own known-gap note).
  graphStreamChunks?: readonly GraphStreamChunkFixture[],
): Promise<void> {
  await page.evaluate(
    ({
      repoId,
      extraResults,
      graphStreamChunks,
    }: {
      repoId: string;
      extraResults?: Record<string, unknown>;
      graphStreamChunks?: readonly GraphStreamChunkFixture[];
    }) => {
      const w =
        (window as unknown as { _wails?: { streamFactory?: (name: string) => unknown } })._wails ??
        {};
      (window as unknown as { _wails: typeof w })._wails = w;
      const existingFactory = w.streamFactory;

      const CONNECTING = 0;
      const OPEN = 1;
      const CLOSED = 3;

      interface MockSocket {
        binaryType: string;
        onopen: ((ev: unknown) => void) | null;
        onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
        onclose: ((ev: unknown) => void) | null;
        onerror: ((ev: unknown) => void) | null;
        readyState: number;
        send(data: string): void;
        close(): void;
      }

      function deliver(socket: MockSocket, envelope: unknown): void {
        const bytes = new TextEncoder().encode(JSON.stringify(envelope));
        setTimeout(() => socket.onmessage?.({ data: bytes.buffer }), 0);
      }

      // P92 item 5: `blobFrame.ts`'s own layout, assembled here rather than decoded — the real
      // client never sends a blob (that file's own doc comment), so no encoder exists there to
      // reuse. `id`/`version` are only known at this point (the request's own runtime fields),
      // which is why `graphStreamFixture.ts` hands over `meta`/`blob` separately instead of a
      // whole pre-built frame.
      function deliverGraphStreamChunk(
        socket: MockSocket,
        version: number,
        id: number,
        chunk: GraphStreamChunkFixture,
      ): void {
        const blobBytes = Uint8Array.from(atob(chunk.blob), (c) => c.charCodeAt(0));
        const header = {
          version,
          body: {
            t: 'chunk',
            id,
            seq: chunk.meta.seq,
            chunk: {
              repoId: chunk.meta.repoId,
              seq: chunk.meta.seq,
              from: chunk.meta.from,
              to: chunk.meta.to,
              source: chunk.meta.source,
              remaining: chunk.meta.remaining,
              exhausted: chunk.meta.exhausted,
              commits: { $fb: chunk.meta.commitsFb, d: { $blob: true } },
            },
          },
        };
        const headerBytes = new TextEncoder().encode(JSON.stringify(header));
        const out = new Uint8Array(1 + 4 + headerBytes.byteLength + blobBytes.byteLength);
        const view = new DataView(out.buffer);
        out[0] = 0x00;
        view.setUint32(1, headerBytes.byteLength, false);
        out.set(headerBytes, 5);
        out.set(blobBytes, 5 + headerBytes.byteLength);
        setTimeout(() => socket.onmessage?.({ data: out.buffer }), 0);
      }

      function createGitMockSocket(): MockSocket {
        const socket: MockSocket = {
          binaryType: 'arraybuffer',
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          readyState: CONNECTING,
          send(data: string) {
            // @wailsio/runtime's own WailsSocket.send throws on a CONNECTING socket (P67b §3's root
            // cause, quoted verbatim in the plan) — reproduced here so a channel that skips the
            // open-ack gate and sends synchronously actually fails the way the real bug did.
            if (socket.readyState === CONNECTING) {
              throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
            }
            // bridge/port.ts's own P57 D3 comment, describing the same WailsSocket: "throws on a
            // CONNECTING socket and silently drops on a closed one" — a request sent over a
            // transport whose lease/dispose tore down the underlying socket (bug 1, §2) must hang
            // exactly as the real bug did, not (wrongly) still answer.
            if (socket.readyState === CLOSED) return;
            let envelope: { version: number; body?: { t?: string; id?: number; method?: string } };
            try {
              envelope = JSON.parse(data);
            } catch {
              return;
            }
            const frame = envelope.body;
            if (frame?.id === undefined) return;
            // `graph.stream` opens as `t: 'open'`, not `t: 'req'` — a real unary call's frame
            // shape (rpc.ts's own `Frame` union). Only handled when a caller actually supplied
            // chunks; otherwise this falls through to the `!== 'req'` guard below and hangs,
            // same as every other unlisted method here.
            if (frame.t === 'open' && frame.method === 'graph.stream' && graphStreamChunks) {
              const id = frame.id;
              for (const chunk of graphStreamChunks) {
                deliverGraphStreamChunk(socket, envelope.version, id, chunk);
              }
              deliver(socket, { version: envelope.version, body: { t: 'end', id } });
              return;
            }
            if (frame?.t !== 'req' || frame.id === undefined) return;
            // @kira/git-ipc's rpc.ts frame union: {t:'res', id, ok:true, result}.
            const resultByMethod: Record<string, unknown> = {
              'app.init': {
                contractVersion: envelope.version,
                serverVersion: 'ui-test',
                git: { kind: 'ok', path: '/usr/bin/git', version: '2.40.0' },
              },
              'repo.list': { candidates: [], activeRepoId: repoId },
              'refs.list': {
                branches: [
                  {
                    refname: 'refs/heads/main',
                    kind: 'branch',
                    shortName: 'main',
                    objectId: '0'.repeat(40),
                    peeledObjectId: undefined,
                    upstream: undefined,
                    track: undefined,
                    committerDate: 0,
                    isHead: true,
                    checkedOutIn: undefined,
                    annotation: undefined,
                  },
                ],
                remoteBranches: [],
                tags: [],
                head: { kind: 'branch', name: 'main' },
              },
              ...extraResults,
            };
            const method = frame.method;
            if (method === undefined || !(method in resultByMethod)) return; // hang forever
            deliver(socket, {
              version: envelope.version,
              body: { t: 'res', id: frame.id, ok: true, result: resultByMethod[method] },
            });
          },
          close() {
            socket.readyState = CLOSED;
          },
        };
        // Genuinely asynchronous — a later macrotask, not the same tick `Stream()` returns in. Any
        // code that sends before this fires is sending on a CONNECTING socket, exactly the window
        // bug 2 lived in.
        setTimeout(() => {
          socket.readyState = OPEN;
          socket.onopen?.({});
        }, 0);
        return socket;
      }

      w.streamFactory = (name: string) =>
        name === 'git' ? createGitMockSocket() : existingFactory?.(name);
    },
    { repoId: gitRepoId, extraResults, graphStreamChunks },
  );
}
