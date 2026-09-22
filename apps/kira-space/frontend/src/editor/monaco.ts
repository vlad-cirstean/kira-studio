// P60a §2.1/D2 (Kira Studio's own editor/monaco.ts): the engine-generic half of what
// `views/repo/monaco.ts` (C5/C6) built — `loadMonaco`/`MonacoModule`/the theme definition.
//
// P100 Part 2's own hard case, not named by the plan: this file, monacoEntry.ts, monacoTheme.ts
// and monarch/{decorators,mongo,redis}.ts are duplicated here from Kira Studio's own editor/,
// byte-for-byte, rather than imported — the two frontends are separate Vite apps with no shared
// package boundary between them (unlike packages/shared, which both actually resolve via a
// relative path to the same file on disk), so there is no way for apps/kira-space/frontend to
// import apps/kira-studio/frontend/src/editor/* at all. `views/repo/monaco.ts` (the repo-specific
// URI/model-cache layer, C5 §9.1/§9.3) re-exports from this local copy instead of Kira Studio's.
// Same "duplicate, don't hoist" call as the Go internal/terminal package (bridge/terminal.go's own
// doc comment) — see this phase's own result section.
export type MonacoModule = typeof import('./monacoEntry');

// D2 (from format.ts's own precedent): memoised so only the first editor surface in a session ever
// pays the import cost — a session that opens neither an editor nor a repo file never downloads
// this chunk at all.
let monacoModule: Promise<MonacoModule> | undefined;

// D7's own "one worker" guard: label 'editorWorkerService' gets the real worker (it backs
// IEditorWorkerService — the diff editor widget computes its diff there); anything else throws
// loudly at first use rather than silently shipping a second worker, in case a future import ever
// pulls a language service back in.
function wireWorker(mod: MonacoModule): void {
  self.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label === 'editorWorkerService') return new mod.EditorWorker();
      throw new Error(`kira: unexpected Monaco worker label ${label}`);
    },
  };
}

// §9.3: read once from getComputedStyle against tokens.css — this app has one fixed (dark) visual
// design with no light/dark toggle today (its own tokens.css literally maps each value to VS
// Code's own theme keys, e.g. "--kira-bg: #1f1f1f; /* editor.background */"), so `base: 'vs-dark'`
// is correct and there is only one theme to define.
export const KIRA_EDITOR_THEME = 'kira-editor';

// C6 dogfooding finding (§13.5's own live-verification pass, real WebKit — the engine the packaged
// app's WKWebView actually embeds, matching playwright.config.ts's own choice of `webkit` for
// UI-fidelity projects), **widened by a second P60a dogfooding finding**: WebKit's
// `getComputedStyle` canonicalises a custom property's own color value to whatever it considers
// its *shortest* serialization — a 3-digit hex shorthand for `--kira-fg: #cccccc` (C6's own
// finding, `#ccc`), but a bare CSS colour *keyword* when one exactly matches, e.g.
// `--kira-syntax-meta: #808080` comes back as the literal string `"gray"`. Monaco's `defineTheme`
// validates a token rule's `foreground` strictly as a hex string, throwing on either form
// ("Illegal value for token color: #ccc" / "... gray") and rejecting `loadMonaco()`'s own memoised
// promise *permanently* — every MonacoHost on the page is left showing its pending `<pre>` forever,
// no error surface at all (worse than C5's own described "missing worker" failure mode, since
// nothing here even logs past the one console error). Chromium does not canonicalise either way,
// which is why both forms went unnoticed until a real WebKit run.
//
// A canvas 2D context's own `fillStyle` setter/getter accepts the full CSS `<color>` grammar (any
// keyword, any hex length, `rgb()`/`hsl()`/...) and is spec-required to serialize an opaque colour
// back out as `#rrggbb` on read — a general normalizer that subsumes the narrower hex-shorthand-only
// fix this replaces, rather than special-casing named colours as a second regex.
let normalizeCanvasCtx: CanvasRenderingContext2D | null | undefined;

