import { useDebounceFn, useDocumentVisibility } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { onScopeDispose, type Ref, watch } from 'vue';
import { useDocker } from '../context';
import { useDockerStatsStore } from './dockerStats';

// Live stats are best effort: a failed call logs, and the next visibility or id change subscribes again.
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
        fireAndForget(control.statsUnsubscribe(), 'docker.stats');
      }
      return;
    }
    subscribed = true;
    fireAndForget(control.statsSubscribe(ids.value), 'docker.stats');
  }, TIMING.preview);

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
        fireAndForget(control.statsUnsubscribe(), 'docker.stats');
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
    if (subscribed) fireAndForget(control.statsUnsubscribe(), 'docker.stats');
  });
}
