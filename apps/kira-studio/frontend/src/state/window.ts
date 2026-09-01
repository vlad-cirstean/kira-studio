// windowKey identifies which workbench this page is (P8 D2): the shell mints a UUID per window
// and hands it over as `/?window=<key>`, since it must be readable synchronously at module load —
// before hydrateTabs() ever runs — and an async round trip (Window.Name() from
// `@wailsio/runtime`) can't give that guarantee (it isn't even reliable across build modes; see
// docs/v1.1/plans/P8-multi-window-correctness.md D2).
//
// Absent or unrecognised falls back to "main": tests/ui (a plain static file server, no
// `?window=`) and tests/e2e-real's plain Chromium tab both see this fallback and keep working
// unchanged with a single implicit workbench — as does tests/unit's plain `bun test` process,
// which has no `location` global at all (no DOM, no webview): control.ts imports this module at
// its own top level, so a hard `location.search` reference here would throw during module
// evaluation and poison every other spec that imports control transitively (its shared module
// registry, per tests/unit/support/wailsRuntime.ts's own comment on that exact hazard).
export const windowKey =
  typeof location === 'undefined'
    ? 'main'
    : (new URLSearchParams(location.search).get('window') ?? 'main');
