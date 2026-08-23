/**
 * §2.1's reason the panel does not use `retainContextWhenHidden` (P3 W9): a VS Code webview
 * view is destroyed and recreated on every hide/reveal, so anything the UI needs to survive
 * that has to go through `getState`/`setState` (or the platform's equivalent) rather than live
 * JS heap. `PersistedViewState` is that survivor — deliberately small, versioned, and, per
 * §5.4, read back on mount to re-open `graph.stream` against the host's still-cached rows.
 */
export interface PersistedViewState {
  readonly version: 1;
  readonly repoId: string | null;
  readonly loadedRows: number;
  readonly detailOpen: boolean;
}

export interface ViewStateStore {
  read(): PersistedViewState | null;
  write(state: PersistedViewState): void;
}

function isPersistedViewStateShape(value: unknown): value is PersistedViewState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["version"] === 1 &&
    (typeof record["repoId"] === "string" || record["repoId"] === null) &&
    typeof record["loadedRows"] === "number" &&
    typeof record["detailOpen"] === "boolean"
  );
}

/**
 * Validates a raw value read back from platform storage against `PersistedViewState`'s
 * current shape. **A `version` that is not `1` is discarded whole, never partially applied**
 * — P4 will add scroll offset, selection and column widths and bump the version, and a
 * half-applied older state is a bug that reproduces once per upgrade. Every concrete
 * `ViewStateStore` (VS Code's `getState`, Electron's `Storage`-backed one, this file's
 * in-memory one) calls this rather than trusting its raw source.
 */
export function parsePersistedViewState(raw: unknown): PersistedViewState | null {
  return isPersistedViewStateShape(raw) ? raw : null;
}

/**
 * The harness's `ViewStateStore` (§3.1 lists the interface here; the harness is one of the
 * three hosts choosing an implementation at mount, alongside VS Code's `getState`/`setState`
 * and Electron's `Storage`-backed one) — and a convenient fake for `state/` unit tests, since
 * it needs no platform API.
 */
export class InMemoryViewStateStore implements ViewStateStore {
  #raw: unknown = null;

  read(): PersistedViewState | null {
    return parsePersistedViewState(this.#raw);
  }

  write(state: PersistedViewState): void {
    this.#raw = state;
  }

  /** Test-only: injects a raw (possibly invalid or out-of-version) value as if it had come
   *  back from real platform storage, without going through `write`'s always-valid shape. */
  setRaw(raw: unknown): void {
    this.#raw = raw;
  }
}
