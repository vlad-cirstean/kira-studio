// The browser-side half of tests/ui/support/mockStream.ts's window._wails.streamFactory install
// (P57 D14) — a plain, uncompiled JS file, read as raw text by mockStream.ts and injected via
// `page.addInitScript(text)` rather than `page.addInitScript(fn, arg)`.
//
// P57 finding: passing a function (the natural, typed way) does not work here. Both esbuild-based
// TS loaders this repo's tooling can run under (tsx locally, Playwright's own internal transform)
// compile named functions and object methods under `keepNames`, appending a call like
// `__name(fn, "fn")` after every one of them — a helper defined once at the top of the *whole
// compiled file*, a scope `Function.prototype.toString()` never captures, since `addInitScript`
// serialises only that one function's own source. A same-named local shim does not shadow it
// either: esbuild treats `__name` as a reserved symbol it owns and renames any user declaration
// that collides with it, so the *injected call sites* still reference the (undefined, in the
// extracted text) outer helper regardless. A plain-JS file that is never fed through that
// compiler at all — read with `fs.readFileSync`, not `import` — has no such call sites to begin
// with. `tests/ipc/support/mockPort.ts`'s own `page.evaluate` closures document the same
// self-containment constraint one degree less severely (they run inline, string-injection is a
// TypeScript file's *own* problem, not theirs, since `page.evaluate(fn, arg)` in that file never
// hit this).
//
// Wrapped in `(function (snaps) { ... })` by mockStream.ts, which appends the fixture array as a
// JSON-stringified call argument — everything below is that one function's body.
(snaps) => {
  var CONNECTING = 0;
  var OPEN = 1;
  var CLOSED = 3;

  // Mirrors @wailsio/runtime's stream.js own `defineHandlerProperty`, and
  // tests/unit/support/fakeSocket.ts's copy of it — kept in sync by hand across the three (real
  // runtime, unit fake, this one) rather than shared, since none of the three may import from
  // another.
  function defineHandlerProperty(target, type) {
    var current = null;
    Object.defineProperty(target, `on${type}`, {
      get: () => current,
      set: (fn) => {
        if (current) target.removeEventListener(type, current);
        current = typeof fn === 'function' ? fn : null;
        if (current) target.addEventListener(type, current);
      },
      configurable: true,
      enumerable: true,
    });
  }

  function createMockStreamSocket() {
    var socket = Object.assign(new EventTarget(), {
      readyState: CONNECTING,
      send: (value) => {
        onSend(String(value));
      },
      close: () => {
        socket.readyState = CLOSED;
        socket.dispatchEvent(new Event('close'));
      },
    });
    ['open', 'message', 'close', 'error'].forEach((type) => {
      defineHandlerProperty(socket, type);
    });
    return socket;
  }

  function encodeChunk(values) {
    var i, j;
    var encoder = new TextEncoder();
    var encoded = values.map((v) => (v === null ? new Uint8Array(0) : encoder.encode(v)));
    var total = 0;
    for (i = 0; i < encoded.length; i++) total += encoded[i].length;
    var data = new Uint8Array(total);
    var offsets = new Uint32Array(values.length + 1);
    var nulls = new Uint8Array(Math.ceil(values.length / 8));
    var cursor = 0;
    for (j = 0; j < values.length; j++) {
      data.set(encoded[j], cursor);
      cursor += encoded[j].length;
      offsets[j + 1] = cursor;
      if (values[j] === null) nulls[j >> 3] |= 1 << (j & 7);
    }
    return { data: data, offsets: offsets, nulls: nulls, truncated: new Uint32Array(0) };
  }

  function buildPage(logical) {
    var base = { position: logical.position, byteSize: 0, fetchedAt: Date.now() };
    if (logical.kind === 'tabular') {
      return Object.assign({}, base, {
        kind: 'tabular',
        columns: logical.columns,
        rowCount: logical.rows.length,
        truncatedCells: logical.truncatedCells,
        chunks: logical.columns.map((_col, c) => encodeChunk(logical.rows.map((r) => r[c]))),
      });
    }
    if (logical.kind === 'document') {
      return Object.assign({}, base, {
        kind: 'document',
        rowCount: logical.ids.length,
        ids: encodeChunk(logical.ids),
        bodies: encodeChunk(logical.bodies),
      });
    }
    if (logical.kind === 'keyvalue') {
      return Object.assign({}, base, {
        kind: 'keyvalue',
        redisType: logical.redisType,
        ttlMs: logical.ttlMs,
        memoryBytes: logical.memoryBytes,
        rowCount: logical.fields.length,
        fields: encodeChunk(logical.fields),
        values: encodeChunk(logical.values),
      });
    }
    return Object.assign({}, base, {
      kind: 'stream',
      rowCount: logical.keys.length,
      visibilityTimeoutSeconds: logical.visibilityTimeoutSeconds,
      keys: encodeChunk(logical.keys),
      headers: encodeChunk(logical.headers),
      attrs: encodeChunk(logical.attrs),
      timestamps: encodeChunk(logical.timestamps),
      bodies: encodeChunk(logical.bodies),
    });
  }

  function buildResponsePayload(response) {
    if (response.kind === 'read')
      return { page: buildPage(response.page), source: response.source };
    if (response.kind === 'count') {
      return {
        value: response.value,
        exact: response.exact,
        at: Date.now(),
        stale: response.stale,
        source: response.source,
      };
    }
    if (response.kind === 'mutate') return { affectedRows: response.affectedRows };
    if (response.kind === 'preview') return { statements: response.statements };
    if (response.kind === 'execute') return { pages: response.pages.map(buildPage) };
    return {};
  }

  // opId/tabId are renderer-generated per request and must not gate the match — mirrors
  // mockPort.ts's own matchKey exactly.
  function matchKey(op, payload) {
    var rest;
    if (payload && typeof payload === 'object') {
      rest = Object.assign({}, payload);
      delete rest.opId;
      delete rest.tabId;
      return `${op}:${JSON.stringify(rest)}`;
    }
    return `${op}:${JSON.stringify(payload)}`;
  }

  var byKey = new Map();
  snaps.forEach((snap) => {
    var key = matchKey(snap.op, snap.payload);
    var group = byKey.get(key) || [];
    group.push(snap);
    byKey.set(key, group);
  });
  var cursors = new Map();
  var seen = [];
  var socket;

  function onSend(raw) {
    var req = JSON.parse(raw);
    seen.push({ op: req.op, payload: req.payload });
    // 'ping' (workbench/state/engine.ts's initEngineState) isn't a DATA_OP — it never appears in a
    // PortSnapshot fixture (types.ts's own doc comment: `op` is "a value from
    // shared/protocol/data-ops.ts's DATA_OP map") — so no spec's fixture array carries an entry
    // for it, and none needs to: every spec wants the engine pill to read 'ok', never asserts the
    // fake pid's actual value, so answering it unconditionally here removes one boilerplate line
    // from every single ported spec rather than adding a redundant fixture entry to each.
    if (req.op === 'ping') {
      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ kind: 'res', id: req.id, ok: true, payload: { enginePid: 1 } }),
        }),
      );
      return;
    }
    var key = matchKey(req.op, req.payload);
    var group = byKey.get(key);
    function respond(frame) {
      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
    }
    if (!group) {
      respond({
        kind: 'res',
        id: req.id,
        ok: false,
        error: { message: `no fixture snapshot for ${req.op}`, code: 'E_FIXTURE_MISS' },
      });
      return;
    }
    var at = cursors.get(key) || 0;
    cursors.set(key, at + 1);
    var snap = group[Math.min(at, group.length - 1)];
    function reply() {
      if (snap.error) {
        respond({ kind: 'res', id: req.id, ok: false, error: snap.error });
        return;
      }
      respond({ kind: 'res', id: req.id, ok: true, payload: buildResponsePayload(snap.response) });
    }
    // Frontend-only (types.ts's PortSnapshot.delayMs) — see mockPort.ts's own comment.
    if (snap.delayMs) setTimeout(reply, snap.delayMs);
    else reply();
  }

  var g = globalThis;
  g._wails = g._wails || {};
  g._wails.streamFactory = () => {
    socket = createMockStreamSocket();
    // A real Stream() returns synchronously CONNECTING and opens asynchronously; queuing this on a
    // microtask (rather than opening synchronously before the caller's `onopen` assignment even
    // runs) matches that and exercises port.ts's own CONNECTING-gated send path (P57 D3), not a
    // shortcut around it.
    queueMicrotask(() => {
      socket.readyState = OPEN;
      socket.dispatchEvent(new Event('open'));
    });
    return socket;
  };
  g.__kiraStreamSeen = seen;
};
