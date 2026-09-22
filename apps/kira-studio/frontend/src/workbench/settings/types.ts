import type { Settings } from '@shared/domain/settings';
import type { ComputedRef, Ref } from 'vue';

// P103 Part 2 (§5.5): the one prop contract every one of this app's eight settings panes takes,
// factored out once rather than repeated eight times (CLAUDE.md's "code never duplicates") — the
// exact shape SettingsShell.vue's own `#pane` scoped slot hands each pane, plus `active` (this
// app's own `workbench/SettingsDialog.vue` wrapper binds it per pane, `activeSection === '<Section>'`).
//
// `SettingsSections` — this dialog's own six sections of the full shared `Settings` (everything
// except `dbMcp`/`claudeCode`, which this dialog edits through their own instant-action controls,
// never through the draft) — is what SettingsShell.vue's own `T` generic is actually instantiated
// with at this app's `<SettingsShell>` call site (`workbench/SettingsDialog.vue`'s own `:current`/
// `:defaults`), so every pane's prop types must match that same narrowed shape, not the full
// `Settings` type, or Vue's generic prop inference rejects the binding.
type SettingsSections = Pick<
  Settings,
  'appearance' | 'data' | 'cache' | 'advanced' | 'git' | 'api'
>;

export interface SettingsPaneProps {
  active: boolean;
  draft: SettingsSections;
  isAtDefault: <S extends keyof SettingsSections, K extends keyof SettingsSections[S]>(
    s: S,
    k: K,
  ) => boolean;
  resetLeaf: <S extends keyof SettingsSections, K extends keyof SettingsSections[S]>(
    s: S,
    k: K,
  ) => void;
  registerFieldError: (id: string, error: Ref<string | null> | ComputedRef<string | null>) => void;
}
