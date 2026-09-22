// windowKey identifies which workbench this page is (P8 D2, Kira Studio's own mechanism, ported
// verbatim): the shell mints a UUID per window and hands it over as `/?window=<key>`, since it
// must be readable synchronously at module load — before hydrateTabs() ever runs — and an async
// round trip (Window.Name() from `@wailsio/runtime`) can't give that guarantee.
//
// Absent or unrecognised falls back to "main": tests/ui (a plain static file server, no
// `?window=`) and tests/unit (no `location` global at all — no DOM, no webview) both see this
// fallback and keep working unchanged with a single implicit workbench.
export const windowKey =
  typeof location === 'undefined'
    ? 'main'
    : (new URLSearchParams(location.search).get('window') ?? 'main');
