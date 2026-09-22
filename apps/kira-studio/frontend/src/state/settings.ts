import { createSettingsStore } from '@workbench/state/createSettingsStore';
import { reactive } from 'vue';
import { control } from '../bridge/control';

// P85 §10.1: moved out of SettingsDialog.vue so `Manage scripts…` (TabStrip.vue, workbench/) can
// deep-link to the Scripts section without SettingsDialog.vue itself in scope — a workbench/ ->
// state/ read, the direction this app's layering already permits. G12 D9's own reasoning for the
// list is unchanged: 'Database MCP' bypasses draft/Save for its own stated reason; 'Scripts' joins
// it for the same reason (§10.1: a CRUD section, not a staged leaf); P86 §9.3's 'Claude Code' joins
// them too, an instant on/off switch exactly like 'Database MCP'.
// P100 Part 2: 'Connected editors' (git.sock VS Code pairing, state/gitClients.ts) and 'Git' (git
// remote-op/graph settings) both moved to apps/kira-space wholesale along with the repo workspace
// they configured.
export const sections = [
  'Appearance',
  'Data',
  'Cache',
  'Api',
  'Scripts',
  'Claude Code',
  'Database MCP',
  'Advanced',
] as const;
export type Section = (typeof sections)[number];

// P103 Part 2 (§5.3): the shared skeleton now lives in
// packages/workbench/src/state/createSettingsStore.ts. `appearanceVersion` — the measured-text
// re-measure signal views/shared/page/columns.ts takes as an explicit reactive dependency, so a
// font change re-measures instead of reusing widths sized for whatever font was active when the
// module first measured — is this app's own extra; Kira Space has no data grid to re-measure.
export const useSettingsStore = createSettingsStore<Section>()(control, () => {
  const appearanceVersion = reactive({ n: 0 });
  return {
    extra: { appearanceVersion },
    onApplyAppearance: () => {
      appearanceVersion.n++;
    },
  };
});
