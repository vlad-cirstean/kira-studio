import { useDebounceFn, useDocumentVisibility } from '@vueuse/core';
import { onScopeDispose, type Ref, watch } from 'vue';
import { useDocker } from '../context';
import { useDockerStatsStore } from './dockerStats';

const RESUBSCRIBE_DEBOUNCE_MS = 300;

/** Keeps Go's stats stream subscribed to `ids` while mounted and visible. */
export function useStatsSubscription(ids: Ref<string[]>): void {
  const { control } = useDocker();
  const store = useDockerStatsStore();
  const visibility = useDocumentVisibility();
  let off: (() => void) | null = null;
  let subscribed = false;

  const sync = useDebounceFn(() => {
    if (visibility.value !== 'visible' || ids.value.length === 0) {
      if (subscribed) {
        subscribed = false;
        void control.statsUnsubscribe().catch(() => undefined);
      }
      return;
    }
    subscribed = true;
    void control.statsSubscribe(ids.value).catch(() => undefined);
  }, RESUBSCRIBE_DEBOUNCE_MS);

  function listen(): void {
    if (!off) off = control.onStats((e) => store.ingest(e.samples));
  }

  function unlisten(): void {
    off?.();
    off = null;
  }

  watch(
    [ids, visibility],
    ([, v], [, prevV]) => {
      if (v === 'visible') listen();
      else unlisten();
      if (v !== prevV && v !== 'visible') {
        sync.cancel?.();
        subscribed = false;
        void control.statsUnsubscribe().catch(() => undefined);
        return;
      }
      void sync();
    },
    { immediate: true, deep: true },
  );

  watch(ids, (next, prev) => {
    const keep = new Set(next);
    store.forget(prev.filter((id) => !keep.has(id)));
  });

  onScopeDispose(() => {
    unlisten();
    sync.cancel?.();
    if (subscribed) void control.statsUnsubscribe().catch(() => undefined);
  });
}
