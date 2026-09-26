import type { SettingsPaneProps as GenericSettingsPaneProps } from '@workbench/components/settingsPaneProps';
import type { Settings } from '../../state/settingsDomain';

// P103 Part 2 (§5.5): the one prop contract every one of this app's four settings panes takes,
// factored out once rather than repeated four times (CLAUDE.md's "code never duplicates") — the
// exact shape SettingsShell.vue's own `#pane` scoped slot hands each pane, plus `active` (this
// app's own `workbench/SettingsDialog.vue` wrapper binds it per pane, `activeSection === '<Section>'`).
//
// `draft` is typed against the full shared `Settings` (not the narrower `Pick<Settings,
// 'appearance'|'advanced'|'git'>` the original single-file component used): SettingsShell.vue is
// generic over whatever `current`/`defaults` shape the app passes it, and this app's own thin
// wrapper narrows to that same `Pick<…>` at the `<SettingsShell>` call site — every pane only ever
// reads the three sections it always has, so the wider prop type costs nothing at the pane level.
type SettingsSections = Pick<Settings, 'appearance' | 'advanced' | 'git'>;

// P115 H9: this app and Kira Studio each declared the identical SettingsPaneProps interface,
// differing only in SettingsSections' own Pick — both now instantiate the shared generic instead.
export type SettingsPaneProps = GenericSettingsPaneProps<SettingsSections>;
