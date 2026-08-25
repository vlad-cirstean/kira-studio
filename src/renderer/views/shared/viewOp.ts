import { reactive } from 'vue';
import { control } from '../../bridge/control';

// P39 F12/F13: grid/state.ts, documents/state.ts, keyvalue/state.ts, stream/state.ts and
// console/state.ts each declared the same DISCONNECTED_CODES set and the same code/message
// extraction, and a byte-identical stop(). The reaction genuinely differs per caller (console's
// disconnected branch additionally sets `status = 'idle'` before unmarkHydrated, for a reason its
// own comment records) — classifyLoadError() returns a classification rather than performing the
// reaction, so every caller keeps its own exact lines.
const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

export interface LoadFailure {
  kind: 'cancelled' | 'disconnected' | 'error';
  code: string;
  message: string;
}

export function classifyLoadError(err: unknown): LoadFailure {
  const code = (err as { code?: string } | undefined)?.code ?? 'E_QUERY';
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'E_CANCELLED') return { kind: 'cancelled', code, message };
  if (DISCONNECTED_CODES.has(code)) return { kind: 'disconnected', code, message };
  return { kind: 'error', code, message };
}

/** `control.opsCancel(rt.opId)` when there is one — the body all five `stop()` functions share. */
export function stopOp(rt: { opId: string | null } | undefined): void {
  if (rt?.opId) void control.opsCancel(rt.opId);
}

/** The per-tab runtime record every view state module keeps, plus the one accessor that creates
 *  it (P39 iter3 F10/D11). `runtime` is reactive() — Vue only wraps a nested plain object in its
 *  own reactive proxy when it's read back out through the parent proxy. `ensureRuntime` therefore
 *  re-reads `runtime[tabId]` rather than returning the object it just created: handing a caller
 *  that unwrapped local reference directly would mean every mutation made afterward (status,
 *  hasMore, tokens, ...) bypasses the proxy's `set` trap entirely, so no dependent render (e.g. a
 *  pager button's `disabled` binding) would ever be notified. Each view keeps its own
 *  `registerTabRuntimeCleanup` call — the cleanup body genuinely differs (console's also clears
 *  `results`) — and its own `defaultRuntime()`, since the six runtime shapes differ. */
export function createRuntimeStore<R>(makeDefault: () => R): {
  runtime: Record<string, R>;
  ensureRuntime(tabId: string): R;
} {
  const runtime = reactive({} as Record<string, R>);

  function ensureRuntime(tabId: string): R {
    if (!runtime[tabId]) {
      runtime[tabId] = makeDefault();
    }
    return runtime[tabId];
  }

  return { runtime, ensureRuntime };
}
