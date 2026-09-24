import type { ConnectionStatus } from '@shared/domain/connection';
import { type ComputedRef, computed } from 'vue';
import { useConnectionsStore } from '../../state/connections';
import { useTabsStore } from '../../state/tabs';

/**
 * §8.4's reconnect gate, once — grid/documents/keyvalue/stream/definition/console each wrote out
 * the same connectionStatus/needsReconnect/onReconnectAndLoad trio (P39 iter2 F7). `onLoad` is the
 * one thing that genuinely varies per view: stream passes a closure carrying its `isBatch` check
 * (a batch tab must not auto-load, since every poll consumes from the queue), and console passes
 * nothing (a console tab hydrates without loading anything).
 */
export function useConnectionGate(
  tab: () => { id: string; connectionId: string | null },
  onLoad?: () => Promise<void> | void,
): {
  connectionStatus: ComputedRef<ConnectionStatus>;
  needsReconnect: ComputedRef<boolean>;
  onReconnectAndLoad(): Promise<boolean>;
} {
  const connectionStatus = computed<ConnectionStatus>(() => {
    const connectionId = tab().connectionId;
    return connectionId
      ? (useConnectionsStore().states[connectionId]?.status ?? 'disconnected')
      : 'disconnected';
  });

  // §8.4: a restored tab shows only the reconnect button until pressed — nothing loads automatically.
  const needsReconnect = computed(
    () => !useTabsStore().isHydrated(tab().id) || connectionStatus.value !== 'connected',
  );

  // P108 Part 12 F16: returns whether the tab ended up connected. Go's ConnectionsService.Connect
  // never rejects for a bad connection (a wrong password, an unreachable host) — it resolves with
  // that state, same as ConnectionDialog's own Test — so a caller has to check connectionStatus
  // again after the await, not assume the connect it just awaited succeeded. markHydrated/onLoad
  // only run once it actually did; every existing caller (a template `@click` binding, or an
  // `await onReconnectAndLoad()` that never inspected the old `void` return) is unaffected by the
  // new return value.
  async function onReconnectAndLoad(): Promise<boolean> {
    const connectionId = tab().connectionId;
    if (!connectionId) return false;
    if (connectionStatus.value !== 'connected') {
      await useConnectionsStore().connectConnection(connectionId);
    }
    if (connectionStatus.value !== 'connected') return false;
    useTabsStore().markHydrated(tab().id);
    await onLoad?.();
    return true;
  }

  return { connectionStatus, needsReconnect, onReconnectAndLoad };
}

// P108 Part 12 F16: a one-shot, non-reactive counterpart to the gate above — for a call site
// (OperationsPanel's Re-run) that reconnects then acts exactly once, imperatively, on a tab it
// just opened itself, rather than binding to a live tab's own reactive gate UI. Calling
// useConnectionGate's own computed()s from a callback that runs well after the component's setup
// has already returned (Re-run fires from a context-menu click, not during setup) creates each one
// with no owning effect scope to dispose it — this needs none, since it reads
// connectionsStore.states directly instead of through a computed. Returns the same success signal
// onReconnectAndLoad above does.
export async function ensureConnectedOnce(
  tabId: string,
  connectionId: string | null,
): Promise<boolean> {
  if (!connectionId) return false;
  const connectionsStore = useConnectionsStore();
  if (connectionsStore.states[connectionId]?.status !== 'connected') {
    await connectionsStore.connectConnection(connectionId);
  }
  if (connectionsStore.states[connectionId]?.status !== 'connected') return false;
  useTabsStore().markHydrated(tabId);
  return true;
}

// Item 4 (regression pass, task batch P46-2): every gated view's toolbar Refresh button used to
// call its own plain reload unconditionally, including while the tab sat behind the Reconnect
// gate — a doomed call against a connection nothing has reconnected yet, and no better than doing
// nothing since the gate was already covering the body. Pressing Refresh on an unloaded tab should
// do what a user actually means by it: reconnect and load, exactly what the gate's own button does.
export function refreshOrReconnect(
  needsReconnect: boolean,
  onReconnectAndLoad: () => Promise<unknown>,
  refresh: () => void | Promise<void>,
): void {
  if (needsReconnect) {
    void onReconnectAndLoad();
    return;
  }
  void refresh();
}
