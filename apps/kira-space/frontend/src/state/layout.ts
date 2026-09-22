import { defaultLayout, type Layout, type LayoutPatch } from '@shared/domain/layout';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

// P100 Part 2: Kira Studio's own state/layout.ts, ported unchanged — Layout is the one shared
// schema (@shared/domain/layout); `panel.project` is this app's own left panel (GitPanel.vue's
// repo switcher + Files/Search/Review body), the one leaf this app's UI actually reads or writes.
// `panel.operations`/`panel.cellEditor` have no view here (no ops log, no cell editor) but stay in
// the shared Layout shape and round-trip through this store untouched, the same "state stays fully
// populated even where this app's own UI never surfaces it" posture state/settings.ts takes.
const WRITE_DEBOUNCE_MS = 150;

export const useLayoutStore = defineStore('layout', () => {
  const state = reactive<Layout>(structuredClone(defaultLayout));

  let pendingPatch: LayoutPatch = {};
  const flushWrite = useDebounceFn(() => {
    const toSend = pendingPatch;
    pendingPatch = {};
    void control.layoutSet(toSend);
  }, WRITE_DEBOUNCE_MS);

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

  function setProjectWidth(width: number): void {
    patchLayout({ panel: { project: { width, widthUserSet: true } } });
  }

  /** C11 §14 OQ2 (S14): the review segment's first-activation widen — only when the user has
   *  never manually resized the panel (setProjectWidth above is the sole thing that ever sets
   *  widthUserSet), and only when the current width is already narrower than `minWidth`. */
  function ensureReviewPanelWidth(minWidth: number): void {
    const project = state.panel.project;
    if (project.widthUserSet || project.width >= minWidth) return;
    patchLayout({ panel: { project: { width: minWidth } } });
  }

  return {
    ...toRefs(state),
    hydrateLayout,
    toggleProjectPanel,
    setProjectWidth,
    ensureReviewPanelWidth,
  };
});
