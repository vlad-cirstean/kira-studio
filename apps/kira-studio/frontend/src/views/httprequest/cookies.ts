import type { HttpCookieWire } from '@shared/domain/http';
import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { control } from '../../bridge/control';

// P90 item 2's request-mode runtime: what the shared jar would send for a tab's current URL right
// now — the answer to "will my session cookie go out on the next send" (CookiesPane.vue). Shared
// between HttpRequestView.vue's own Cookies segment count badge and CookiesPane.vue's own list, so
// the two never fetch independently and disagree mid-flight. Runtime-only, component-local in
// spirit even though it lives in a module-level store — nothing here is tab state, nothing is
// persisted (§3.1).
interface CookiesRuntime {
  cookies: HttpCookieWire[];
  loading: boolean;
}

export const useCookiesStore = defineStore('cookies', () => {
  const cookiesRuntime: Record<string, CookiesRuntime> = reactive({});

  registerTabRuntimeCleanup((tabId) => {
    delete cookiesRuntime[tabId];
  });

  function ensure(tabId: string): CookiesRuntime {
    if (!cookiesRuntime[tabId]) cookiesRuntime[tabId] = { cookies: [], loading: false };
    return cookiesRuntime[tabId];
  }

  /** A URL that fails to parse (e.g. still carries an unresolved `{{host}}` template) is not an
   *  error state worth surfacing here — the pane just shows no cookies until the URL resolves to
   *  something real, exactly like an empty jar. */
  async function fetchCookiesNow(tabId: string, url: string): Promise<void> {
    const rt = ensure(tabId);
    rt.loading = true;
    try {
      rt.cookies = await control.httpCookies(url);
    } catch {
      rt.cookies = [];
    } finally {
      rt.loading = false;
    }
  }

  // P99 §9.3: not useDebounceFn — keyed per tabId (a tab's own pending fetch must not cancel or
  // share a timer with another tab's), and useDebounceFn debounces one function identity. A
  // per-key cache of debounced instances would be a new abstraction invented mid-pass for this one
  // call site (§9.4 forbids that outside a genuine multi-site finding). Declined, named per
  // CLAUDE.md's library rule.
  const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  /** §3.1: the URL field fires per keystroke — SearchToolbar.vue's own debounce is the in-repo shape
   *  this copies. */
  function scheduleCookiesFetch(tabId: string, url: string): void {
    const existing = debounceTimers[tabId];
    if (existing) clearTimeout(existing);
    debounceTimers[tabId] = setTimeout(() => {
      delete debounceTimers[tabId];
      void fetchCookiesNow(tabId, url);
    }, 300);
  }

  async function deleteCookie(tabId: string, url: string, name: string): Promise<void> {
    const rt = ensure(tabId);
    rt.cookies = await control.httpDeleteCookie(url, name);
  }

  async function clearCookies(tabId: string, url: string): Promise<void> {
    await control.httpClearCookies();
    await fetchCookiesNow(tabId, url);
  }

  return { cookiesRuntime, fetchCookiesNow, scheduleCookiesFetch, deleteCookie, clearCookies };
});
