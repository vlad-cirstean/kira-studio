/**
 * The getComputedStyle bridge for the one thing the --kv-* token layer holds that JavaScript
 * still needs as a number, not a CSS string: `--kv-row-height` (§6.1) has to reach SlickGrid's
 * `rowHeight` option and `rowSvg.ts`'s per-row geometry (W6, W8) as an actual pixel value, since
 * neither is something the cascade can hand a value to on its own. Every *colour* token, by
 * contrast, is consumed purely through CSS classes now (W1, §3.4) — `packages/ui/src/graph/`
 * never holds a colour string, so this file has no reason to resolve one. Re-reads on theme
 * change via a MutationObserver on <body>, in case a density setting ever changes the row height
 * live rather than only at startup.
 *
 * Implemented fully in P0, ahead of anything that consumes it, because it is easy to get subtly
 * wrong and a later phase would otherwise write it in a hurry while also writing a renderer.
 */
// G21 D6b: `--kv-font-size`/`--kv-font-family` join `--kv-row-height` — G14 already made the type
// scale follow VS Code's own font settings, and CommitGrid.vue's own measured date-column width
// (`dateFormat.ts`'s `measureAbsoluteDateWidth`) is genuinely font-dependent, not computable from
// a character count, so a live font change has to reach it through this same change signal.
// P7 (item 1): `--kv-row-height-compact` joins them — the height an undecorated (no ref/PR badge)
// row now uses, read the same way and re-notified on the same theme-change signal as the expanded
// token it sits beside.
const TOKEN_NAMES = [
  '--kv-row-height',
  '--kv-row-height-compact',
  '--kv-font-size',
  '--kv-font-family',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenMap = Readonly<Record<TokenName, string>>;

export type TokenChangeListener = (tokens: TokenMap) => void;

function readAll(target: HTMLElement): TokenMap {
  const computed = getComputedStyle(target);
  const result = {} as Record<TokenName, string>;
  for (const name of TOKEN_NAMES) {
    result[name] = computed.getPropertyValue(name).trim();
  }
  return result;
}

export class TokenReader {
  #target: HTMLElement;
  #cache: TokenMap;
  #observer: MutationObserver | undefined;
  #listeners = new Set<TokenChangeListener>();

  constructor(target: HTMLElement = document.documentElement) {
    this.#target = target;
    this.#cache = readAll(target);
  }

  /** Cached token values as of the last read or theme-change re-read. */
  get tokens(): TokenMap {
    return this.#cache;
  }

  /** Force a synchronous re-read, bypassing the cache. */
  refresh(): TokenMap {
    this.#cache = readAll(this.#target);
    return this.#cache;
  }

  onChange(listener: TokenChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Watches <body>'s class/style attributes, the surface VS Code mutates on theme switch. Only
   * notifies listeners when a tracked token's *value* actually moved (P4 W13's own discovery):
   * `CommitGrid.vue`'s one listener does a full `invalidateAllRows()` + `render()`, correct when
   * `--kv-row-height` genuinely changed but wasted work on every other class/style mutation a
   * theme switch also makes to `<body>` — which is most of them, since `--kv-row-height` is a
   * fixed `density.css` literal today and no shipped theme touches it. A colour-only theme switch
   * must re-render nothing in JavaScript at all (`palette.ts`'s own "no JavaScript executed"
   * claim) — the SVGs already recolour purely through the CSS cascade; forcing every row's DOM
   * node to be destroyed and rebuilt on top of that was pure overhead, worse the larger the repo.
   */
  watch(body: HTMLElement = document.body): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => {
      const previous = this.#cache;
      const next = this.refresh();
      if (TOKEN_NAMES.every((name) => previous[name] === next[name])) return;
      for (const listener of this.#listeners) listener(next);
    });
    this.#observer.observe(body, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#listeners.clear();
  }
}

/** The default `--kv-row-height` (`density.css`) — the fallback `rowHeightPx` returns if the
 *  token is unset or unparseable, which only happens outside a real browser (a unit test with no
 *  stylesheet loaded), never in a mounted app. */
const FALLBACK_ROW_HEIGHT = 36;

/** The default `--kv-row-height-compact` (`density.css`) — `compactRowHeightPx`'s own fallback,
 *  same reasoning as `FALLBACK_ROW_HEIGHT`. */
const FALLBACK_ROW_HEIGHT_COMPACT = 20;

/**
 * `--kv-row-height` as an actual pixel number (W6, W8) — the one numeric read every consumer of
 * this token needs, so the `parseFloat("22px")` lives in exactly one place rather than once per
 * caller. A malformed or missing value (an environment with no theme CSS loaded) falls back to
 * `density.css`'s own default rather than propagating `NaN` into SlickGrid's `rowHeight` option
 * or the graph column's geometry. P7 (item 1): now the height a row with a ref/PR badge uses —
 * SlickGrid's own grid-level default became `compactRowHeightPx` below, the more common case.
 */
export function rowHeightPx(reader: TokenReader): number {
  const parsed = Number.parseFloat(reader.tokens['--kv-row-height']);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROW_HEIGHT;
}

/**
 * `--kv-row-height-compact` as an actual pixel number — P7 (item 1)'s own new read, mirroring
 * `rowHeightPx` exactly. This is the height an undecorated row (no ref/PR badge) uses, and the
 * grid's own default `rowHeight` option now that variable row height is on
 * (`enableVariableRowHeight`, `CommitGrid.vue`) — SlickGrid falls back to the grid-level default
 * for any row `getItemMetadata` does not explicitly give a taller `height` to.
 */
export function compactRowHeightPx(reader: TokenReader): number {
  const parsed = Number.parseFloat(reader.tokens['--kv-row-height-compact']);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROW_HEIGHT_COMPACT;
}
