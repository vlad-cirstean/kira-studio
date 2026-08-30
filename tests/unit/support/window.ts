import './wailsRuntime';

// A shared globalThis.window stub for every tests/unit spec that needs one, imported for its
// side effect (`import './support/window'`) rather than declared inline per spec.
//
// bridge/control.ts reads window.kira at module scope, and state/tabs.ts then *calls*
// control.onFlushBeforeClose(...) at that same module scope — an empty `{ kira: {} }` throws on
// import (`kira.onFlushBeforeClose is not a function`). Every window.kira.* property here answers
// with a no-op subscriber instead; no spec that imports this module asserts anything that reads it.
//
// One shared stub, not one per spec: Bun's module registry is shared across every spec file in a
// single test run, so bridge/control.ts's module-scope `const kira = window.kira` freezes around
// whichever stub loaded first — two different inline stubs across two spec files raced and broke
// whichever spec's stub lost (found while moving P43 iteration 3's tests/db/ specs into
// tests/unit/: run-state.spec.ts's bare `{ kira: {} }` stub, loading alphabetically before
// view-state.spec.ts's Proxy-based one, froze the wrong one in for the whole run).
(globalThis as { window?: unknown }).window = {
  kira: new Proxy(
    {},
    {
      get: () => () => () => {},
    },
  ),
  addEventListener: () => {},
};

// bridge/port.ts (P57) calls JSONStream('engine') at its own module scope, and data.ts and
// workbench/state/engine.ts both import port.ts — so any spec whose chain reaches either now
// needs '/wails/runtime.js' to resolve under Bun. The './wailsRuntime' import above registers the
// one shared mock.module for that specifier; see its own comment for why it has to be the only
// registration in the whole run.
