import {
  defaultLayout,
  defaultPanelSizes,
  type Layout,
  type LayoutPatch,
  type PanelSizes,
} from '@shared/domain/layout';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { TIMING } from '../behaviour/timing';
import { fireAndForget } from '../bridge/fireAndForget';
import { hydrateThenSubscribe } from './hydrateThenSubscribe';

// The two apps' cores were already identical — `Layout` (the one shared schema,
// @shared/domain/layout) carries panel.operations/panel.cellEditor for both apps regardless of
// which UI surfaces them.
//
// toggleOperationsPanel/setOperationsHeight moved into the core return below — Kira Space gets its
// own Operations dock, so both apps' stores expose them now. Studio's `extend` keeps only
// setCellEditorHeight; Space's `() => ({})` is unchanged and now exposes both through the core.

export interface LayoutControl {
  layoutSet(patch: LayoutPatch): Promise<Layout>;
  layoutGetAll(): Promise<Layout>;
  onLayoutChanged(cb: (layout: Layout) => void): () => void;
}

export interface LayoutStoreActions {
  state: Layout;
  patchLayout(patch: LayoutPatch): void;
}

// `extend` is required, even for a caller with nothing to add (`() => ({})`) — a call that
// leaves `E` at its default with no argument to infer it from breaks Pinia's own action/state
// extraction for the whole store. See createTabsStore.ts's own `extend` doc for the full story.
export function createLayoutStore<E extends Record<string, unknown> = Record<string, never>>(
  control: LayoutControl,
  extend: (actions: LayoutStoreActions) => E,
) {
  return defineStore('layout', () => {
    const state = reactive<Layout>(structuredClone(defaultLayout));

    let pendingPatch: LayoutPatch = {};
    // P99 §9.3: useDebounceFn replaces the hand-rolled clearTimeout/setTimeout pair this used to be
    // — flushWrite reads/clears the accumulated pendingPatch at fire time, same as before.
    const flushWrite = useDebounceFn(() => {
      const toSend = pendingPatch;
      pendingPatch = {};
      fireAndForget(control.layoutSet(toSend), 'layout');
    }, TIMING.persist);

    // applyRemote assigns a layout straight into local state with no re-emit back to
    // control.layoutSet — the same shape state/settings.ts's own applySettings/onSettingsChanged
    // uses. It is what makes panel layout genuinely app-wide rather than
    // merely silent: before this, window A resizing the project panel left every other window
    // showing the old width until relaunch.
    function applyRemote(layout: Layout): void {
      Object.assign(state.panel.project, layout.panel.project);
      Object.assign(state.panel.operations, layout.panel.operations);
      Object.assign(state.panel.cellEditor, layout.panel.cellEditor);
      for (const [mode, sizes] of Object.entries(layout.modes ?? {})) {
        const entry = modeEntry(mode);
        Object.assign(entry.project, sizes.project);
        Object.assign(entry.operations, sizes.operations);
      }
      // Go's `LayoutService.Set` broadcasts `layoutChanged` to every window, sender included.
      // A pause of TIMING.persist or more mid-resize lets that echo land here while a newer
      // local edit still sits unflushed in `pendingPatch` -- without reapplying it, the remote
      // value briefly wins and the panel visibly snaps back until the next flush. Local always
      // wins over a same-window echo of an older value.
      applyLocal(pendingPatch);
    }

    let unsubscribeChanged: (() => void) | null = null;

    async function hydrateLayout(): Promise<void> {
      unsubscribeChanged?.();
      unsubscribeChanged = null;
      unsubscribeChanged = await hydrateThenSubscribe({
        snapshot: () => control.layoutGetAll(),
        subscribe: (cb) => control.onLayoutChanged(cb),
        apply: applyRemote,
      });
    }

    function modeEntry(mode: string): PanelSizes {
      state.modes[mode] ??= structuredClone(defaultPanelSizes);
      return state.modes[mode];
    }

    // P312: panel sizes are per module; a size read for a mode never saved falls back to defaults.
    function sizesFor(mode: string): PanelSizes {
      return state.modes[mode] ?? defaultPanelSizes;
    }

    function mergeModes(a: LayoutPatch['modes'], b: LayoutPatch['modes']): LayoutPatch['modes'] {
      const merged: NonNullable<LayoutPatch['modes']> = {};
      for (const mode of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
        merged[mode] = {
          project: { ...a?.[mode]?.project, ...b?.[mode]?.project },
          operations: { ...a?.[mode]?.operations, ...b?.[mode]?.operations },
        };
      }
      return merged;
    }

    function mergePatch(a: LayoutPatch, b: LayoutPatch): LayoutPatch {
      return {
        modes: mergeModes(a.modes, b.modes),
        panel: {
          project: { ...a.panel?.project, ...b.panel?.project },
          operations: { ...a.panel?.operations, ...b.panel?.operations },
          cellEditor: { ...a.panel?.cellEditor, ...b.panel?.cellEditor },
        },
      };
    }

    function applyLocal(patch: LayoutPatch): void {
      Object.assign(state.panel.project, patch.panel?.project);
      Object.assign(state.panel.operations, patch.panel?.operations);
      Object.assign(state.panel.cellEditor, patch.panel?.cellEditor);
      for (const [mode, sizes] of Object.entries(patch.modes ?? {})) {
        const entry = modeEntry(mode);
        Object.assign(entry.project, sizes.project);
        Object.assign(entry.operations, sizes.operations);
      }
    }

    function patchLayout(patch: LayoutPatch): void {
      applyLocal(patch);
      pendingPatch = mergePatch(pendingPatch, patch);
      void flushWrite();
    }

    function toggleProjectPanel(): void {
      patchLayout({ panel: { project: { visible: !state.panel.project.visible } } });
    }

    // This is the panel's own resize handle (WorkbenchShell.vue's `@resize`) — its only call site —
    // so a call here is always a real user drag. Sets widthUserSet alongside width so
    // ensureReviewPanelWidth below never widens a panel the user has already sized for themselves.
    function setProjectWidth(mode: string, width: number): void {
      patchLayout({ modes: { [mode]: { project: { width, widthUserSet: true } } } });
    }

    /** The review segment's first-activation widen — only when the user has
     *  never manually resized the panel (setProjectWidth above is the sole thing that ever sets
     *  widthUserSet), and only when the current width is already narrower than `minWidth`. Never
     *  touches widthUserSet itself: this is Kira widening its own default, not the user resizing
     *  it, so a later genuine drag is still the first one recorded. */
    function ensureReviewPanelWidth(mode: string, minWidth: number): void {
      const { project } = sizesFor(mode);
      if (project.widthUserSet || project.width >= minWidth) return;
      patchLayout({ modes: { [mode]: { project: { width: minWidth } } } });
    }

    // P132 Part 1 (§2.5): hoisted from Studio's own state/layout.ts — the Operations panel's
    // toggle/height, now on the core so Kira Space's own dock (Part 2) can use them too.
    function toggleOperationsPanel(): void {
      patchLayout({ panel: { operations: { visible: !state.panel.operations.visible } } });
    }
    function showOperationsPanel(): void {
      if (!state.panel.operations.visible) toggleOperationsPanel();
    }
    function setOperationsHeight(mode: string, height: number): void {
      patchLayout({ modes: { [mode]: { operations: { height } } } });
    }

    const extra = extend({ state, patchLayout });

    return {
      ...toRefs(state),
      hydrateLayout,
      sizesFor,
      toggleProjectPanel,
      setProjectWidth,
      ensureReviewPanelWidth,
      toggleOperationsPanel,
      showOperationsPanel,
      setOperationsHeight,
      ...extra,
    };
  });
}
