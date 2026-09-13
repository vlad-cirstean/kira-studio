// bridge/rpc.ts — the four bound-call primitives every service surface (Studio's own, in
// bridge/index.ts, and the Api module's, in apiControl.ts) shares. Split out of what used to be
// control.ts (round-1 review finding 19): apiControl.ts imported these from control.ts, which
// itself imported and composed apiControl.ts back in — a cycle that worked today only because
// every use sat inside a method body rather than at module-body top level, and that structurally
// inverted the intended dependency direction (the Api half should be removable without the
// Studio half caring, not the other way around). Neither half imports the other any more: both
// depend only on this file, which depends on neither.

// See bridge/port.ts's identical import for why this needs the directive below rather than the
// require-an-error kind (P57 M1/M2 finding: a tsconfig "paths" entry for this exact specifier
// breaks Bun's mock.module interception).
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see comment above)
// @ts-ignore
import { Events } from '/wails/runtime.js';
import { windowKey as windowKeyValue } from '../state/window';

// P57 D5. Wails delivers a bound method's error as a RuntimeError whose .message is
// ipcerr.Error's own JSON encoding and whose .cause is that same {code, message} as an object
// (apps/kira-studio/internal/bridge's ipcerr package + Wails' bindings.go/transport_http.go). Unwrapped once,
// here, so every consumer keeps reading `err.message` for display and `err.code` for branching.
// P10 D15: `details` — ipcerr.Error's own optional `json.RawMessage` field — is carried through
// the same way, parsed once here rather than pushed onto every consumer; `undefined` for every
// existing producer, which leaves the field unset (`omitempty`).
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

// P12 D11: exported so apiControl.ts (the module's own 39-method binding surface) can share it
// rather than a second copy — every bound call, both protocols, goes through the same
// on/trust/unwrap/windowKey.
export function on<T>(name: string, cb: (payload: T) => void): () => void {
  return Events.On(name, (ev: { data: T }) => cb(ev.data));
}

// The generated bindings type array-returning methods as `T[] | null` (a Go nil slice marshals to
// `null`), even though every backing repo/service in this codebase builds an explicit `[]T{}` or
// `make([]T, 0, ...)` and never actually returns nil for these. Every `r ?? []` at each call site
// keeps its own return type exactly as it was pre-P57 (plain arrays, never null) rather than
// pushing that generator conservatism onto every caller.
//
// The generated bindings also type every Go enum-like field (ConnectionSummary.kind,
// ConnectionState.status, SecretStorageStatus.backend, TreeVisibility's hiddenKinds, SavedQuery's
// kind/body, OpRecord.kind, TabRecord.kind, TreeNode.kind, ObjectMeta/ObjectDefinition.kind…) as
// plain `string`, since Go's own enum-like types don't carry a literal-union guarantee across the
// wire the way a Zod schema does. The Go value is always one of the valid members — the same
// trust boundary window.kira's Electron IPC handlers implicitly had — so `trust` is a deliberate,
// documented widen-then-narrow, not a silent bypass of a real check.
export function trust<T>(v: unknown): T {
  return v as T;
}

export const windowKey = windowKeyValue;
