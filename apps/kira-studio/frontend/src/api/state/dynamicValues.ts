import { reactive } from 'vue';

// P6 D11: the dynamic-values reference dialog's own open/close state — mirrors
// state/fakeData.ts's fakeDataDialogState shape (P15 D11), minus the tab identity that dialog
// carries: this one is read-only and global, not scoped to any particular tab.
export interface DynamicValuesDialogState {
  open: boolean;
}

export const dynamicValuesDialogState = reactive<DynamicValuesDialogState>({ open: false });

export function openDynamicValuesDialog(): void {
  dynamicValuesDialogState.open = true;
}

export function closeDynamicValuesDialog(): void {
  dynamicValuesDialogState.open = false;
}
