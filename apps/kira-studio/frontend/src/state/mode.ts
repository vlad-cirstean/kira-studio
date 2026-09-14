import type { AppMode } from '@shared/domain/mode';
import { TAB_KIND_MODE, type TabRecord } from '@shared/domain/tabs';
import type { WorkspaceKey } from '@shared/domain/workspace';
import { computed, reactive } from 'vue';
import { control } from '../bridge/control';
import { TAB_KINDS } from './tabKinds';
import { tabsState } from './tabs';
import { workspaceState } from './workspace';

// P1 D5: mode is a derived view over the one tab list, not a second state tree — the smallest
// thing that works. Switching mode touches no TabRecord, schedules no save, issues no IPC
// *synchronously*: it is a selection, so the two modes cannot drift, cannot double-persist, and
// cannot leak each other's tabs across a window. P22 D12 adds a debounced, eventually-persisted
// side effect (below) without disturbing that — `tests/ui/mode-switch.spec.ts`'s own "mode
// switching writes nothing" case still passes unchanged, since it counts tabsSave calls, not this.
export const modeState = reactive({ active: 'studio' as AppMode });

// P22 D12: which module a window was in, so it reopens into the same one. `windows.bounds_json`'s
// own persistence (internal/shell/window.go's Attach) is entirely native-event-driven
// (WindowDidResize/WindowDidMove) with no frontend IPC counterpart at all — there is no
// "on close" hook this module could piggyback on the way the row's other shutdown state suggests.
// So mode is pushed on every change instead, through the same debounced-writer shape
// state/layout.ts's own patchLayout uses: never a synchronous IPC per mode click (F20's own
// invariant — the one thing that must not happen), only an eventual one after the window has sat
// on a mode for a beat.
const MODE_WRITE_DEBOUNCE_MS = 150;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleModeWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void control.windowsSetMode(modeState.active);
  }, MODE_WRITE_DEBOUNCE_MS);
}

/** Called once at boot (main.ts's bootstrap, alongside hydrateLayout/hydrateSettings/…), before
 *  the app ever renders — sets the window's own persisted mode without going through `setMode`
 *  (hydration is not a user action, and must not re-schedule a write of the value it just read). */
export function hydrateMode(mode: AppMode): void {
  modeState.active = mode;
  // C5 §4.2: "workspaceState.active starts at the window's already-persisted mode" — a repo
  // workspace is never persisted, so boot always resolves to whichever of studio/api was stored.
  workspaceState.active = mode;
}

// P67b §4.2: persistence only — modeState/windows.mode (a three-value column since 'git' joined
// AppMode). Split out of setMode so a repo activation (state/workspace.ts's activateWorkspace) can
// persist 'git' as the window's module without also clobbering workspaceState.active back to the
// bare 'git' key and losing which repository was open.
export function setModule(mode: AppMode): void {
  modeState.active = mode;
  scheduleModeWrite();
}

// C5 §4.2: a module tab click — brings the workspace switcher to the same value, since
// studio/api/git are all valid WorkspaceKeys in their own right (git's bare form: no repo active).
export function setMode(mode: AppMode): void {
  setModule(mode);
  workspaceState.active = mode;
}

/** Every tab whose kind belongs to `mode` — what a mode's own tab strip renders. A repo tab can
 *  never match: TAB_KIND_MODE['repo-graph' | 'repo-file'] is the fixed sentinel `'repo'`, which is
 *  never equal to an AppMode (D2 — the isolation is enforced by the value, not only by this
 *  filter). Kept for any caller that only ever means "studio" or "api"; tabsForWorkspace below is
 *  the general form the tab strip itself now uses. */
export function tabsForMode(mode: AppMode): TabRecord[] {
  return tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
}

// C5 D2/§4.1: the actual workspace a tab belongs to — its own explicit workspaceId when set (every
// repo tab), else its kind's fixed mode (every studio/api tab, `null` today and forever unless a
// later phase adds per-connection isolation there too, §13). This one function is what replaces
// the mode filter at every read site tabsState used to scope by mode alone.
export function workspaceKeyOf(tab: TabRecord): WorkspaceKey {
  return (tab.workspaceId as WorkspaceKey | null) ?? (TAB_KIND_MODE[tab.kind] as AppMode);
}

/** Every tab in workspace `key` — tabsForMode's own generalisation, widened to a genuine stable
 *  partition (§6.1): every pinned-kind tab of `key` first (in their existing relative order), then
 *  the rest (ditto), regardless of where each sits in `tabsState.tabs`. Computed here rather than
 *  relied on as an insertion-order invariant, so the guarantee survives any past or future
 *  tab-insertion path (splice, restore, moveTab) without each one having to remember to preserve
 *  it. Two-pass filter/concat, not a comparator sort — a sort's stability is not a property to lean
 *  on here. */
export function tabsForWorkspace(key: WorkspaceKey): TabRecord[] {
  const pinned: TabRecord[] = [];
  const rest: TabRecord[] = [];
  for (const t of tabsState.tabs) {
    if (workspaceKeyOf(t) !== key) continue;
    (TAB_KINDS[t.kind].pinned ? pinned : rest).push(t);
  }
  return [...pinned, ...rest];
}

export const activeTab = computed<TabRecord | null>(() => {
  const id = tabsState.activeIdByWorkspace[workspaceState.active];
  return tabsState.tabs.find((t) => t.id === id) ?? null;
});
