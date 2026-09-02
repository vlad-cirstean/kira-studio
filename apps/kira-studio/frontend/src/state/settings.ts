import { defaultSettings, type Settings, type SettingsPatch } from '@shared/domain/settings';
import { reactive, ref } from 'vue';
import { control } from '../bridge/control';

// Moved here from renderer/workbench/state/settings.ts (D20) — P2 is the phase that both
// touches every section of Settings and makes it cross-view: views/grid/ reads
// data.defaultPageSize, which a view reaching up into workbench/ would invert §11's
// dependency direction.
export const settingsState = reactive<Settings>(structuredClone(defaultSettings));
export const settingsOpen = ref(false);

// P31 D11: bumped by applyAppearance() below. A component that measures text against
// --kira-font-family (the grid's column widths, views/shared/page/columns.ts's memoized measuring
// context) takes this as an explicit reactive dependency so a font change re-measures instead of
// reusing widths sized for whatever font was active when the module first measured. Lives here,
// not in views/shared/page/columns.ts, so this module never has to import upward into views/* (§11).
export const appearanceVersion = reactive({ n: 0 });

function applyAppearance(): void {
  const root = document.documentElement.style;
  root.setProperty('--kira-font-family', settingsState.appearance.fontFamily);
  root.setProperty('--kira-font-size', `${settingsState.appearance.fontSize}px`);
  root.setProperty(
    '--kira-row-height',
    settingsState.appearance.rowDensity === 'compact' ? '22px' : '28px',
  );
  appearanceVersion.n++;
}

let unsubscribeChanged: (() => void) | null = null;

function applySettings(settings: Settings): void {
  Object.assign(settingsState.appearance, settings.appearance);
  Object.assign(settingsState.data, settings.data);
  Object.assign(settingsState.cache, settings.cache);
  Object.assign(settingsState.advanced, settings.advanced);
  applyAppearance();
}

export async function hydrateSettings(): Promise<void> {
  applySettings(await control.settingsGetAll());

  // Covers a settings change made through any path other than this module's own patchSettings()
  // below (e.g. a direct IPC call) — the same gap connections.ts's onConnectionsChanged closes
  // for the connections list.
  unsubscribeChanged?.();
  unsubscribeChanged = control.onSettingsChanged(applySettings);
}

// P12 round 1 finding #9: this used to apply `patch` to settingsState (and call applyAppearance())
// *before* awaiting control.settingsSet — a leftover from the pre-P17 apply-immediately dialog.
// P17 moved to stage-until-Save, and SettingsDialog.vue's onSave is now the only caller, so
// nothing needs a live preview any more; the pre-apply was left with no rollback path. If the
// backend rejected the patch, the dialog correctly showed an error and stayed open, but the
// change was already live in this window with no kira:settings:changed broadcast, so every other
// window and the database kept the old value — divergent until relaunch. Apply only what the
// backend actually confirms, once, on success; the round trip is local SQLite, so there is no
// real latency cost to waiting for it.
export async function patchSettings(patch: SettingsPatch): Promise<void> {
  const updated = await control.settingsSet(patch);
  applySettings(updated);
}
