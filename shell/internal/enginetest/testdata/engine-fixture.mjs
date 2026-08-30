// The one shared tagged-protocol engine fixture for P55's connections/tree/oplog Go tests
// (D13), speaking the same `| length uint32 BE | tag uint8 | body |` framing as
// shell/internal/enginehost/frame.go and src/engine/stdio-main.ts. Successor, for this phase, to
// P54's own shell/internal/enginehost/testdata/engine-ping.mjs (left exactly as it is — this
// fixture speaks the real adapter ops that phase never needed).
//
// ops (see docs/v1/plans/P55-go-application-services.md §4's fixture table):
//   adapter:connect     -> {serverVersion, caps}; config.name 'fail-*' -> ok:false E_CONNECT;
//                          'slow-*' -> never answers until released (fixture:release-slow, a
//                          test-only escape hatch this plan's "slow-then-released" dedupe test
//                          needs — a real 20s adapter:connect timeout would make that test slow)
//   adapter:disconnect  -> {}
//   adapter:test        -> {ok:true, serverVersion}; 'fail-*' -> {ok:false, error}
//   adapter:children    -> {nodes:[...]} from payload.path.segments; last segment 'trunc-*' ->
//                          {nodes, truncated:true}
//   adapter:describe    -> {meta:{...}} echoing the path; last segment 'badkind-*' -> kind:'nonsense'
//   adapter:definition  -> {definition:{...}}; last segment 'nostmt-*' -> statements:[]
//   adapter:cancel, cache:configure -> {}
//   fixture:release-slow      -> answers every pending slow adapter:connect, then {}
//   fixture:emit-op-start     -> payload:{...} emitted verbatim as a tag-0 op:start event, then {}
//   fixture:emit-op-end       -> payload:{...} emitted verbatim as a tag-0 op:end event, then {}
//   fixture:request-count     -> payload:{op} -> {count}: how many times `op` has been received
//   fixture:last-connect-config -> {config}: the most recent adapter:connect payload.config
//                                   verbatim (null before the first one) — lets a Go test observe
//                                   what resolve() actually sent (e.g. the re-injected URI
//                                   password), which no adapter:connect response otherwise echoes
//   fixture:crash             -> process.exit(3) without answering
//   (data channel, tag 1)     -> fixture:echo-data (P56 D13): any frame arriving on the data tag
//                                is echoed back on the data tag verbatim, no JSON involved — lets
//                                a Go test prove frame passthrough integrity and tag-based demux
//                                for internal/bridge's engine Stream

let buf = Buffer.alloc(0);
const pendingSlow = [];
const reqCounts = {};
let lastConnectConfig = null;

const fixtureCaps = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  keyBrowser: false,
  defaultPageKind: 'tabular',
  sql: true,
  definition: true,
  describe: true,
  projection: true,
  serverFilter: true,
  exactCount: true,
  pagination: 'keyset',
  foreignKeys: true,
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: true,
  cancel: true,
  fileTransfer: false,
};

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
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(5);
  header.writeUInt32BE(body.length, 0);
  header.writeUInt8(tag, 4);
  process.stdout.write(Buffer.concat([header, body]));
}

function writeRaw(tag, body) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(body.length, 0);
  header.writeUInt8(tag, 4);
  process.stdout.write(Buffer.concat([header, body]));
}

function ok(tag, id, payload) {
  writeFrame(tag, { kind: 'res', id, ok: true, payload });
}

function fail(tag, id, code, message) {
  writeFrame(tag, { kind: 'res', id, ok: false, error: { code, message } });
}

function encodePath(segments) {
  return segments.map((s) => `${s.kind}:${encodeURIComponent(s.name)}`).join('/');
}

function lastSegment(segments) {
  return segments.length > 0 ? segments[segments.length - 1] : { kind: 'table', name: 'unknown' };
}

