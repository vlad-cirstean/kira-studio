import { defaultSettings, type Settings, type SettingsPatch } from '@shared/settings';
import { reactive } from 'vue';
import { control } from '../../bridge/control';

export const settingsState = reactive<Settings>(structuredClone(defaultSettings));

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
  applyAppearance();
}

export async function patchSettings(patch: SettingsPatch): Promise<void> {
  if (patch.appearance) Object.assign(settingsState.appearance, patch.appearance);
  applyAppearance();
  const updated = await control.settingsSet(patch);
  Object.assign(settingsState.appearance, updated.appearance);
  applyAppearance();
}
