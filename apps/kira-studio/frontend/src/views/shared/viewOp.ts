import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { unmarkHydrated } from '../../state/tabs';

// P39 F12/F13: grid/state.ts, documents/state.ts, keyvalue/state.ts, stream/state.ts and
// console/state.ts each declared the same DISCONNECTED_CODES set and the same code/message
// extraction, and a byte-identical stop(). The reaction genuinely differs per caller (console's
// disconnected branch additionally sets `status = 'idle'` before unmarkHydrated, for a reason its
// own comment records) — classifyLoadError() returns a classification rather than performing the
// reaction, so every caller keeps its own exact lines.
//
// Item 4 (task batch P46-2): E_NOT_FOUND used to sit in this set alongside E_ENGINE_DOWN, on the
// theory that "not found" meant "the connection is gone". It doesn't — several adapters also throw
// E_NOT_FOUND for an ordinary query-time condition against a perfectly live connection (an unknown
// column in a stale projection/sort, a dropped table, a bad path segment), and reload()/reload-
// after-refresh code paths were hitting exactly that, unmarking hydration and popping the
// Reconnect & load gate over a table whose connection had never actually dropped. data.ts's/
// control.ts's own "no active adapter" throw is the one true "connection is gone" signal, and now
// carries E_ENGINE_DOWN, not E_NOT_FOUND, so this set no longer needs to (and must not) treat every
// not-found as a disconnect.
const DISCONNECTED_CODES = new Set(['E_ENGINE_DOWN', 'E_CONNECT']);

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
type HasActionError = { actionError: string | null };
type HasSearchOpen = { searchOpen: boolean };

// P48 F15/F16: setActionError (five identical four-line functions) and the search-open toggle
// (five onToggleSearch, four onCloseSearch copies) both reduce to "read/write one field on this
// tab's runtime" — the same shape ensureRuntime's own record already owns. The three setters below
// are conditionally present on the returned object, keyed off whether R actually carries the
// field: browse's runtime has actionError but no searchOpen (no find toolbar), console's has
// searchOpen but no actionError (nothing to mutate) — a store built over either type only ever
// exposes the setters that field supports, so calling the wrong one is a type error, not a no-op.
export function createRuntimeStore<R>(makeDefault: () => R): {
  runtime: Record<string, R>;
  ensureRuntime(tabId: string): R;
} & (R extends HasActionError
  ? { setActionError(tabId: string, message: string | null): void }
  : object) &
  (R extends HasSearchOpen
    ? { toggleSearchOpen(tabId: string): void; setSearchOpen(tabId: string, open: boolean): void }
    : object) {
  const runtime = reactive({} as Record<string, R>);

  function ensureRuntime(tabId: string): R {
    if (!runtime[tabId]) {
      runtime[tabId] = makeDefault();
    }
    return runtime[tabId];
  }

  function setActionError(tabId: string, message: string | null): void {
    const rt = runtime[tabId] as unknown as HasActionError | undefined;
    if (rt) rt.actionError = message;
  }

  function toggleSearchOpen(tabId: string): void {
    const rt = runtime[tabId] as unknown as HasSearchOpen | undefined;
    if (rt) rt.searchOpen = !rt.searchOpen;
  }

  function setSearchOpen(tabId: string, open: boolean): void {
    const rt = runtime[tabId] as unknown as HasSearchOpen | undefined;
    if (rt) rt.searchOpen = open;
  }

  return { runtime, ensureRuntime, setActionError, toggleSearchOpen, setSearchOpen } as never;
}

interface OpPreambleRuntime {
  status: string;
  opId: string | null;
  error: { code: string; message: string } | null;
  actionError: string | null;
}

// P48 F14: the op-start preamble — status/opId/error/actionError, after a crypto.randomUUID() —
// byte-identical across grid/documents/keyvalue/stream's state.ts. Returns the op id it stamped,
// for the caller's own request and its `if (rt.opId !== opId) return` supersession checks.
export function beginOp(rt: OpPreambleRuntime): string {
  const opId = crypto.randomUUID();
  rt.status = 'loading';
  rt.opId = opId;
  rt.error = null;
  rt.actionError = null;
  return opId;
}

interface LoadFailureRuntime {
  status: string;
  opId: string | null;
  error: { code: string; message: string } | null;
}

// P48 F14: the four-view failure tail, accrued one level past P39's own classifyLoadError
// extraction — cancelled/disconnected/error react identically in grid/documents/keyvalue/stream's
// state.ts, and now in console/state.ts too via `onDisconnected`, the one extra line
// (`rt.status = 'idle'`) its own disconnected branch needs before unmarkHydrated (its own comment
// explains why: left at 'running', the Stop button would come back permanently red).
export function applyLoadFailure(
  rt: LoadFailureRuntime,
  opId: string,
  err: unknown,
  tabId: string,
  opts?: { onDisconnected?(): void },
): void {
  if (rt.opId !== opId) return;
  rt.opId = null;
  const failure = classifyLoadError(err);
  if (failure.kind === 'cancelled') {
    rt.status = 'cancelled';
    return;
  }
  if (failure.kind === 'disconnected') {
    opts?.onDisconnected?.();
    unmarkHydrated(tabId);
    return;
  }
  rt.status = 'error';
  rt.error = { code: failure.code, message: failure.message };
}
