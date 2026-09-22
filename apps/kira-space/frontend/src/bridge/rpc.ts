// bridge/rpc.ts — Kira Studio's own bound-call primitives (bridge/rpc.ts), ported verbatim. This
// app has no second protocol to compose (no apiControl.ts equivalent — bridge/index.ts here is a
// single flat surface), so the split this file's Studio counterpart documents no longer matters,
// but the primitives themselves are still exactly what every bound call here needs.

// See bridge/port.ts's identical import in Kira Studio for why this needs the directive below
// rather than the require-an-error kind (P57 M1/M2 finding: a tsconfig "paths" entry for this
// exact specifier breaks Bun's mock.module interception). This app has no bridge/port.ts of its
// own (no data-engine streaming protocol), but the same hazard applies to this file's own import.
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see comment above)
// @ts-ignore
import { Events } from '/wails/runtime.js';
import { windowKey as windowKeyValue } from '../state/window';

// P57 D5. Wails delivers a bound method's error as a RuntimeError whose .message is
// ipcerr.Error's own JSON encoding and whose .cause is that same {code, message} as an object
// (apps/kira-space/internal/bridge's ipcerr package + Wails' bindings.go/transport_http.go).
// Unwrapped once, here, so every consumer keeps reading `err.message` for display and `err.code`
// for branching. `details` — ipcerr.Error's own optional `json.RawMessage` field — is carried
// through the same way, parsed once here rather than pushed onto every consumer.
export function unwrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    const e = err as { message?: string; cause?: unknown };
    const cause = e.cause as { code?: unknown; message?: unknown; details?: unknown } | undefined;
    let code = 'E_INTERNAL';
    let message = e.message ?? String(err);
    let details: unknown;
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
      code = cause.code;
      message = typeof cause.message === 'string' ? cause.message : message;
      details = cause.details;
    } else {
      // Belt and braces: a Wails change that stops populating `cause` still leaves the same JSON
      // in `.message`, because ipcerr.Error.Error() is what CallError.Message is built from.
      try {
        const parsed = JSON.parse(message) as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
        };
        if (typeof parsed.code === 'string') {
          code = parsed.code;
          if (typeof parsed.message === 'string') message = parsed.message;
          details = parsed.details;
        }
      } catch {
        // not our JSON — E_INTERNAL with the raw text is the right answer
      }
    }
    const out: Error & { code?: string; details?: unknown } = new Error(message);
    out.code = code;
    out.details = details;
    throw out;
  });
}

export function on<T>(name: string, cb: (payload: T) => void): () => void {
  return Events.On(name, (ev: { data: T }) => cb(ev.data));
}

// The generated bindings type array-returning methods as `T[] | null` (a Go nil slice marshals to
// `null`) — `r ?? []` at each call site keeps its own return type plain arrays, never null.
//
// The generated bindings also type every Go enum-like field as plain `string`, since Go's own
// enum-like types don't carry a literal-union guarantee across the wire the way a Zod schema
// does. The Go value is always one of the valid members, so `trust` is a deliberate, documented
// widen-then-narrow, not a silent bypass of a real check.
export function trust<T>(v: unknown): T {
  return v as T;
}

export const windowKey = windowKeyValue;
