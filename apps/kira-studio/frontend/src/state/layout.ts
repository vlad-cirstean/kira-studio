import { createLayoutStore } from '@workbench/state/createLayoutStore';
import { control } from '../bridge/control';

// P103 Part 2 (§5.3): the shared skeleton now lives in
// packages/workbench/src/state/createLayoutStore.ts. This app's own extras — the operations panel
// and cell editor height, neither of which Kira Space's UI has — are added through `extend`.
export const useLayoutStore = createLayoutStore(control, ({ state, patchLayout }) => ({
  toggleOperationsPanel(): void {
    patchLayout({ panel: { operations: { visible: !state.panel.operations.visible } } });
  },
  setCellEditorHeight(height: number): void {
    patchLayout({ panel: { cellEditor: { height } } });
  },
  setOperationsHeight(height: number): void {
    patchLayout({ panel: { operations: { height } } });
  },
}));