function handleFrame(tag, frame) {
  // fixture:echo-data (D13): a data-tagged frame carries no JSON envelope at all — it is
  // whatever bytes the renderer's stream sent, exactly as SendData writes them
  // (enginehost/stream.go). Echo it back verbatim on the same tag, never through JSON.
  if (tag === 1) {
    writeRaw(1, frame);
    return;
  }

  let req;
  try {
    req = JSON.parse(frame.toString('utf8'));
  } catch {
    return;
  }
  if (req.kind !== 'req') return;
  reqCounts[req.op] = (reqCounts[req.op] ?? 0) + 1;

  switch (req.op) {
    case 'adapter:connect': {
      const { config } = req.payload;
      lastConnectConfig = config;
      if (config.name.startsWith('fail-')) {
        fail(tag, req.id, 'E_CONNECT', 'synthetic connect failure');
        return;
      }
      if (config.name.startsWith('slow-')) {
        pendingSlow.push({ tag, id: req.id });
        return;
      }
      ok(tag, req.id, { serverVersion: 'fixture 1.0', caps: fixtureCaps });
      return;
    }
    case 'adapter:disconnect':
      ok(tag, req.id, {});
      return;
    case 'adapter:test': {
      const { config } = req.payload;
      if (config.name.startsWith('fail-')) {
        ok(tag, req.id, { ok: false, error: 'synthetic test failure' });
        return;
      }
      ok(tag, req.id, { ok: true, serverVersion: 'fixture 1.0' });
      return;
    }
    case 'adapter:children': {
      const segments = req.payload.path.segments ?? [];
      const last = lastSegment(segments);
      const child = {
        kind: 'table',
        name: 'orders',
        path: encodePath([...segments, { kind: 'table', name: 'orders' }]),
        hasChildren: false,
      };
      if (last.name.startsWith('trunc-')) {
        ok(tag, req.id, { nodes: [child], truncated: true });
        return;
      }
      ok(tag, req.id, { nodes: [child] });
      return;
    }
    case 'adapter:describe': {
      const segments = req.payload.path.segments ?? [];
      const last = lastSegment(segments);
      ok(tag, req.id, {
        meta: {
          path: encodePath(segments),
          kind: last.name.startsWith('badkind-') ? 'nonsense' : last.kind,
          name: last.name,
          qualifiedName: last.name,
          columns: [],
          primaryKey: null,
          foreignKeys: [],
          referencedBy: [],
          indexes: [],
          rowEstimate: null,
          comment: null,
        },
      });
      return;
    }
    case 'adapter:definition': {
      const segments = req.payload.path.segments ?? [];
      const last = lastSegment(segments);
      const nostmt = last.name.startsWith('nostmt-');
      ok(tag, req.id, {
        definition: {
          path: encodePath(segments),
          kind: last.kind,
          qualifiedName: last.name,
          language: 'sql',
          statements: nostmt ? [] : [`CREATE TABLE ${last.name} (id int)`],
          origin: 'server',
          notes: [],
          constraints: [],
          documentSchema: null,
          sections: [],
          generatedAt: new Date().toISOString(),
        },
      });
      return;
    }
    case 'adapter:cancel':
      ok(tag, req.id, {});
      return;
    case 'cache:configure':
      ok(tag, req.id, {});
      return;
    case 'fixture:release-slow':
      for (const p of pendingSlow.splice(0)) {
        ok(p.tag, p.id, { serverVersion: 'fixture 1.0', caps: fixtureCaps });
      }
      ok(tag, req.id, {});
      return;
    case 'fixture:emit-op-start':
      writeFrame(0, { kind: 'evt', topic: 'op:start', payload: req.payload });
      ok(tag, req.id, {});
      return;
    case 'fixture:emit-op-end':
      writeFrame(0, { kind: 'evt', topic: 'op:end', payload: req.payload });
      ok(tag, req.id, {});
      return;
    case 'fixture:request-count':
      ok(tag, req.id, { count: reqCounts[req.payload.op] ?? 0 });
      return;
    case 'fixture:last-connect-config':
      ok(tag, req.id, { config: lastConnectConfig });
      return;
    case 'fixture:crash':
      process.exit(3);
      return;
    default:
      fail(tag, req.id, 'E_UNKNOWN_OP', `unknown op: ${req.op}`);
  }
}

process.on('SIGTERM', () => process.exit(0));
