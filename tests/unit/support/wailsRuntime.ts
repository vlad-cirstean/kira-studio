import { mock } from 'bun:test';
import { createFakeSocket, type FakeSocket } from './fakeSocket';

// The one and only mock.module registration for '/wails/runtime.js' across the whole tests/unit
// run — P57's counterpart to window.ts's window.kira stub, and for the same reason: Bun's module
// registry is shared across every spec file in a single run, so two different mock.module calls
// for the same specifier race for whichever wins (window.ts's own comment documents the
// window.kira version of this, found the hard way in P43 iteration 3). Every spec whose import
// chain reaches bridge/port.ts or bridge/control.ts — directly, or via data.ts /
// workbench/state/engine.ts — needs this to resolve, not only specs that test the transport
// itself: control.ts's own top-level imports pull in every generated service binding (each of
// which imports `Call` from this same specifier) the moment control.ts is loaded at all.
//
// This is a mock.module call, not a tsconfig "paths" redirect, deliberately: a "paths" entry for
// this exact specifier — tried first — makes Bun's own module resolver hijack it before
// mock.module ever gets a chance, in every file that transitively reaches it, not only the one
// declaring the mapping (confirmed by experiment: pointing "paths" at this very file, a real and
// otherwise-loadable module, still produced "Cannot find module" from bridge/port.ts). Since
// TypeScript also forbids an ambient `declare module` for a path-like specifier ("Ambient module
// declaration cannot specify relative module name"), so port.ts's and control.ts's own imports
// each carry a suppression directive instead — see their comments.
//
// Most specs never touch any of this: they override `data`'s or `control`'s own methods above
// the transport (view-state.spec.ts's `(data as any).read = ...`), so `Call`/`Events` only need
// to exist as real named exports, never actually get invoked, and don't need to do anything
// useful. bridge-port.spec.ts is the one spec that drives the JSONStream transport directly; it
// calls `setSocketFactory` before its own dynamic `import('.../bridge/port')` to swap in a fake
// it can open/close/message from the test body. port.ts's `const socket = JSONStream('engine')`
// runs once, ever, for the whole test process (module caching) — whichever factory is installed
// at that moment is what every spec's cached copy of port.ts holds afterwards, which is harmless
// for every spec except bridge-port.spec.ts, the one spec that actually exercises it.
let factory: (name: string) => FakeSocket = () => createFakeSocket();

export function setSocketFactory(f: (name: string) => FakeSocket): void {
  factory = f;
}

export function JSONStream(name: string): FakeSocket {
  return factory(name);
}

// Deliberately never settles, rather than rejecting: state/tabs.ts's own module-scope code fires
// a `void control.tabsSave(...)` on tab mutation with no `.catch`, and other state modules have
// similar fire-and-forget calls no spec here is testing — a rejection would surface as an
// unhandled promise rejection attributed to whatever spec happened to be running, even though
// every spec that actually cares about a bound call's result overrides `control`'s or `data`'s
// own method first (view-state.spec.ts's `(control as any).treeChildren = ...`). A call the test
// genuinely awaits without overriding would hang, which is the correct, loud failure mode instead.
function notImplemented(_what: string): Promise<never> {
  return new Promise(() => {});
}

let callFactory: () => Promise<unknown> = () => notImplemented('Call');

// bridge-unwrap.spec.ts is the one spec that drives a real bound call end to end (to prove every
// control.ts method really does run its result through `unwrap`); it calls this before importing
// control.ts and `resetCallFactory()` afterwards, so a later spec's own fire-and-forget calls
// (state/tabs.ts's `void control.tabsSave(...)`) go back to hanging harmlessly instead of
// rejecting into an unrelated spec.
export function setCallFactory(f: () => Promise<unknown>): void {
  callFactory = f;
}
export function resetCallFactory(): void {
  callFactory = () => notImplemented('Call');
}

// The generated bindings do `import { Call as $Call } from '/wails/runtime.js'` then call
// `$Call.ByName(...)` — the real bundled runtime attaches ByName/ByID onto the Call function
// object itself, so the stub mirrors that shape rather than exporting them as siblings.
function Call(): Promise<unknown> {
  return callFactory();
}
Call.ByName = (): Promise<unknown> => callFactory();
Call.ByID = (): Promise<unknown> => callFactory();

const Events = {
  On: (): (() => void) => () => {},
};

mock.module('/wails/runtime.js', () => ({ JSONStream, Call, Events }));
