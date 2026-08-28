// P52 M1's walking-skeleton engine child (§3.2). Deliberately does NOT load src/engine — that
// would measure registry.ts's lazy loading, which P51 §2.2 already measured at ~119 MB and which
// is unchanged by this migration. This answers exactly one op, "ping", over the same
// length-prefixed framing src/shared/protocol/port.ts's PortRequest/PortResponse use, so the
// real Go<->Node transport (shell/internal/enginehost) is what gets measured, not a fake one.

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
  } catch {
    return;
  }
  if (req.kind !== 'req') return;

  if (req.op === 'ping') {
    writeFrame({
      kind: 'res',
      id: req.id,
      ok: true,
      payload: { pong: true, enginePid: process.pid, at: Date.now() },
    });
    return;
  }

  writeFrame({
    kind: 'res',
    id: req.id,
    ok: false,
    error: { message: `unknown op: ${req.op}`, code: 'E_UNKNOWN_OP' },
  });
}

process.on('SIGTERM', () => process.exit(0));
