// Prototype "Node engine" stand-in for P51 §3.3 — the Go<->Node stdio transport.
// Frames: 4-byte big-endian uint32 length prefix + UTF-8 JSON payload, over stdin/stdout.
// Mirrors src/shared/protocol/port.ts's PortRequest/PortResponse/PortEvent shapes verbatim.

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    if (buf.length < 4) return;
    const len = buf.readUInt32BE(0);
    if (buf.length < 4 + len) return;
    const frame = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    handleFrame(frame);
  }
});

function writeFrame(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function handleFrame(frame) {
  let req;
  try {
    req = JSON.parse(frame.toString('utf8'));
  } catch (e) {
    return;
  }
  if (req.kind !== 'req') return;

  switch (req.op) {
    case 'ping':
      writeFrame({
        kind: 'res',
        id: req.id,
        ok: true,
        payload: { pong: true, enginePid: process.pid, at: Date.now() },
      });
      break;
    case 'echo':
      writeFrame({ kind: 'res', id: req.id, ok: true, payload: req.payload });
      break;
    case 'bulk': {
      // Simulate a bulk data page, the case §2.1/§3.2 cares about.
      const rows = Array.from({ length: req.payload?.rows ?? 1000 }, (_, i) => ({
        i,
        v: `row-${i}`,
      }));
      writeFrame({ kind: 'res', id: req.id, ok: true, payload: rows });
      break;
    }
    case 'boom':
      writeFrame({
        kind: 'res',
        id: req.id,
        ok: false,
        error: { message: 'synthetic failure', code: 'E_SPIKE' },
      });
      break;
    default:
      writeFrame({
        kind: 'res',
        id: req.id,
        ok: false,
        error: { message: `unknown op: ${req.op}`, code: 'E_UNKNOWN_OP' },
      });
  }
}

// Unsolicited event, to prove PortEvent survives the same framing unprompted.
setTimeout(() => {
  writeFrame({ kind: 'evt', topic: 'engine:ready', payload: { pid: process.pid } });
}, 50);

process.on('SIGTERM', () => process.exit(0));
