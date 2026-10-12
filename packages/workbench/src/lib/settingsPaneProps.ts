import type { ComputedRef, Ref } from 'vue';

// P103 Part 2 (§5.5): the one prop contract every settings pane in both apps takes — the exact
// shape SettingsShell.vue's own `#pane` scoped slot hands each pane, plus `active` (each app's own
// `workbench/SettingsDialog.vue` wrapper binds it per pane, `activeSection === '<Section>'`).
// Generic over `S` (P115 H9): both apps' own `workbench/settings/types.ts` declared this exact
// interface, differing only in which `Settings` sections their own `SettingsSections` picks — each
// now instantiates this generic with its own `SettingsSections` instead.
export interface SettingsPaneProps<S extends Record<string, Record<string, unknown>>> {
  active: boolean;
  draft: S;
  isAtDefault: <Section extends keyof S, Key extends keyof S[Section]>(
    s: Section,
    k: Key,
  ) => boolean;
  resetLeaf: <Section extends keyof S, Key extends keyof S[Section]>(s: Section, k: Key) => void;
  registerFieldError: (id: string, error: Ref<string | null> | ComputedRef<string | null>) => void;
}
