import { defaultLayout, type Layout, type LayoutPatch } from '@shared/domain/layout';
import { reactive } from 'vue';
import { control } from '../bridge/control';

const WRITE_DEBOUNCE_MS = 150;

export const layoutState = reactive<Layout>(structuredClone(defaultLayout));

let pendingPatch: LayoutPatch = {};
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export async function hydrateLayout(): Promise<void> {
  const layout = await control.layoutGetAll();
  Object.assign(layoutState, layout);
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
