/**
 * G-UX D3 (item 3): real per-language file icons for `FileTree.vue`, replacing the codicon set's
 * one shared `codicon-file-code` glyph for every source language (F4's own survey — `.ts`, `.go`,
 * `.vue`, `.rs`, `.py`, `.css`, `.html` all land on that one icon today, since codicons has no
 * finer distinction). `seti-icons` (MIT) repackages jesseweed/seti-ui verbatim as plain JSON data
 * — the only surveyed option that ships both an icon body table AND a machine-readable
 * filename/extension/partial -> [icon, color] mapping as tracked npm content, no vendored binary,
 * no LESS-parsing build step (`NOTICES.md` credits both `seti-icons` and its upstream `seti-ui`).
 *
 * Palette: `seti-ui@1.11.0`'s own `styles/ui-variables.less` — the same hexes `vs-seti` uses as
 * `fontColor`. `white` (seti's default/unknown icon) is deliberately NOT `#d4d7d6`: that is
 * invisible on a light VS Code theme. It resolves to the host's own muted foreground instead, so
 * the fallback icon follows the user's theme exactly as every other muted glyph in this panel
 * already does. `ignore` is `#41535b` — VS Code's own real `vs-seti-icon-theme.json` value for its
 * ignored/git/npm-ignored icon set (P7, fetched and confirmed directly against microsoft/vscode;
 * this file previously guessed `#6d8086`/`grey-light`, since `seti-ui@1.11.0`'s own
 * `ui-variables.less` has no `ignore` entry of its own to copy).
 */
import { themeIcons } from 'seti-icons';

const themed = themeIcons({
  blue: '#519aba',
  green: '#8dc149',
  orange: '#e37933',
  pink: '#f55385',
  purple: '#a074c4',
  red: '#cc3e44',
  yellow: '#cbcb41',
  grey: '#4d5a5e',
  'grey-light': '#6d8086',
  ignore: '#41535b',
  white: 'var(--kv-description-fg)',
});

export interface SetiFileIcon {
  /** A `mask-image`/`-webkit-mask-image`-ready `url("data:image/svg+xml,...")` string — a CSS
   *  mask, not inline SVG/`v-html`, so `FileTree.vue`'s existing `background-color`-driven theming
   *  keeps working unchanged (a `<img>`/inline SVG would bake `color` into the asset instead). */
  readonly maskUrl: string;
  readonly color: string;
}

/** One data URL per distinct icon SVG, built at most once per session — a session realistically
 *  touches ~10-20 distinct icons, which is the direct answer to the package's own README caveat
 *  ("in a webapp ... better to use an SVG spritesheet [than 100K of inlined SVG strings]"): this
 *  never builds more than a couple dozen URLs regardless of how many files are shown. Keyed by the
 *  SVG body itself, not the filename, since several filenames/extensions resolve to the identical
 *  icon. */
const maskUrlCache = new Map<string, string>();

function maskUrlFor(svg: string): string {
  const cached = maskUrlCache.get(svg);
  if (cached !== undefined) return cached;
  // `seti-icons`' shipped `icons.json` strings have no `xmlns` — harmless for `<img>`/inline SVG,
  // but a CSS `mask-image` data URL without it renders as fully transparent in Chromium (no error,
  // no console warning). Inject the namespace onto the root `<svg ...>` tag before building the URL.
  const namespaced = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  const url = `url("data:image/svg+xml,${encodeURIComponent(namespaced)}")`;
  maskUrlCache.set(svg, url);
  return url;
}

/** G-UX (item 10): `seti-icons`' own bundled data (last published years ago) has no `files` entry
 *  for these — its own `getDetails` (`lib/index.js`) checks `files` (exact name), then walks
 *  `fileName.slice(fileName.indexOf('.'))` outward through `extensions` (so `go.mod` is tried as
 *  `.mod`, `.mod`.slice(1) etc — never `.go`, since `.go` is not a SUFFIX of `go.mod`), then
 *  `partials` (a plain substring match, and nothing in that table matches "go" either) — every one
 *  of them misses, so `go.mod`/`go.sum`/`go.work`/`go.work.sum` fall all the way through to the
 *  generic default icon despite being at least as common in a real diff as `.go` source itself.
 *  Real VS Code's own current Seti icon theme (synced far more recently than this npm package)
 *  does show the gopher for these. Routed through the same `themed()` lookup a real `.go` file
 *  uses — not a hand-copied icon key — so a future `seti-icons` update that adds its own entry for
 *  them is picked up automatically the moment this override is removed. */
const GO_TOOLING_FILENAMES = new Set(['go.mod', 'go.sum', 'go.work', 'go.work.sum']);
/** Any filename `seti-icons`' own extension-matching would resolve to the `.go` icon — used only
 *  to drive `GO_TOOLING_FILENAMES`' lookup through the real `themed()` call above. */
const GO_EXTENSION_LOOKUP_NAME = 'main.go';

/** P7 (item 3): a test/spec file keeps its language's ordinary glyph, colored orange instead of
 *  that language's ordinary color — VS Code's own real `vs-seti-icon-theme.json`
 *  (`iconDefinitions`: `_typescript_1`/`_react_1`/`_javascript_1` share their non-`_1` sibling's
 *  `fontCharacter` verbatim, only `fontColor` differs, always `#e37933`). `seti-icons@0.0.4`'s own
 *  bundled `definitions.json` is stale here for the TypeScript/TSX pair (still yellow) though
 *  already correct for the JS pair (already orange, so deliberately NOT listed below — adding an
 *  already-correct entry only risks drifting from the package's own value later); it also has no
 *  entry at all for `.cjs`/`.mjs` test/spec files, which VS Code does map. Matched against the
 *  lower-cased basename's suffix, the same longest-match-first shape `seti-icons`' own extension
 *  walk uses, so `foo.test.ts` matches `.test.ts` before any shorter `.ts` handling ever runs. */
const TEST_FILE_ORANGE = '#e37933';
const TEST_FILE_COLOR_OVERRIDES: readonly string[] = [
  '.test.ts',
  '.spec.ts',
  '.test.tsx',
  '.spec.tsx',
  '.test.cjs',
  '.spec.cjs',
  '.test.mjs',
  '.spec.mjs',
];

function testFileColorOverride(basename: string): string | undefined {
  const lower = basename.toLowerCase();
  return TEST_FILE_COLOR_OVERRIDES.some((suffix) => lower.endsWith(suffix))
    ? TEST_FILE_ORANGE
    : undefined;
}

/** `path` may be a full repo-relative path — `seti-icons`' own `getDetails` slices from
 *  `fileName.indexOf('.')`, so handing it a full path would poison extension matching against any
 *  dot elsewhere in the path (a dotted directory segment). The basename is taken here, once, so
 *  every caller can pass whatever it already has (`FileTree.vue`'s own `row.node.path`) without
 *  its own slicing. `.gitignore`-style dotfiles resolve correctly from a basename too. */
export function setiIconFor(path: string): SetiFileIcon {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const lookupName = GO_TOOLING_FILENAMES.has(basename) ? GO_EXTENSION_LOOKUP_NAME : basename;
  const { svg, color } = themed(lookupName);
  return { maskUrl: maskUrlFor(svg), color: testFileColorOverride(basename) ?? color };
}
