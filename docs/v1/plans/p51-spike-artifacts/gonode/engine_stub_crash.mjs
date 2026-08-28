// Variant of engine_stub.mjs that exits mid-flight, to exercise the
// no-auto-respawn / E_ENGINE_DOWN policy (P51 §3.6) on the Go side.
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    if (buf.length < 4) return;
    const len = buf.readUInt32BE(0);
    if (buf.length < 4 + len) return;
    buf = buf.subarray(4 + len);
    // Never respond — simulate a crash mid-call, then actually exit.
    setTimeout(() => process.exit(1), 20);
  }
});
