import type { HttpCookieWire } from '@shared/domain/http';
import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { findHttpRequestTab } from '../../api/tabs';
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
  /** P108 F7: the last URL fetchCookiesNow was asked to fetch for this tab — clearCookies' own
   *  refetch-every-open-tab pass reads it back; nothing here is persisted (§3.1 still holds). */
  url: string;
}

export const useCookiesStore = defineStore('cookies', () => {
  const cookiesRuntime: Record<string, CookiesRuntime> = reactive({});

  // P108 F7: each tab's own monotonic counter — a fetch only commits its reply if nothing newer
  // (another fetch for the same tab) has started since. Without this, a late reply from an older
  // URL could land after a newer fetch's reply and overwrite it, or undo deleteCookie's own
  // refreshed list.
  const fetchSeq = new Map<string, number>();

  registerTabRuntimeCleanup((tabId) => {
    delete cookiesRuntime[tabId];
    fetchSeq.delete(tabId);
  });

  function ensure(tabId: string): CookiesRuntime {
    if (!cookiesRuntime[tabId]) cookiesRuntime[tabId] = { cookies: [], loading: false, url: '' };
    return cookiesRuntime[tabId];
  }

  /** A URL that fails to parse (e.g. still carries an unresolved `{{host}}` template) is not an
   *  error state worth surfacing here — the pane just shows no cookies until the URL resolves to
   *  something real, exactly like an empty jar.
   *
   *  P108 F7: guards against a call that starts while its tab still exists but resolves after the
   *  tab has closed — bails before `ensure()` would otherwise recreate a runtime entry cleanup
   *  already deleted, and again before writing a reply back (the sequence check alone does not
   *  catch this: a closed tab's own `fetchSeq` entry is gone too, and closing never happened to
   *  bump it). */
  async function fetchCookiesNow(tabId: string, url: string): Promise<void> {
    if (!findHttpRequestTab(tabId)) return;
    const rt = ensure(tabId);
    rt.url = url;
    const mySeq = (fetchSeq.get(tabId) ?? 0) + 1;
    fetchSeq.set(tabId, mySeq);
    rt.loading = true;
    try {
      const cookies = await control.httpCookies(url);
      if (!findHttpRequestTab(tabId) || fetchSeq.get(tabId) !== mySeq) return;
      rt.cookies = cookies;
    } catch {
      if (!findHttpRequestTab(tabId) || fetchSeq.get(tabId) !== mySeq) return;
      rt.cookies = [];
    } finally {
      if (findHttpRequestTab(tabId) && fetchSeq.get(tabId) === mySeq) rt.loading = false;
    }
  }

  // P108 F7: the debounce this store used to own itself (`debounceTimers`, one raw `setTimeout`
  // per tab) is gone — HttpRequestView.vue now debounces its own call with `useDebounceFn`,
  // cancelled `onUnmounted` (the same shape GrpcRequestView.vue's own schema-load debounce already
  // uses). The decline this comment used to record ("sole caller is HttpRequestView, one instance
  // per tab") is exactly why a raw per-key timer registry no longer earns its keep over the
  // library the view-level caller can use directly — one `useDebounceFn` instance per mounted view
  // needs no cross-tab keying at all.

  async function deleteCookie(tabId: string, url: string, name: string): Promise<void> {
    const rt = ensure(tabId);
    rt.cookies = await control.httpDeleteCookie(url, name);
  }

  /** P108 F7: `httpclient.ClearJar()` (Go) empties the *whole* process-wide jar, not just this
   *  tab's URL — every open tab's own cookies are gone too, not only the calling one's. Zeroing
   *  every tracked runtime's list directly (rather than an IPC refetch per tab) is exact: a clear
   *  cannot leave any URL with cookies left to report. */
  async function clearCookies(): Promise<void> {
    await control.httpClearCookies();
    for (const rt of Object.values(cookiesRuntime)) {
      rt.cookies = [];
    }
  }

  return { cookiesRuntime, fetchCookiesNow, deleteCookie, clearCookies };
});
