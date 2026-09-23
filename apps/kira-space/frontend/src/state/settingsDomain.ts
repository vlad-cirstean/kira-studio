import {
  appearanceSettingsSchema,
  FETCH_AUTO_INTERVAL_MINUTES_RANGE,
  FONT_SIZE_RANGE,
  gitLogLevelSchema,
  gitSettingsSchema,
} from '@shared/domain/settings';
import { z } from 'zod';

// P103 Part 4 (§7.3): this app's own three-section settingsSchema/settingsPatchSchema/
// defaultSettings, split out of the former one shared `@shared/domain/settings` — this store used
// to carry Kira Studio's own data/cache/api/dbMcp/claudeCode sections dead (never populated by this
// app's own Go backend, apps/kira-space/internal/storage/model/settings.go), the same "tab-kind
// vocabulary" defect P103 Part 2 already fixed for tabs. appearance/git/gitLogLevel stay genuinely
// shared; FONT_SIZE_RANGE/FETCH_AUTO_INTERVAL_MINUTES_RANGE are the two this app's own GitPane
// reads directly, so those two re-export — the raw schema objects (appearanceSettingsSchema/
// gitLogLevelSchema/gitSettingsSchema/rowDensitySchema) and `GitSettings` stay import-only: nothing
// outside this file references them directly, every real consumer reads through the composed
// `Settings`/`SettingsPatch`/`defaultSettings` below. `AppearanceSettings`/`GitLogLevel`/
// `RowDensity` used to re-export here too; every pane now reads them straight from
// `@shared/domain/settings` via I2-18's shared field components (`FontSizeField.vue` etc.).
export { FETCH_AUTO_INTERVAL_MINUTES_RANGE, FONT_SIZE_RANGE };

// advanced carries just gitLogLevel here — this app's own diagnostic log verbosity, its entire
// `advanced` section (apps/kira-space/internal/storage/model/settings.go's own AdvancedSettings
// embeds appsettings.AdvancedCore for the same one leaf, P103 Part 4 §7.1). Not exported — nothing
// outside this file references the raw schema object or its own inferred type; AdvancedPane.vue
// reads the leaf's type through the shared `GitLogLevel` above instead.
const advancedSettingsSchema = /*#__PURE__*/ z.object({
  gitLogLevel: gitLogLevelSchema.default('info'),
});

// `.default(...)` on every section is load-bearing: an older kira-space.sqlite has a settings row
// with no `advanced`/`git` keys, and that row must still parse on next launch.
const settingsSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema,
  advanced: advancedSettingsSchema.default({ gitLogLevel: 'info' }),
  git: gitSettingsSchema.default({
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

const settingsPatchSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
  advanced: advancedSettingsSchema.partial().optional(),
  git: gitSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: 'Menlo, monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
    wordWrap: true,
    rowColoring: true,
    inlineBlame: true,
    dateFormat: 'relative',
  },
  advanced: {
    gitLogLevel: 'info',
  },
  git: {
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  },
};
