import { defaultSettings, type Settings, type SettingsPatch } from '@shared/domain/settings';
import { defineStore } from 'pinia';
import { reactive, ref, toRefs } from 'vue';

// P103 Part 2 (§5.3): hoisted from Kira Studio's own state/settings.ts (P100 Part 2's comment on
// Kira Space's copy: "ported"). `sections`/`Section` stay per-app (each dialog surfaces a
// different subset of the one shared `Settings` schema — SettingsDialog.vue's own concern, not
// this store's), so this factory is generic over `S`, the app's own Section union.
//
// Kira Studio's own appearanceVersion bump (measured-text re-measure signal, columns.ts) has no
// equivalent in Kira Space (no data grid) — `extend`'s `onApplyAppearance` hook reproduces it
// without Kira Space's applyAppearance() carrying a counter nothing observes.

export interface SettingsControl {
  settingsGetAll(): Promise<Settings>;
  settingsSet(patch: SettingsPatch): Promise<Settings>;
  onSettingsChanged(cb: (settings: Settings) => void): () => void;
}

export interface SettingsStoreActions {
  settingsState: Settings;
}

export interface SettingsStoreExtension<E extends Record<string, unknown>> {
  extra: E;
  /** Called at the end of every applyAppearance(), after every CSS custom property is set. */
  onApplyAppearance?(): void;
}

// Curried on purpose: `S` (the app's Section union) has nothing to infer it from, so every call
// gives it explicitly — `createSettingsStore<Section>()`. Giving `E` explicitly too, alongside
// `S`, disables its own inference from the real `extend` argument (TypeScript's partial-explicit-
// type-argument rule applies across all of one call's type parameters, not just the ones given),
// which leaves `E` at its default with nothing to infer it from — and that breaks Pinia's own
// action/state extraction for the *whole* store (every instantiation, not just that one), a real
// TS+Pinia interaction found the hard way in P103 Part 2 (§5.3). The inner call takes no explicit
// type arguments at all, so `E` is always inferred fresh from `extend`'s actual return value.
export function createSettingsStore<S extends string>() {
  return <E extends Record<string, unknown>>(
    control: SettingsControl,
    extend: (actions: SettingsStoreActions) => SettingsStoreExtension<E>,
  ) =>
    defineStore('settings', () => {
      const settingsState = reactive<Settings>(structuredClone(defaultSettings));
      const settingsOpen = ref(false);

      // null: no deep link pending — SettingsDialog.vue falls back to 'Appearance'. Set by
      // openSettingsAt below, read once on the dialog's own mount, and cleared when it unmounts so a
      // later plain open (TitleBar.vue's gear icon, the command palette) never inherits a stale
      // section.
      const settingsSection = ref<S | null>(null);

      /** TabStrip.vue's "Manage scripts…" — opens Settings already switched to `section`,
       *  api/menus.ts's own `Environments…` precedent restated for a section instead of a whole
       *  dialog. */
      function openSettingsAt(section: S): void {
        settingsSection.value = section;
        settingsOpen.value = true;
      }

      const { extra, onApplyAppearance } = extend({ settingsState });

      function applyAppearance(): void {
        const root = document.documentElement.style;
        root.setProperty('--kira-font-family', settingsState.appearance.fontFamily);
        root.setProperty('--kira-font-size', `${settingsState.appearance.fontSize}px`);
        root.setProperty(
          '--kira-row-height',
          settingsState.appearance.rowDensity === 'compact' ? '22px' : '28px',
        );
        // P92 item 9: 0 = follow appearance.fontSize — vscode-bridge.css's own fallback
        // (var(--kira-graph-font-size, var(--kira-t-md))) is what "follow" actually means, so
        // removing the property (not writing 0px) is what lets that fallback apply.
        const graph = settingsState.git.graphFontSize;
        if (graph > 0) root.setProperty('--kira-graph-font-size', `${graph}px`);
        else root.removeProperty('--kira-graph-font-size');
        onApplyAppearance?.();
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

        // Covers a settings change made through any path other than this module's own
        // patchSettings() below (e.g. a direct IPC call) — the same gap connections.ts's
        // onConnectionsChanged closes for the connections list.
        unsubscribeChanged?.();
        unsubscribeChanged = control.onSettingsChanged(applySettings);
      }

      // P12 round 1 finding #9: applies `patch` only once the backend confirms it (settingsSet's
      // own resolved value), never pre-applied — see Kira Studio's own git history for the rollback
      // gap that left other windows and the database diverged from a pre-applied, later-rejected
      // patch.
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
        ...extra,
      };
    });
}
