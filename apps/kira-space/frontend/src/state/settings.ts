import { defaultSettings, type Settings, type SettingsPatch } from '@shared/domain/settings';
import { defineStore } from 'pinia';
import { reactive, ref, toRefs } from 'vue';
import { control } from '../bridge/control';

// P100 Part 2: Kira Studio's own state/settings.ts, ported. Settings itself stays the one shared
// schema (@shared/domain/settings) — every section still round-trips through this store even
// though SettingsDialog.vue here (a small rewrite, not a port) surfaces only Appearance/Git/
// Connected editors/Advanced's own gitLogLevel leaf; the sections list below is this app's own
// dialog surface, not the full Settings shape.
export const sections = ['Appearance', 'Git', 'Connected editors', 'Advanced'] as const;
export type Section = (typeof sections)[number];

export const useSettingsStore = defineStore('settings', () => {
  const settingsState = reactive<Settings>(structuredClone(defaultSettings));
  const settingsOpen = ref(false);

  // null: no deep link pending — SettingsDialog.vue falls back to 'Appearance'.
  const settingsSection = ref<Section | null>(null);

  function openSettingsAt(section: Section): void {
    settingsSection.value = section;
    settingsOpen.value = true;
  }

  // Kira Studio's own appearanceVersion bump (measured-text re-measure signal, columns.ts) has no
  // equivalent view here (no data grid), so applyAppearance below only ever writes CSS custom
  // properties — no counter to bump for anything to observe.
  function applyAppearance(): void {
    const root = document.documentElement.style;
    root.setProperty('--kira-font-family', settingsState.appearance.fontFamily);
    root.setProperty('--kira-font-size', `${settingsState.appearance.fontSize}px`);
    root.setProperty(
      '--kira-row-height',
      settingsState.appearance.rowDensity === 'compact' ? '22px' : '28px',
    );
    // P92 item 9: 0 = follow appearance.fontSize — vscode-bridge.css's own fallback is what
    // "follow" actually means, so removing the property (not writing 0px) is what lets it apply.
    const graph = settingsState.git.graphFontSize;
    if (graph > 0) root.setProperty('--kira-graph-font-size', `${graph}px`);
    else root.removeProperty('--kira-graph-font-size');
  }

  let unsubscribeChanged: (() => void) | null = null;

  function applySettings(settings: Settings): void {
    Object.assign(settingsState.appearance, settings.appearance);
    Object.assign(settingsState.data, settings.data);
    Object.assign(settingsState.cache, settings.cache);
    Object.assign(settingsState.advanced, settings.advanced);
    Object.assign(settingsState.git, settings.git);
    Object.assign(settingsState.api, settings.api);
    Object.assign(settingsState.dbMcp, settings.dbMcp);
    Object.assign(settingsState.claudeCode, settings.claudeCode);
    applyAppearance();
  }

  async function hydrateSettings(): Promise<void> {
    applySettings(await control.settingsGetAll());

    unsubscribeChanged?.();
    unsubscribeChanged = control.onSettingsChanged(applySettings);
  }

  async function patchSettings(patch: SettingsPatch): Promise<void> {
    const updated = await control.settingsSet(patch);
    applySettings(updated);
  }

  return {
    ...toRefs(settingsState),
    settingsOpen,
    settingsSection,
    openSettingsAt,
    hydrateSettings,
    patchSettings,
  };
});
