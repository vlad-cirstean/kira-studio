import { reactive } from 'vue';

// P15 D11: mirrors state/objectStore.ts's uploadDialogState shape — a tiny reactive open/close
// flag plus the one identity the dialog needs (the tab), so project/menus.ts-style callers (and
// the command-palette entry) never have to import a views/ module (§11's dependency rule). Every
// other fact the dialog needs — the tab's connection/path, its page's columns, its meta — is read
// live from the tab itself once open, not copied in here.
export interface FakeDataDialogState {
  open: boolean;
  tabId: string | null;
}

export const fakeDataDialogState = reactive<FakeDataDialogState>({ open: false, tabId: null });

export function openGenerateDataDialog(tabId: string): void {
  fakeDataDialogState.tabId = tabId;
  fakeDataDialogState.open = true;
}

export function closeGenerateDataDialog(): void {
  fakeDataDialogState.open = false;
}
