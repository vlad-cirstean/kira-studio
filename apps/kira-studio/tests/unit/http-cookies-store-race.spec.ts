// P108 F7: the cookies store's own fetchCookiesNow wrote whatever reply landed last, with no
// per-tab ordering — a late reply from an older URL could overwrite a newer one, or undo
// deleteCookie's own refreshed list. Cleanup only ever did `delete cookiesRuntime[tabId]`,
// leaving nothing to stop a fetch already in flight from recreating that entry after the tab
// closed. clearCookies emptied the process-wide jar but only refetched the calling tab, leaving
// every other open tab's own count stale. This pins all three: fetchCookiesNow only ever commits
// its own tab's latest request, a fetch that resolves after its tab has closed is a no-op, and
// clearCookies zeroes every tracked tab's list, not only the caller's.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { HttpCookieWire } from '@shared/domain/http';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
const { openApiRequestTab } = await import('../../frontend/src/api/tabs');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const { useCookiesStore } = await import('../../frontend/src/views/httprequest/cookies');

const cookiesStore = useCookiesStore();

function cookie(name: string, value: string): HttpCookieWire {
  return {
    name,
    value,
    domain: '',
    path: '',
    expires: '',
    maxAge: 0,
    secure: false,
    httpOnly: false,
    sameSite: '',
    hop: 0,
  };
}

describe('cookies store ordering and lifecycle (P108 F7)', () => {
  test('a late reply for an older URL does not overwrite a newer fetch for the same tab', async () => {
    const tabId = openApiRequestTab();
    const replies = new Map<string, { resolve: (v: ReturnType<typeof cookie>[]) => void }>();
    (control as unknown as { httpCookies: typeof control.httpCookies }).httpCookies = (
      url: string,
    ) =>
      new Promise((resolve) => {
        replies.set(url, { resolve });
      });

    const first = cookiesStore.fetchCookiesNow(tabId, 'https://old.example.com');
    const second = cookiesStore.fetchCookiesNow(tabId, 'https://new.example.com');

    // The newer fetch's reply lands first…
    replies.get('https://new.example.com')?.resolve([cookie('session', 'fresh')]);
    await second;
    expect(cookiesStore.cookiesRuntime[tabId].cookies).toEqual([cookie('session', 'fresh')]);

    // …and the older fetch's reply lands after — it must not clobber the fresher result.
    replies.get('https://old.example.com')?.resolve([cookie('session', 'stale')]);
    await first;
    expect(cookiesStore.cookiesRuntime[tabId].cookies).toEqual([cookie('session', 'fresh')]);
  });

  test('a fetch that resolves after its tab has closed does not recreate the runtime entry', async () => {
    const tabId = openApiRequestTab();
    let resolveFetch: ((v: ReturnType<typeof cookie>[]) => void) | undefined;
    (control as unknown as { httpCookies: typeof control.httpCookies }).httpCookies = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });

    const pending = cookiesStore.fetchCookiesNow(tabId, 'https://api.example.com');
    expect(cookiesStore.cookiesRuntime[tabId]).toBeDefined();

    useTabsStore().closeTab(tabId);
    expect(cookiesStore.cookiesRuntime[tabId]).toBeUndefined();

    resolveFetch?.([cookie('session', 'late')]);
    await pending;

    // Closing already deleted the entry — the late reply must not bring it back.
    expect(cookiesStore.cookiesRuntime[tabId]).toBeUndefined();
  });

  test('clearCookies zeroes every open tab, not only the one that triggered it', async () => {
    const tabA = openApiRequestTab();
    const tabB = openApiRequestTab();
    (control as unknown as { httpCookies: typeof control.httpCookies }).httpCookies = async () => [
      cookie('session', 'value'),
    ];
    await cookiesStore.fetchCookiesNow(tabA, 'https://a.example.com');
    await cookiesStore.fetchCookiesNow(tabB, 'https://b.example.com');
    expect(cookiesStore.cookiesRuntime[tabA].cookies).toHaveLength(1);
    expect(cookiesStore.cookiesRuntime[tabB].cookies).toHaveLength(1);

    let clearCalls = 0;
    (control as unknown as { httpClearCookies: typeof control.httpClearCookies }).httpClearCookies =
      async () => {
        clearCalls++;
      };

    await cookiesStore.clearCookies();

    expect(clearCalls).toBe(1);
    expect(cookiesStore.cookiesRuntime[tabA].cookies).toHaveLength(0);
    expect(cookiesStore.cookiesRuntime[tabB].cookies).toHaveLength(0);
  });
});
