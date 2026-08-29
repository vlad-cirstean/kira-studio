// P52 M1's walking-skeleton engine child (§3.2). Deliberately does NOT load src/engine — that
// would measure registry.ts's lazy loading, which P51 §2.2 already measured at ~119 MB and which
// is unchanged by this migration. This answers "ping" and "cache:configure"
// (ENGINE_OP.configureCache — P54's startup PushCacheConfig push), over the same tagged
// length-prefixed framing shell/internal/enginehost/frame.go and src/engine/stdio-main.ts use
// (P54 §3): | length uint32 BE | tag uint8 | body |. Every response echoes back on the tag it
// arrived on.

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
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
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(5);
  header.writeUInt32BE(json.length, 0);
  header.writeUInt8(tag, 4);
  process.stdout.write(Buffer.concat([header, json]));
}

function handleFrame(tag, frame) {
  let req;
  try {
    req = JSON.parse(frame.toString('utf8'));
  } catch {
    return;
  }
  if (req.kind !== 'req') return;

  if (req.op === 'ping') {
    writeFrame(tag, {
      kind: 'res',
      id: req.id,
      ok: true,
      payload: { pong: true, enginePid: process.pid, at: Date.now() },
    });
    return;
  }

  if (req.op === 'cache:configure') {
    writeFrame(tag, { kind: 'res', id: req.id, ok: true, payload: {} });
    return;
  }

  writeFrame(tag, {
    kind: 'res',
    id: req.id,
    ok: false,
    error: { message: `unknown op: ${req.op}`, code: 'E_UNKNOWN_OP' },
  });
}

process.on('SIGTERM', () => process.exit(0));
