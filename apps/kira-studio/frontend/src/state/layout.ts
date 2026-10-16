import { createLayoutStore } from '@workbench/state/createLayoutStore';
import { control } from '../bridge/control';

// P103 Part 2 (§5.3): the shared skeleton now lives in
// packages/workbench/src/state/createLayoutStore.ts. P132 Part 1 (§2.5): toggleOperationsPanel/
// setOperationsHeight moved onto the core store — this app's only remaining extra is cell editor
// height, which Kira Space's UI has no cell editor to expose.
export const useLayoutStore = createLayoutStore(control, ({ patchLayout }) => ({
  setCellEditorHeight(height: number): void {
    patchLayout({ panel: { cellEditor: { height } } });
  },
}));
