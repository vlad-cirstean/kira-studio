// The tagged-protocol test fixture for P54's Go-side tests (host_test.go, stream_test.go) —
// successor to p51-spike-artifacts/gonode/engine_stub.mjs, speaking the same
// | length uint32 BE | tag uint8 | body | framing as shell/internal/enginehost/frame.go and
// src/engine/stdio-main.ts (P54 §3). Every op responds on whichever tag its request arrived on,
// unless noted otherwise.
//
// ops:
//   ping     -> {pong:true, enginePid, at}
//   echo     -> returns payload verbatim
//   raw      -> payload:{bytesBase64} decoded and written as a literal, non-JSON tag-1 body
//   slow     -> never answers
//   boom     -> ok:false {message:"synthetic failure", code:"E_SPIKE"}
//   bare     -> ok:false {message:"no code here"} (no `code` field)
//   crash    -> process.exit(3) without answering
//   logline  -> writes two lines to stderr, then answers {}
//   evt      -> payload:{topic, payload} - writes an unsolicited tag-0 PortEvent, then answers {}
//   badtag   -> writes a bogus tag-7 frame, then a valid response on the arrival tag
//   flood    -> payload:{count, size} - writes `count` tag-1 frames of `size` deterministic
//               bytes each, synchronously, then answers ok:true on the arrival tag

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
  while (true) {
    if (buf.length < 5) return;
    const len = buf.readUInt32BE(0);
    if (buf.length < 5 + len) return;
    const tag = buf.readUInt8(4);
    const frame = buf.subarray(5, 5 + len);
    buf = buf.subarray(5 + len);
    handleFrame(tag, frame);
  }
});

function writeFrame(tag, obj) {
  writeRaw(tag, Buffer.from(JSON.stringify(obj), 'utf8'));
}

function writeRaw(tag, body) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(body.length, 0);
  header.writeUInt8(tag, 4);
  process.stdout.write(Buffer.concat([header, body]));
}

function handleFrame(tag, frame) {
  let req;
  try {
    req = JSON.parse(frame.toString('utf8'));
  } catch {
    return;
  }
  if (req.kind !== 'req') return;

  switch (req.op) {
    case 'ping':
      writeFrame(tag, {
        kind: 'res',
        id: req.id,
        ok: true,
        payload: { pong: true, enginePid: process.pid, at: Date.now() },
      });
      return;
    case 'echo':
      writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: req.payload });
      return;
    case 'raw': {
      const bytes = Buffer.from(req.payload.bytesBase64, 'base64');
      writeRaw(1, bytes);
      return;
    }
    case 'slow':
      return; // never answers
    case 'boom':
      writeFrame(tag, {
        kind: 'res',
        id: req.id,
        ok: false,
        error: { message: 'synthetic failure', code: 'E_SPIKE' },
      });
      return;
    case 'bare':
      writeFrame(tag, { kind: 'res', id: req.id, ok: false, error: { message: 'no code here' } });
      return;
    case 'crash':
      process.exit(3);
      return;
    case 'logline':
      console.error('fixture stderr line one');
      console.error('fixture stderr line two');
      writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: {} });
      return;
    case 'evt':
      writeFrame(0, { kind: 'evt', topic: req.payload.topic, payload: req.payload.payload });
      writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: {} });
      return;
    case 'badtag':
      writeRaw(7, Buffer.from('garbage frame on an unknown tag'));
      writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: {} });
      return;
    case 'flood': {
      const { count, size } = req.payload;
      for (let i = 0; i < count; i++) {
        writeRaw(1, Buffer.alloc(size, i % 256));
      }
      writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: {} });
      return;
    }
    default:
      writeFrame(tag, {
        kind: 'res',
        id: req.id,
        ok: false,
        error: { message: `unknown op: ${req.op}`, code: 'E_UNKNOWN_OP' },
      });
  }
}

process.on('SIGTERM', () => process.exit(0));
