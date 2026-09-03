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
const TOKEN_NAMES = ["--kv-row-height"] as const;

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

  /** Watches <body>'s class/style attributes, the surface VS Code mutates on theme switch. */
  watch(body: HTMLElement = document.body): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => {
      const next = this.refresh();
      for (const listener of this.#listeners) listener(next);
    });
    this.#observer.observe(body, { attributes: true, attributeFilter: ["class", "style"] });
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#listeners.clear();
  }
}