// D6 (P67c §3.2) — the alpha trap: a translucent token (`--kira-scrollbar: #79797966`, or a
// `color-mix(… transparent)` token like `--kira-search-match`) comes back from the canvas
// normalizer above as `rgba(r, g, b, a)`, never `#rrggbb`. `editor.defineTheme`'s `colors` values
// go through `Color.fromHex` (`StandaloneTheme.getColors()`, standaloneThemeService.js), which
// accepts only `#RGB`/`#RGBA`/`#RRGGBB`/`#RRGGBBAA` and returns *red* — not an error — on anything
// else. Re-encoding as 8-digit hex here, once, is what lets `defineKiraTheme` map a translucent
// `--kira-*` token at all without silently painting a widget bright red.
const RGBA_PATTERN = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/;
function rgbaToHex8(rgba: string): string | undefined {
  const match = RGBA_PATTERN.exec(rgba);
  if (!match) return undefined;
  const [, r, g, b, a] = match;
  const byte = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return `#${byte(Number(r))}${byte(Number(g))}${byte(Number(b))}${byte(Number(a) * 255)}`;
}

function normalizeColor(color: string): string {
  if (normalizeCanvasCtx === undefined) {
    normalizeCanvasCtx = document.createElement('canvas').getContext('2d');
  }
  if (!normalizeCanvasCtx) return color; // no canvas 2D support — pass through rather than throw
  normalizeCanvasCtx.fillStyle = '#000000'; // known-good reset, so an invalid `color` leaves this
  normalizeCanvasCtx.fillStyle = color;
  const normalized = normalizeCanvasCtx.fillStyle;
  return rgbaToHex8(normalized) ?? normalized;
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return normalizeColor(value || fallback);
}

// P60a §4.4/dogfooding: `fixedOverflowWidgets: true` alone does NOT reparent a hover/suggest
// widget to `document.body` — verified against the pinned 0.56.0's own `view.js` (`appendChild`
// under `this.domNode`, i.e. the editor's own root, whenever no `overflowWidgetsDomNode` is given).
// `position: fixed` still escapes an ancestor's `overflow: hidden` *visually*, but a widget stays a
// literal DOM descendant of `MonacoHost`'s own root — which the api-ui-consistency spec's own
// `el.closest('.request-pane') === null` (etc.) checks require to be false. One body-level
// container, shared by every `MonacoHost` instance (matching how VS Code itself wires this), is
// what actually reparents — created lazily, once, memoised the same way `loadMonaco()` is.
let overflowContainer: HTMLElement | undefined;

/** The one shared `overflowWidgetsDomNode` every `MonacoHost.vue` instance passes — every hover/
 *  suggest widget from every editor on the page ends up here, under `document.body`, regardless of
 *  which pane created it. */
export function overflowWidgetsContainer(): HTMLElement {
  if (!overflowContainer) {
    overflowContainer = document.createElement('div');
    // D5 (P67c §3.1): every `--vscode-*` custom property Monaco defines is scoped to
    // `.monaco-editor, .monaco-diff-editor, .monaco-component` (standaloneThemeService.js's own
    // `_registerRegularEditorContainer`) — a plain `document.body` child carries none of them, so a
    // widget reparented here (suggest/hover/parameter-hints) lost its whole palette: transparent
    // background, unstyled text. Upstream's own convention is to put `monaco-editor` on exactly the
    // node handed to `overflowWidgetsDomNode`
    // (`multiDiffEditorWidgetImpl.js`'s `h('div.monaco-editor@overflowWidgetsDomNode', {})`), so this
    // does the same rather than inventing a fourth scope. The app-owned class stays first for
    // `MonacoHost.vue`'s own `:global(.kira-editor-overflow-widgets …)` rules, which key off it, not
    // `monaco-editor`.
    overflowContainer.className = 'kira-editor-overflow-widgets monaco-editor';
    document.body.appendChild(overflowContainer);
  }
  return overflowContainer;
}

/** Loads monaco-editor's chunk exactly once, wires the worker and defines the theme on first
 *  load — every subsequent call reuses the same resolved module. */
export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoModule) {
    monacoModule = import('./monacoEntry')
      .then(async (mod) => {
        wireWorker(mod);
        const { defineKiraTheme } = await import('./monacoTheme');
        defineKiraTheme(mod);
        return mod;
      })
      .catch((err) => {
        // A rejected memoised promise would otherwise stay rejected for the rest of the page's
        // life — every MonacoHost that mounts afterwards awaits the same broken promise forever,
        // stuck on its own pending state with no way to recover short of a full reload. Forgetting
        // it here means the *next* call retries the import fresh instead.
        monacoModule = undefined;
        throw err;
      });
  }
  return monacoModule;
}
