import { onBeforeUnmount } from 'vue';

// I2-18: both apps' own workbench/SettingsDialog.vue clear the store's deep-link section on
// unmount, byte-identical — see §10.1: a later plain open (the gear icon, the command palette)
// must not inherit a deep link this instance was opened with.
export function useSettingsDeepLinkReset<S extends string>(store: {
  settingsSection: S | null;
}): void {
  onBeforeUnmount(() => {
    store.settingsSection = null;
  });
}
