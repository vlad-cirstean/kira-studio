import { defaultLayout, type Layout, type LayoutPatch } from '@shared/domain/layout';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

const WRITE_DEBOUNCE_MS = 150;

export const useLayoutStore = defineStore('layout', () => {
  const state = reactive<Layout>(structuredClone(defaultLayout));

  let pendingPatch: LayoutPatch = {};
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  // applyRemote assigns a layout straight into local state with no re-emit back to control.layoutSet
  // — the same shape state/settings.ts's own applySettings/onSettingsChanged uses. It is what makes
  // panel layout genuinely app-wide (P8 D3/F7's second half) rather than merely silent: before this,
  // window A resizing the project panel left every other window showing the old width until relaunch.
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
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const toSend = pendingPatch;
      pendingPatch = {};
      writeTimer = null;
      void control.layoutSet(toSend);
    }, WRITE_DEBOUNCE_MS);
  }

  function toggleProjectPanel(): void {
    patchLayout({ panel: { project: { visible: !state.panel.project.visible } } });
  }

  function toggleOperationsPanel(): void {
    patchLayout({ panel: { operations: { visible: !state.panel.operations.visible } } });
  }

  // C11 §14 OQ2: this is the panel's own resize handle (WorkbenchShell.vue's `@resize`) — its only
  // call site — so a call here is always a real user drag. Sets widthUserSet alongside width so
  // ensureReviewPanelWidth below never widens a panel the user has already sized for themselves.
  function setProjectWidth(width: number): void {
    patchLayout({ panel: { project: { width, widthUserSet: true } } });
  }

  /** C11 §14 OQ2 (S14): the review segment's first-activation widen — only when the user has never
   *  manually resized the panel (setProjectWidth above is the sole thing that ever sets
   *  widthUserSet), and only when the current width is already narrower than `minWidth`. Never
   *  touches widthUserSet itself: this is Kira widening its own default, not the user resizing it,
   *  so a later genuine drag is still the first one recorded. */
  function ensureReviewPanelWidth(minWidth: number): void {
    const project = state.panel.project;
    if (project.widthUserSet || project.width >= minWidth) return;
    patchLayout({ panel: { project: { width: minWidth } } });
  }

  function setCellEditorHeight(height: number): void {
    patchLayout({ panel: { cellEditor: { height } } });
  }

  function setOperationsHeight(height: number): void {
    patchLayout({ panel: { operations: { height } } });
  }

  return {
    ...toRefs(state),
    hydrateLayout,
    toggleProjectPanel,
    toggleOperationsPanel,
    setProjectWidth,
    ensureReviewPanelWidth,
    setCellEditorHeight,
    setOperationsHeight,
  };
});
