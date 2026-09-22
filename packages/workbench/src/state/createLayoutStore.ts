import { defaultLayout, type Layout, type LayoutPatch } from '@shared/domain/layout';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// P103 Part 2 (§5.3): hoisted from Kira Studio's own state/layout.ts (P100 Part 2's comment on
// Kira Space's copy: "ported unchanged"). The two apps' cores were already identical — Kira
// Space's UI has no operations panel or cell editor, so its store never exposed
// toggleOperationsPanel/setCellEditorHeight/setOperationsHeight, even though `Layout` (the one
// shared schema, @shared/domain/layout) still carries those fields and round-trips them
// untouched. `extend` reproduces exactly that: Kira Space passes none, so its store's own public
// surface is unchanged from before this phase.

const WRITE_DEBOUNCE_MS = 150;

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
// extraction for the whole store, found the hard way in P103 Part 2 (§5.3). See
// createTabsStore.ts's own `extend` doc for the full story.
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
      void control.layoutSet(toSend);
    }, WRITE_DEBOUNCE_MS);

    // applyRemote assigns a layout straight into local state with no re-emit back to
    // control.layoutSet — the same shape state/settings.ts's own applySettings/onSettingsChanged
    // uses. It is what makes panel layout genuinely app-wide (P8 D3/F7's second half) rather than
    // merely silent: before this, window A resizing the project panel left every other window
    // showing the old width until relaunch.
    function applyRemote(layout: Layout): void {
      Object.assign(state.panel.project, layout.panel.project);
      Object.assign(state.panel.operations, layout.panel.operations);
      Object.assign(state.panel.cellEditor, layout.panel.cellEditor);
    }

    let unsubscribeChanged: (() => void) | null = null;

    async function hydrateLayout(): Promise<void> {
      applyRemote(await control.layoutGetAll());

      unsubscribeChanged?.();
      unsubscribeChanged = control.onLayoutChanged(applyRemote);
    }

    function mergePatch(a: LayoutPatch, b: LayoutPatch): LayoutPatch {
      return {
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
    }

    function patchLayout(patch: LayoutPatch): void {
      applyLocal(patch);
      pendingPatch = mergePatch(pendingPatch, patch);
      void flushWrite();
    }

    function toggleProjectPanel(): void {
      patchLayout({ panel: { project: { visible: !state.panel.project.visible } } });
    }

    // C11 §14 OQ2: this is the panel's own resize handle (WorkbenchShell.vue's `@resize`) — its
    // only call site — so a call here is always a real user drag. Sets widthUserSet alongside
    // width so ensureReviewPanelWidth below never widens a panel the user has already sized for
    // themselves.
    function setProjectWidth(width: number): void {
      patchLayout({ panel: { project: { width, widthUserSet: true } } });
    }

    /** C11 §14 OQ2 (S14): the review segment's first-activation widen — only when the user has
     *  never manually resized the panel (setProjectWidth above is the sole thing that ever sets
     *  widthUserSet), and only when the current width is already narrower than `minWidth`. Never
     *  touches widthUserSet itself: this is Kira widening its own default, not the user resizing
     *  it, so a later genuine drag is still the first one recorded. */
    function ensureReviewPanelWidth(minWidth: number): void {
      const project = state.panel.project;
      if (project.widthUserSet || project.width >= minWidth) return;
      patchLayout({ panel: { project: { width: minWidth } } });
    }

    const extra = extend({ state, patchLayout });

    return {
      ...toRefs(state),
      hydrateLayout,
      toggleProjectPanel,
      setProjectWidth,
      ensureReviewPanelWidth,
      ...extra,
    };
  });
}
