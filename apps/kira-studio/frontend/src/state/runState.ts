import { type ComputedRef, computed, ref, watchEffect } from 'vue';
import { opsState } from './ops';

// One shared ticker for the whole app instead of a per-view setInterval: started only while at
// least one op is running, stopped otherwise, so RunState.vue's ring/elapsed-time never leaks a
// timer when a view unmounts mid-run (tests/e2e/leaks.spec.ts).
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

watchEffect(() => {
  const running = opsState.records.some((r) => r.status === 'running');
  if (running && !timer) {
    now.value = Date.now();
    timer = setInterval(() => {
      now.value = Date.now();
    }, 200);
  } else if (!running && timer) {
    clearInterval(timer);
    timer = null;
  }
});

export interface RunStateVm {
  status: 'idle' | 'running' | 'error';
  elapsedMs: number | null;
}

const IDLE: RunStateVm = { status: 'idle', elapsedMs: null };

// LAW 12: a ring + elapsed time in the toolbar that started the work — never a bar across the
// view. Idle keeps the last op's duration in the same slot instead of blanking it, so the
// toolbar never reflows when the next run starts. Driven by the most recent op for this tab
// (opsState is already live-streamed via control.onOpUpdate).
export function useRunState(tabId: () => string | null | undefined): ComputedRef<RunStateVm> {
  return computed(() => {
    const id = tabId();
    if (!id) return IDLE;
    // P43 iter2 F14/D19: opsState.records is newest-started-first (state/ops.ts), so a plain
    // `.find` picks whichever of two concurrent ops on the same tab started last — a fast op
    // (e.g. a page read) finishing first then reads as "idle" while a slower sibling (e.g. Σ) is
    // still running, and the toolbar's ring goes dark mid-query. Preferring a running record over
    // any newer finished one answers the question the ring actually asks: is *anything* for this
    // tab still waiting on the server. Falls back to the newest record when none is running, so
    // the idle slot's duration is unchanged from before.
    const record =
      opsState.records.find((r) => r.tabId === id && r.status === 'running') ??
      opsState.records.find((r) => r.tabId === id);
    if (!record) return IDLE;
    if (record.status === 'running') {
      return { status: 'running', elapsedMs: now.value - new Date(record.startedAt).getTime() };
    }
    if (record.status === 'error') return { status: 'error', elapsedMs: record.durationMs };
    return { status: 'idle', elapsedMs: record.durationMs };
  });
}
