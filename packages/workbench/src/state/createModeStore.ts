import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// P128 §2.3: hoisted from Kira Studio's own state/mode.ts — mode is this app's one-dimensional
// "which module" state, there is no second dimension layered on top of it.

// P22 D12: which module a window was in, so it reopens into the same one. `windows.bounds_json`'s
// own persistence (internal/shell/window.go's Attach) is entirely native-event-driven
// (WindowDidResize/WindowDidMove) with no frontend IPC counterpart at all — there is no "on close"
// hook this module could piggyback on the way the row's other shutdown state suggests. So mode is
// pushed on every change instead, through the same debounced-writer shape state/layout.ts's own
// patchLayout uses: never a synchronous IPC per mode click (F20's own invariant — the one thing
// that must not happen), only an eventual one after the window has sat on a mode for a beat.
const MODE_WRITE_DEBOUNCE_MS = 150;

export interface ModeControl<M extends string> {
  windowsSetMode(mode: M): Promise<void>;
  onFlushBeforeClose(cb: () => void): () => void;
  onWindowFlushBeforeClose(cb: () => void): () => void;
}

export interface ModeStoreActions<M extends string> {
  state: { active: M };
}

// `extend` is required, even for a caller with nothing to add (createKeepAwakeStore.ts's own
// pattern) — a call that leaves `E` uninferred breaks Pinia's action/state extraction for the whole
// store. Studio passes `activeTab` through it (state/mode.ts); Kira Space's own copy adds nothing.
export function createModeStore<
  M extends string,
  E extends Record<string, unknown> = Record<string, never>,
>(control: ModeControl<M>, defaultMode: M, extend: (actions: ModeStoreActions<M>) => E) {
  return defineStore('mode', () => {
    // `reactive<M>(...)` itself types as `UnwrapNestedRefs<{ active: M }>`, which TS can't prove
    // equals `{ active: M }` for a generic type parameter — the same gap createSettingsStore.ts's
    // own `reactive(...) as Se` cast covers. `M extends string` has no ref/computed leaf for
    // unwrapping to ever change, so the cast is exact, not a widening.
    const state = reactive({ active: defaultMode }) as { active: M };

    function writeMode(): void {
      void control.windowsSetMode(state.active);
    }

    // P99 §9.3: useDebounceFn replaces a hand-rolled clearTimeout/setTimeout pair.
    const scheduleModeWrite = useDebounceFn(writeMode, MODE_WRITE_DEBOUNCE_MS);

    // P108 Part 12 F13: a mode change within MODE_WRITE_DEBOUNCE_MS of the window closing must not
    // be lost — control.onFlushBeforeClose/onWindowFlushBeforeClose are the native "about to
    // close/quit" signals Go already blocks the close on (internal/shell/closeflush.go), reliable
    // across both the quit-handshake and per-window-close paths — unlike a browser `beforeunload`,
    // which this app's own Hide()-instead-of-Close() path for the last window never even fires.
    function flushModeWrite(): void {
      scheduleModeWrite.cancel();
      writeMode();
    }
    control.onFlushBeforeClose(flushModeWrite);
    control.onWindowFlushBeforeClose(flushModeWrite);

    /** Called once at boot (main.ts's bootstrap), before the app ever renders — sets the window's
     *  own persisted mode without going through `setMode` (hydration is not a user action, and must
     *  not re-schedule a write of the value it just read). */
    function hydrateMode(mode: M): void {
      state.active = mode;
    }

    // P67b §4.2: persistence only — modeState/windows.mode. setMode/setModule stay one function: no
    // second "which workspace inside the mode" dimension exists to clobber.
    function setMode(mode: M): void {
      state.active = mode;
      void scheduleModeWrite();
    }

    const extra = extend({ state });

    return { ...toRefs(state), hydrateMode, setMode, ...extra };
  });
}
