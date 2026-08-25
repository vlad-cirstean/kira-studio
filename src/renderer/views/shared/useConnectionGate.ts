import type { ConnectionStatus } from '@shared/domain/connection';
import { type ComputedRef, computed } from 'vue';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';

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
  onReconnectAndLoad(): Promise<void>;
} {
  const connectionStatus = computed<ConnectionStatus>(() => {
    const connectionId = tab().connectionId;
    return connectionId
      ? (connectionsState.states[connectionId]?.status ?? 'disconnected')
      : 'disconnected';
  });

  // §8.4: a restored tab shows only the reconnect button until pressed — nothing loads automatically.
  const needsReconnect = computed(
    () => !isHydrated(tab().id) || connectionStatus.value !== 'connected',
  );

  async function onReconnectAndLoad(): Promise<void> {
    const connectionId = tab().connectionId;
    if (!connectionId) return;
    if (connectionStatus.value !== 'connected') {
      await connectConnection(connectionId);
    }
    markHydrated(tab().id);
    await onLoad?.();
  }

  return { connectionStatus, needsReconnect, onReconnectAndLoad };
}
