// The engine's second, complete entry point (P52 §4.4/§7.3): the same control.ts / rpc.ts / cache
// modules index.ts wires, over a framed stdio pipe to the Go shell instead of Electron's
// parentPort + MessagePort pair. index.ts is untouched and both entry points are whole for the
// coexistence window; P57 deletes index.ts.
//
// Frame: | length uint32 BE | tag uint8 | body (UTF-8 JSON) |, length excluding the tag.
// tag 0 = control (handleFrame), tag 1 = data (dispatch). The Go side is
// shell/internal/enginehost/frame.go.

import { Console } from 'node:console';
import { PORT_EVENT } from '@shared/protocol/data-ops';
import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';
import { cache } from './cache';
import { handleFrame } from './control';
import { dispatch } from './rpc';

const TAG_CONTROL = 0;
const TAG_DATA = 1;
const HEADER_BYTES = 5;
const MAX_FRAME_BYTES = 128 * 1024 * 1024;

// stdout is the frame channel here, not a log sink: a stray console.log lands between two frames
// and desynchronises the Go reader. control.ts's AdapterDeps.log and cache/lru.ts both use
// console, so every console method is repointed at stderr — which the Go host pumps into its own
// logger, preserving the single-log-file property.
const out = process.stdout;
globalThis.console = new Console({
  stdout: process.stderr,
  stderr: process.stderr,
}) as unknown as typeof console;

let stdinPaused = false;

function writeFrame(tag: number, message: PortResponse | PortEvent): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
  frame.writeUInt32BE(body.length, 0);
  frame.writeUInt8(tag, 4);
  body.copy(frame, HEADER_BYTES);
  if (!out.write(frame) && !stdinPaused) {
    // The Go host stops reading stdout when its own bulk-data queue fills (P52 §7.2). Honouring
    // that here turns the resulting pipe backpressure into "stop taking new work" rather than an
    // unbounded write buffer inside this process.
    stdinPaused = true;
    process.stdin.pause();
  }
}

out.on('drain', () => {
  if (stdinPaused) {
    stdinPaused = false;
    process.stdin.resume();
  }
});

// control.ts's emit() posts unsolicited events through process.parentPort — the engine's existing
// "tell the host" seam. Under stdio the host is the Go process and the seam is a tag-0 frame;
// defining it here is what lets control.ts stay byte-identical. Safe before any emit: control.ts's
// module body only stores emit (wireScheduler), and nothing emits before a request arrives.
Object.defineProperty(process, 'parentPort', {
  configurable: true,
  value: {
    postMessage: (message: PortResponse | PortEvent) => writeFrame(TAG_CONTROL, message),
  } as unknown as typeof process.parentPort,
});

// index.ts's D16 "no-op when no port is attached" moves to the Go side, which drops data frames
// while no renderer stream is attached. The engine always writes them.
cache.onStatsChanged((stats) =>
  writeFrame(TAG_DATA, { kind: 'evt', topic: PORT_EVENT.cacheStats, payload: stats }),
);

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < HEADER_BYTES) return;
    const length = buf.readUInt32BE(0);
    if (length > MAX_FRAME_BYTES) {
      console.error(`[engine] frame length ${length} exceeds the protocol limit; exiting`);
      process.exit(1);
    }
    if (buf.length < HEADER_BYTES + length) return;
    const tag = buf.readUInt8(4);
    const body = buf.subarray(HEADER_BYTES, HEADER_BYTES + length);
    buf = buf.subarray(HEADER_BYTES + length);
    handleIncoming(tag, body);
  }
});

// stdin closing is the shutdown signal: the engine outlives a renderer reload but not the app,
// and there is no parentPort 'close' analogue here.
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function handleIncoming(tag: number, body: Buffer): void {
  let request: PortRequest;
  try {
    request = JSON.parse(body.toString('utf8')) as PortRequest;
  } catch {
    console.error('[engine] dropped an unparseable frame');
    return;
  }
  if (request.kind !== 'req') return;

  if (tag === TAG_CONTROL) {
    // handleFrame is total today — it catches internally and always resolves a PortResponse. The
    // rejection arm exists because an unhandled rejection would take the whole engine down under
    // Node's default policy, and losing every connection to one malformed op is not acceptable.
    handleFrame(request).then(
      (response) => writeFrame(TAG_CONTROL, response),
      (err: unknown) => writeFrame(TAG_CONTROL, failure(request.id, err)),
    );
    return;
  }
  if (tag === TAG_DATA) {
    // `transfer` has no analogue over a pipe and is always undefined anyway (rpc.ts's own doc
    // comment) — the destructure drops it deliberately, not by omission.
    dispatch(request).then(
      ({ response }) => writeFrame(TAG_DATA, response),
      (err: unknown) => writeFrame(TAG_DATA, failure(request.id, err)),
    );
    return;
  }
  console.error(`[engine] dropped a frame with unknown channel tag ${tag}`);
}

function failure(id: number, err: unknown): PortResponse {
  return {
    kind: 'res',
    id,
    ok: false,
    error: { message: err instanceof Error ? err.message : String(err) },
  };
}
