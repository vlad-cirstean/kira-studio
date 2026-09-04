// The browser-side half of tests/ui/support/mockGitStream.ts's window._wails.streamFactory
// install — a plain, uncompiled JS file for the same reason mockStreamBrowser.js's own doc
// comment gives (esbuild's `keepNames` rewrite does not survive extraction into addInitScript's
// string form). Composes with mockStream.ts's own factory rather than replacing it: this app opens
// the 'engine' stream unconditionally at boot (bridge/port.ts's module scope) and the 'git' stream
// only once Git mode's own GitGraphView mounts, so both must answer from the one
// `_wails.streamFactory` Stream() actually calls — see this file's own tail for the composition.
//
// Wrapped in `(function (init) { ... })` by mockGitStream.ts, which appends
// `{requests, streams, events}` as a JSON-stringified call argument — everything below is that
// one function's body.
(init) => {
  var CONNECTING = 0;
  var OPEN = 1;
  var CLOSED = 3;

  // Duplicated from mockStreamBrowser.js verbatim (that file's own doc comment: none of the real
  // runtime / this mock / the unit fake may import from another).
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

  function createGitMockSocket() {
    var socket = Object.assign(new EventTarget(), {
      readyState: CONNECTING,
      binaryType: 'arraybuffer',
      send: (value) => onSend(String(value)),
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

  var CONTRACT_VERSION = 3;

  function sendFrame(socket, body) {
    var bytes = new TextEncoder().encode(JSON.stringify({ version: CONTRACT_VERSION, body }));
    socket.dispatchEvent(new MessageEvent('message', { data: bytes.buffer }));
  }

  function keyFor(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

  // Two tables, not one: a scripted entry that names `params` matches only that exact shape
  // (requestsByKey); one that omits `params` entirely matches any params for that method
  // (wildcardsByMethod) — "params omitted matches any params" (mockGitStream.ts's own doc
  // comment), which a single Map keyed on `keyFor(..., undefined)` cannot express, since the real
  // request's own params is never literally `undefined` on the wire (app.init sends `{}`, not
  // nothing).
  var requestsByKey = new Map();
  var wildcardsByMethod = new Map();
  function registerExact(entry) {
    var key = keyFor(entry.method, entry.params);
    var group = requestsByKey.get(key) || [];
    group.push(entry);
    requestsByKey.set(key, group);
  }
  function registerWildcard(entry) {
    var group = wildcardsByMethod.get(entry.method) || [];
    group.push(entry);
    wildcardsByMethod.set(entry.method, group);
  }
  (init.requests || []).forEach((entry) => {
    if (Object.hasOwn(entry, 'params')) registerExact(entry);
    else registerWildcard(entry);
  });
  var requestCursors = new Map();

  var streamsByMethod = new Map();
  (init.streams || []).forEach((entry) => {
    streamsByMethod.set(entry.method, entry);
  });

  var seen = [];
  var socket;

  function handleReq(frame) {
    var key = keyFor(frame.method, frame.params);
    var group = requestsByKey.get(key) || wildcardsByMethod.get(frame.method);
    if (!group) {
      sendFrame(socket, {
        t: 'res',
        id: frame.id,
        ok: false,
        error: { code: 'E_FIXTURE_MISS', message: `no scripted response for ${key}` },
      });
      return;
    }
    var at = requestCursors.get(key) || 0;
    requestCursors.set(key, at + 1);
    var entry = group[Math.min(at, group.length - 1)];
    if (entry.error) {
      sendFrame(socket, { t: 'res', id: frame.id, ok: false, error: entry.error });
    } else {
      sendFrame(socket, { t: 'res', id: frame.id, ok: true, result: entry.response });
    }
  }

  function handleOpen(frame) {
    var streamEntry = streamsByMethod.get(frame.method);
    if (streamEntry?.error) {
      sendFrame(socket, { t: 'end', id: frame.id, error: streamEntry.error });
    } else {
      sendFrame(socket, { t: 'end', id: frame.id });
    }
  }

  function onSend(raw) {
    var frame;
    try {
      frame = JSON.parse(raw).body;
    } catch {
      return; // a corrupt/non-JSON send is dropped, matching gitstream.go's own onmessage stance.
    }
    if (frame.t === 'req') {
      seen.push({ method: frame.method, params: frame.params });
      handleReq(frame);
      return;
    }
    if (frame.t === 'open') {
      seen.push({ method: frame.method, params: frame.params });
      handleOpen(frame);
      return;
    }
    // 'credit'/'cancel' need no response — this mock never emits a chunk to be credited for, and
    // a request/stream this small always finishes before a cancel could plausibly race it.
  }

  var g = globalThis;
  g.__kiraGitStreamSeen = seen;
  g.__kiraGitStreamOpened = false;

  var previousFactory = g._wails?.streamFactory;
  g._wails = g._wails || {};
  g._wails.streamFactory = (name) => {
    if (name !== 'git') {
      return previousFactory ? previousFactory(name) : undefined;
    }
    socket = createGitMockSocket();
    g.__kiraGitStreamOpened = true;
    queueMicrotask(() => {
      socket.readyState = OPEN;
      socket.dispatchEvent(new Event('open'));
      (init.events || []).forEach((ev) => {
        var fire = () => sendFrame(socket, { t: 'evt', method: ev.method, payload: ev.payload });
        if (ev.delayMs) setTimeout(fire, ev.delayMs);
        else fire();
      });
    });
    return socket;
  };
};
