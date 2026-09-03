import {
  type PersistedViewState,
  parsePersistedViewState,
  type ViewStateStore,
} from "@kira-version/ui";

const STORAGE_KEY = "kira-harness-viewState";

/**
 * A `sessionStorage`-backed `ViewStateStore`, harness-only (P4 W13) — swapped in for the
 * previous `InMemoryViewStateStore` so a persisted field (a column resize, say) genuinely
 * survives a `page.reload()`, the one persistence path none of the three real hosts' own specs
 * can exercise: a VS Code/Electron webview's `getState`/`setState` survives a hide/reveal, not a
 * full page navigation, and neither host's real backing store (`globalState`, `Storage`) is
 * reachable from a Playwright spec driving the harness in a plain browser tab.
 *
 * `sessionStorage`, not `localStorage`: state should not leak from one Playwright test's browser
 * context into the next (each gets its own storage by default) or outlive the tab, matching a
 * freshly-opened webview's own "nothing persisted yet" starting point unless a test's own reload
 * deliberately keeps the same tab open.
 */
export class SessionStorageViewStateStore implements ViewStateStore {
  read(): PersistedViewState | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    try {
      return parsePersistedViewState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  write(state: PersistedViewState): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
