import { mock } from 'bun:test';
import { createFakeSocket, type FakeSocket } from './fakeSocket';

// The one and only mock.module registration for '/wails/runtime.js' across the whole tests/unit
// run — P57 M1's counterpart to window.ts's window.kira stub, and for the same reason: Bun's
// module registry is shared across every spec file in a single run, so two different mock.module
// calls for the same specifier race for whichever wins (window.ts's own comment documents the
// window.kira version of this, found the hard way in P43 iteration 3). Every spec whose import
// chain reaches bridge/port.ts — directly, or via data.ts / workbench/state/engine.ts — needs
// this to resolve, not only specs that test the transport itself.
//
// This is a mock.module call, not a tsconfig "paths" redirect, deliberately: a "paths" entry for
// this exact specifier — tried first — makes Bun's own module resolver hijack it before
// mock.module ever gets a chance, in every file that transitively reaches it, not only the one
// declaring the mapping (confirmed by experiment: pointing "paths" at this very file, a real and
// otherwise-loadable module, still produced "Cannot find module" from bridge/port.ts). Since
// TypeScript also forbids an ambient `declare module` for a path-like specifier ("Ambient module
// declaration cannot specify relative module name"), port.ts's own import carries a `@ts-expect-error`
// instead — see its comment.
//
// Most specs never touch the fake socket at all: they override `data`'s or `control`'s own
// methods above the transport (view-state.spec.ts's `(data as any).read = ...`), so the default
// factory below only has to construct without throwing. bridge-port.spec.ts is the one spec that
// drives the transport directly; it calls `setSocketFactory` before its own dynamic
// `import('.../bridge/port')` to swap in a fake it can open/close/message from the test body.
// port.ts's `const socket = JSONStream('engine')` runs once, ever, for the whole test process
// (module caching) — whichever factory is installed at that moment is what every spec's cached
// copy of port.ts holds afterwards, which is harmless for every spec except bridge-port.spec.ts,
// the one spec that actually exercises it.
let factory: (name: string) => FakeSocket = () => createFakeSocket();

export function setSocketFactory(f: (name: string) => FakeSocket): void {
  factory = f;
}

export function JSONStream(name: string): FakeSocket {
  return factory(name);
}

mock.module('/wails/runtime.js', () => ({ JSONStream }));
