/**
 * The getComputedStyle bridge for the tokens JavaScript needs as a number: `--kira-graph-row-h`/
 * `--kira-graph-row-h-compact` reach SlickGrid's `rowHeight` option and `rowSvg.ts`'s per-row
 * geometry as pixel values, which the cascade cannot hand over. Colours stay in CSS classes.
 * Re-reads when `<html>`/`<body>` class or style changes (live font-size settings).
 *
 * `getComputedStyle().getPropertyValue()` on a custom property substitutes `var()` but does not
 * evaluate `calc()`, so each length token is measured through a hidden probe carrying the real CSS
 * property (`height`/`font-size`), same precedent as `dateFormat.ts`'s `measureAbsoluteDateWidth`.
 * `--kira-font-ui` stays a plain string read.
 */
const LENGTH_TOKENS = [
  '--kira-graph-row-h',
  '--kira-graph-row-h-compact',
  '--kira-graph-t-md',
] as const;
type LengthToken = (typeof LENGTH_TOKENS)[number];

const STRING_TOKENS = ['--kira-font-ui'] as const;
type StringToken = (typeof STRING_TOKENS)[number];

export type TokenName = LengthToken | StringToken;
export type TokenMap = Readonly<Record<TokenName, string>>;

const ALL_TOKENS: readonly TokenName[] = [...LENGTH_TOKENS, ...STRING_TOKENS];

export type TokenChangeListener = (tokens: TokenMap) => void;

/** Which real CSS property a length token's probe is measured through — `height` for the two row
 *  tokens (read via `getBoundingClientRect`, since a box's rendered height is what SlickGrid's
 *  `rowHeight` option actually needs), `font-size` for the type-scale token (read via
 *  `getComputedStyle`, which resolves a standard property's own `calc()` with no layout needed). */
const PROBE_PROPERTY: Readonly<Record<LengthToken, 'height' | 'fontSize'>> = {
  '--kira-graph-row-h': 'height',
  '--kira-graph-row-h-compact': 'height',
  '--kira-graph-t-md': 'fontSize',
};

interface LengthProbe {
  readonly el: HTMLElement;
  read(): string;
}

/** Tokens are all `:root`-scoped (`theme/git.css`; no component overrides one locally), so a probe resolves correctly wherever it is mounted — `document.body`
 *  is used rather than a reader's own `#target` so this never depends on `#target` being a
 *  connected, renderable node (a test double passed to the constructor is not required to be
 *  one). `undefined` outside a real browser (bun's own test environment has no `document` —
 *  the same reason `measureAbsoluteDateWidth` returns `0` there rather than throwing); nothing in
 *  this package's tests constructs a `TokenReader` today, so this path exists for future callers,
 *  not a hole in current coverage. */
function createProbe(token: LengthToken): LengthProbe | undefined {
  if (typeof document === 'undefined' || !document.body) return undefined;
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
  el.style.width = '0';
  const property = PROBE_PROPERTY[token];
  if (property === 'height') el.style.height = `var(${token})`;
  else el.style.fontSize = `var(${token})`;
  document.body.appendChild(el);
  return {
    el,
    read: () =>
      property === 'height'
        ? `${el.getBoundingClientRect().height}px`
        : getComputedStyle(el).fontSize,
  };
}

export class TokenReader {
  #target: HTMLElement;
  #cache: TokenMap;
  #observer: MutationObserver | undefined;
  #listeners = new Set<TokenChangeListener>();
  readonly #probes: Partial<Record<LengthToken, LengthProbe>> = {};

  constructor(target: HTMLElement = document.documentElement) {
    this.#target = target;
    for (const token of LENGTH_TOKENS) this.#probes[token] = createProbe(token);
    this.#cache = this.#readAll();
  }

