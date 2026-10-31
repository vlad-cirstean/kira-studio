import type { ProofViewState } from '@shared/domain/proof';
import { useDebounceFn } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { control } from '../bridge/control';
import { EMPTY_RESULT_VIEW_STATE, type ResultViewState } from '../views/console/resultViewState';
import { cacheViewState, useProofViewStates } from './queries';

interface StepIds {
  sessionId: () => string;
  rev: () => number;
  ordinal: () => number;
}

/** One step's saved view: loaded once as the restore seed, then kept in the query cache on every
 *  change and written to the backend after a quiet moment (and on unmount). */
export function useStepViewState(ids: StepIds) {
  const query = useProofViewStates(ids.sessionId, ids.rev);
  const seed = shallowRef<ProofViewState | null>(null);
  let latest: ProofViewState | null = null;
  let saved = '';

  watch(
    () => query.data.value,
    (entries) => {
      if (!entries || seed.value) return;
      const state = entries.find((e) => e.ordinal === ids.ordinal())?.state;
      seed.value = state ?? { queryScrollTop: 0, ...EMPTY_RESULT_VIEW_STATE };
      latest = seed.value;
      saved = JSON.stringify(latest);
    },
    { immediate: true },
  );

  const sessionId = ids.sessionId();
  const rev = ids.rev();
  const ordinal = ids.ordinal();

  const write = useDebounceFn(() => flush(), TIMING.scrollPersist);

  function flush(): void {
    if (!latest) return;
    const json = JSON.stringify(latest);
    if (json === saved) return;
    saved = json;
    fireAndForget(control.proofSetViewState(sessionId, rev, ordinal, latest), 'proof.viewState');
  }

  function update(patch: Partial<ProofViewState>): void {
    if (!latest) return;
    const next = { ...latest, ...patch };
    if (JSON.stringify(next) === JSON.stringify(latest)) return;
    latest = next;
    cacheViewState(sessionId, rev, ordinal, next);
    void write();
  }

  onBeforeUnmount(flush);

  return {
    /** `null` until the saved view has loaded. */
    seed,
    setResult: (state: ResultViewState) => update(state),
    setQueryScroll: (queryScrollTop: number) => update({ queryScrollTop }),
  };
}
