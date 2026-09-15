/**
 * The getComputedStyle bridge for the token layer holds that JavaScript still needs as a number
 * or a live-updating string, not left purely to the cascade: `--kv-row-height`/
 * `--kv-row-height-compact` (§6.1) have to reach SlickGrid's `rowHeight` option and `rowSvg.ts`'s
 * per-row geometry (W6, W8) as actual pixel values, since neither is something the cascade can
 * hand a value to on its own. Every *colour* token, by contrast, is consumed purely through CSS
 * classes now (W1, §3.4) — `packages/ui/src/graph/` never holds a colour string, so this file has
 * no reason to resolve one. Re-reads on theme change via a `MutationObserver`, in case a density
 * setting ever changes the row height live rather than only at startup.
 *
 * Implemented fully in P0, ahead of anything that consumes it, because it is easy to get subtly
 * wrong and a later phase would otherwise write it in a hurry while also writing a renderer.
 *
 * P72 §6.2/§6.3: `--kv-row-height`/`--kv-row-height-compact`/`--kv-font-size` are the *length*
 * tokens — the three of the four below whose value has to reach JavaScript as a real pixel
 * number. `getComputedStyle().getPropertyValue()` on a *custom* property substitutes `var()`
 * references but does not evaluate `calc()` (no `@property` registration gives it a syntax to
 * evaluate against) — once `--kv-row-height` derives from `--kv-h-xs` (`density.css`,
 * `kira-structure.css`) rather than staying a plain literal, that string-parse silently returns
 * `NaN` and the fallback below papers over it, looking correct while every row is sized wrong.
 * Each length token is instead measured through a hidden probe carrying the *real* CSS property
 * (`height`/`font-size`) the browser does resolve `calc()` for — the same precedent
 * `CommitGrid.vue`'s own `.kv-date-width-probe` already established (`dateFormat.ts`'s
 * `measureAbsoluteDateWidth`). `--kv-font-family` stays a plain string read — nothing here ever
 * turns it into a number.
 */
const LENGTH_TOKENS = ['--kv-row-height', '--kv-row-height-compact', '--kv-font-size'] as const;
type LengthToken = (typeof LENGTH_TOKENS)[number];

const STRING_TOKENS = ['--kv-font-family'] as const;
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
  '--kv-row-height': 'height',
  '--kv-row-height-compact': 'height',
  '--kv-font-size': 'fontSize',
};

interface LengthProbe {
  readonly el: HTMLElement;
  read(): string;
}

/** Tokens are all `:root`-scoped (`kira-structure.css`/`density.css`'s own charter — no component
 *  overrides one locally), so a probe resolves correctly wherever it is mounted — `document.body`
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
   * `invalidateAllRows()` + `render()`, correct when `--kv-row-height` genuinely changed but
   * wasted work on every other class/style mutation a theme switch also makes — which is most of
   * them. A colour-only theme switch must re-render nothing in JavaScript at all (`palette.ts`'s
   * own "no JavaScript executed" claim) — the SVGs already recolour purely through the CSS
   * cascade; forcing every row's DOM node to be destroyed and rebuilt on top of that was pure
   * overhead, worse the larger the repo.
   *
   * P72 §6.2(ii): one `MutationObserver`, observing two surfaces, not two observers. `body`
   * (default: `document.body`) is what VS Code mutates on theme switch (the original reason this
   * existed). Kira Studio mutates a different surface — `applyAppearance`
   * (`apps/kira-studio/frontend/src/state/settings.ts`) writes `--kira-font-size` onto
   * `document.documentElement.style`, which is this reader's own `#target` by default — so a live
   * Appearance font-size change never reached this listener until `#target` was watched too. When
   * `#target` and `body` are the same element (a caller that passed `document.body` explicitly),
   * observing it twice would be redundant, not wrong, but is skipped anyway.
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
