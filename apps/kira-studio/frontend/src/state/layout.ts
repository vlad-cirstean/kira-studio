import { defaultLayout, type Layout, type LayoutPatch } from '@shared/domain/layout';
import { reactive } from 'vue';
import { control } from '../bridge/control';

const WRITE_DEBOUNCE_MS = 150;

export const layoutState = reactive<Layout>(structuredClone(defaultLayout));

let pendingPatch: LayoutPatch = {};
let writeTimer: ReturnType<typeof setTimeout> | null = null;

// applyRemote assigns a layout straight into local state with no re-emit back to control.layoutSet
// — the same shape state/settings.ts's own applySettings/onSettingsChanged uses. It is what makes
// panel layout genuinely app-wide (P8 D3/F7's second half) rather than merely silent: before this,
// window A resizing the project panel left every other window showing the old width until relaunch.
function applyRemote(layout: Layout): void {
  Object.assign(layoutState.panel.project, layout.panel.project);
  Object.assign(layoutState.panel.operations, layout.panel.operations);
  Object.assign(layoutState.panel.cellEditor, layout.panel.cellEditor);
}

let unsubscribeChanged: (() => void) | null = null;

export async function hydrateLayout(): Promise<void> {
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
  Object.assign(layoutState.panel.project, patch.panel?.project);
  Object.assign(layoutState.panel.operations, patch.panel?.operations);
  Object.assign(layoutState.panel.cellEditor, patch.panel?.cellEditor);
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

export function toggleProjectPanel(): void {
  patchLayout({ panel: { project: { visible: !layoutState.panel.project.visible } } });
}

export function toggleOperationsPanel(): void {
  patchLayout({ panel: { operations: { visible: !layoutState.panel.operations.visible } } });
}

export function setProjectWidth(width: number): void {
  patchLayout({ panel: { project: { width } } });
}

export function setCellEditorHeight(height: number): void {
  patchLayout({ panel: { cellEditor: { height } } });
}

export function setOperationsHeight(height: number): void {
  patchLayout({ panel: { operations: { height } } });
}