  #readAll(): TokenMap {
    const computed = getComputedStyle(this.#target);
    const result = {} as Record<TokenName, string>;
    for (const name of LENGTH_TOKENS) {
      const probe = this.#probes[name];
      result[name] = probe ? probe.read() : computed.getPropertyValue(name).trim();
    }
    for (const name of STRING_TOKENS) {
      result[name] = computed.getPropertyValue(name).trim();
    }
    return result;
  }

  /** Cached token values as of the last read or theme-change re-read. */
  get tokens(): TokenMap {
    return this.#cache;
  }

  /** Force a synchronous re-read, bypassing the cache. */
  refresh(): TokenMap {
    this.#cache = this.#readAll();
    return this.#cache;
  }

  onChange(listener: TokenChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Watches for a live token change. Only notifies listeners when a tracked token's *value*
   * actually moved (P4 W13's own discovery): `CommitGrid.vue`'s one listener does a full
   * `invalidateAllRows()` + `render()`, correct when `--kira-graph-row-h` genuinely changed but
   * wasted work on every other class/style mutation a theme switch also makes. A colour-only theme
   * switch re-renders nothing in JavaScript: the SVGs recolour through the CSS cascade.
   *
   * One `MutationObserver` watches `body` and `#target` (`<html>` by default): `applyAppearance`
   * writes `--kira-font-size`/`--kira-graph-font-size` onto `document.documentElement.style`, so a
   * live font-size change reaches this listener. Observing one element twice is skipped.
   */
  watch(body: HTMLElement = document.body): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => {
      const previous = this.#cache;
      const next = this.refresh();
      if (ALL_TOKENS.every((name) => previous[name] === next[name])) return;
      for (const listener of this.#listeners) listener(next);
    });
    this.#observer.observe(body, { attributes: true, attributeFilter: ['class', 'style'] });
    if (this.#target !== body) {
      this.#observer.observe(this.#target, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#listeners.clear();
    for (const probe of Object.values(this.#probes)) probe?.el.remove();
  }
}

/** The default `--kira-graph-row-h` (`theme/git.css`) — the fallback `rowHeightPx` returns if the
 *  token is unset or unparseable, which only happens outside a real browser (a unit test with no
 *  stylesheet loaded), never in a mounted app. */
const FALLBACK_ROW_HEIGHT = 36;

/** The default `--kira-graph-row-h-compact` (`theme/git.css`) — `compactRowHeightPx`'s own fallback,
 *  same reasoning as `FALLBACK_ROW_HEIGHT`. */
const FALLBACK_ROW_HEIGHT_COMPACT = 20;

/**
 * `--kira-graph-row-h` as an actual pixel number (W6, W8) — the one numeric read every consumer of
 * this token needs, so the `parseFloat("22px")` lives in exactly one place rather than once per
 * caller. A malformed or missing value (an environment with no theme CSS loaded) falls back to
 * `theme/git.css`'s default rather than propagating `NaN` into SlickGrid's `rowHeight` option
 * or the graph column's geometry. P7 (item 1): now the height a row with a ref/PR badge uses —
 * SlickGrid's own grid-level default became `compactRowHeightPx` below, the more common case.
 */
export function rowHeightPx(reader: TokenReader): number {
  const parsed = Number.parseFloat(reader.tokens['--kira-graph-row-h']);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROW_HEIGHT;
}

/**
 * `--kira-graph-row-h-compact` as an actual pixel number — P7 (item 1)'s own new read, mirroring
 * `rowHeightPx` exactly. This is the height an undecorated row (no ref/PR badge) uses, and the
 * grid's own default `rowHeight` option now that variable row height is on
 * (`enableVariableRowHeight`, `CommitGrid.vue`) — SlickGrid falls back to the grid-level default
 * for any row `getItemMetadata` does not explicitly give a taller `height` to.
 */
export function compactRowHeightPx(reader: TokenReader): number {
  const parsed = Number.parseFloat(reader.tokens['--kira-graph-row-h-compact']);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROW_HEIGHT_COMPACT;
}
