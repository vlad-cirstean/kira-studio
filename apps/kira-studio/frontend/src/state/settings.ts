import { defaultSettings, type Settings, type SettingsPatch } from '@shared/domain/settings';
import { reactive, ref } from 'vue';
import { control } from '../bridge/control';

// Moved here from renderer/workbench/state/settings.ts (D20) — P2 is the phase that both
// touches every section of Settings and makes it cross-view: views/grid/ reads
// data.defaultPageSize, which a view reaching up into workbench/ would invert §11's
// dependency direction.
export const settingsState = reactive<Settings>(structuredClone(defaultSettings));
export const settingsOpen = ref(false);

// P85 §10.1: moved out of SettingsDialog.vue so `Manage scripts…` (TabStrip.vue, workbench/) can
// deep-link to the Scripts section without SettingsDialog.vue itself in scope — a workbench/ ->
// state/ read, the direction this app's layering already permits. G12 D9's own reasoning for the
// list is unchanged: 'Connected editors' and 'Code intelligence'/'Database MCP' each bypass
// draft/Save for their own stated reason; 'Scripts' joins them for the same reason (§10.1: a CRUD
// section, not a staged leaf); P86 §9.3's 'Claude Code' joins them too, an instant on/off switch
// exactly like 'Code intelligence'/'Database MCP'.
export const sections = [
  'Appearance',
  'Data',
  'Cache',
  'Api',
  'Connected editors',
  'Git',
  'Scripts',
  'Claude Code',
  'Code intelligence',
  'Database MCP',
  'Advanced',
] as const;
export type Section = (typeof sections)[number];

// null: no deep link pending — SettingsDialog.vue falls back to 'Appearance'. Set by
// openSettingsAt below, read once on the dialog's own mount, and cleared when it unmounts so a
// later plain open (TitleBar.vue's gear icon, the command palette) never inherits a stale section.
export const settingsSection = ref<Section | null>(null);

/** TabStrip.vue's "Manage scripts…" — opens Settings already switched to `section`, api/menus.ts's
 *  own `Environments…` precedent restated for a section instead of a whole dialog. */
export function openSettingsAt(section: Section): void {
  settingsSection.value = section;
  settingsOpen.value = true;
}

// P31 D11: bumped by applyAppearance() below. A component that measures text against
// --kira-font-data (the grid's column widths, views/shared/page/columns.ts's memoized measuring
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
  Object.assign(settingsState.git, settings.git);
  Object.assign(settingsState.api, settings.api);
  Object.assign(settingsState.codeIntel, settings.codeIntel);
  Object.assign(settingsState.dbMcp, settings.dbMcp);
  Object.assign(settingsState.claudeCode, settings.claudeCode);
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
