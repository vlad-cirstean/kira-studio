import { appearanceSettingsSchema, FONT_SIZE_RANGE, logLevelSchema } from '@shared/domain/settings';
import { z } from 'zod';

// P103 Part 4 (§7.3): this app's own three-section settingsSchema/settingsPatchSchema/
// defaultSettings, split out of the former one shared `@shared/domain/settings` — this store used
// to carry Kira Studio's own data/cache/api/dbMcp/claudeCode sections dead (never populated by this
// app's own Go backend, apps/kira-space/internal/storage/model/settings.go), the same "tab-kind
// vocabulary" defect P103 Part 2 already fixed for tabs. appearance/logLevel enum stay genuinely
// shared (this app's own leaf name stays `advanced.gitLogLevel`, P120); FONT_SIZE_RANGE is the one
// this app's own GitPane reads directly, so it re-exports; git is this app's own (P120: Kira Space
// is the only app with a git module) — its schema and `FETCH_AUTO_INTERVAL_MINUTES_RANGE` are
// defined below, not imported. The raw schema objects
// (appearanceSettingsSchema/logLevelSchema/rowDensitySchema) stay import-only: nothing outside
// this file references them directly, every real consumer reads through the composed
// `Settings`/`SettingsPatch`/`defaultSettings` below. `AppearanceSettings`/`LogLevel`/
// `RowDensity` used to re-export here too; every pane now reads them straight from
// `@shared/domain/settings` via I2-18's shared field components (`FontSizeField.vue` etc.).
export { FONT_SIZE_RANGE };

// G7 D16: minutes between automatic background fetches; 0 disables it.
export const FETCH_AUTO_INTERVAL_MINUTES_RANGE = { min: 0, max: 1440 } as const;

// G7 D16: server-owned — two windows disagreeing about either is a correctness/safety issue (a
// force-push confirmation only one window enforces, an auto-fetch cadence that differs per
// viewer), edited only in this dialog, never as a per-window VS Code setting. Not exported —
// nothing outside this file references the raw schema object; `Settings['git']` covers real
// consumers.
const gitSettingsSchema = /*#__PURE__*/ z.object({
  protectedBranches: z.array(z.string()).default(['main', 'master', 'release/*']),
  fetchAutoIntervalMinutes: z
    .number()
    .int()
    .min(FETCH_AUTO_INTERVAL_MINUTES_RANGE.min)
    .max(FETCH_AUTO_INTERVAL_MINUTES_RANGE.max)
    .default(0),
  // G18 D15: git.path was already classified server-owned (it answers "where is the git binary
  // on this machine", not a per-repo or per-window preference) but its wiring was dead until that
  // phase — a third leaf of this same trio, fixed the same way, not a redesign. Empty means "auto-
  // discover" (VS Code's own git.path, then PATH) — gitclient.Discovery's own existing contract.
  gitPath: z.string().default(''),
  // P92 item 9: 0 = follow appearance.fontSize. Reaches every embedded git-ui surface (graph,
  // diff, review) through --vscode-font-size, which nothing else in this app consumes.
  graphFontSize: z.number().int().min(0).max(FONT_SIZE_RANGE.max).default(0),
});

// advanced carries just gitLogLevel here — this app's own diagnostic log verbosity, its entire
// `advanced` section (apps/kira-space/internal/storage/model/settings.go's own AdvancedSettings
// embeds appsettings.AdvancedCore for the same one leaf, P103 Part 4 §7.1). Not exported — nothing
// outside this file references the raw schema object or its own inferred type; AdvancedPane.vue
// reads the leaf's type through the shared `LogLevel` above instead.
const advancedSettingsSchema = /*#__PURE__*/ z.object({
  gitLogLevel: logLevelSchema.default('info'),
});

// P120: inlineBlame/dateFormat are this app's own — the only app with a git module to show either
// in. `.extend(...)` on the shared appearanceSettingsSchema keeps the five shared leaves' own
// validation/defaults in one place.
const appSpaceAppearanceSettingsSchema = /*#__PURE__*/ appearanceSettingsSchema.extend({
  // P62: inline git-blame annotation at the end of the cursor's line in the repo file viewer.
  // `.default(true)` follows the same discipline as wordWrap/rowColoring above — a stored row
  // saved before this field existed hydrates with the annotation on.
  inlineBlame: z.boolean().default(true),
  // P72 §9.1: relative-vs-absolute commit timestamps in the git graph — moved here from the
  // per-repo RepoSettingsDialog.vue/PersistedViewState (a reading preference about the person, not
  // the repository, the same class as fontSize/fontFamily above). `.default('relative')` matches
  // PersistedViewState's own pre-existing default, so an existing stored settings row hydrates to
  // today's behavior.
  dateFormat: z.enum(['relative', 'absolute']).default('relative'),
});

// `.default(...)` on every section is load-bearing: an older kira-space.sqlite has a settings row
// with no `advanced`/`git` keys, and that row must still parse on next launch.
const settingsSchema = /*#__PURE__*/ z.object({
  appearance: appSpaceAppearanceSettingsSchema,
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
  appearance: appSpaceAppearanceSettingsSchema.partial().optional(),
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
