import { defaultSettings, type Settings, type SettingsPatch } from '@shared/settings';
import { reactive, ref } from 'vue';
import { control } from '../bridge/control';

// Moved here from renderer/workbench/state/settings.ts (D20) — P2 is the phase that both
// touches every section of Settings and makes it cross-view: views/grid/ reads
// data.defaultPageSize and data.prefetch, which a view reaching up into workbench/ would
// invert §11's dependency direction.
export const settingsState = reactive<Settings>(structuredClone(defaultSettings));
export const settingsOpen = ref(false);

export function applyAppearance(): void {
  const root = document.documentElement.style;
  root.setProperty('--kira-font-family', settingsState.appearance.fontFamily);
  root.setProperty('--kira-font-size', `${settingsState.appearance.fontSize}px`);
  root.setProperty(
    '--kira-row-height',
    settingsState.appearance.rowDensity === 'compact' ? '22px' : '28px',
  );
}

export async function hydrateSettings(): Promise<void> {
  const settings = await control.settingsGetAll();
  Object.assign(settingsState.appearance, settings.appearance);
  Object.assign(settingsState.data, settings.data);
  Object.assign(settingsState.cache, settings.cache);
  applyAppearance();
}

export async function patchSettings(patch: SettingsPatch): Promise<void> {
  if (patch.appearance) Object.assign(settingsState.appearance, patch.appearance);
  if (patch.data) Object.assign(settingsState.data, patch.data);
  if (patch.cache) Object.assign(settingsState.cache, patch.cache);
  applyAppearance();
  const updated = await control.settingsSet(patch);
  Object.assign(settingsState.appearance, updated.appearance);
  Object.assign(settingsState.data, updated.data);
  Object.assign(settingsState.cache, updated.cache);
  applyAppearance();
}
