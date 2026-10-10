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
// viewer), edited only in this dialog, never as a per-window setting. Not exported —
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
  // discover" (PATH lookup) — gitclient.Discovery's own existing contract.
  gitPath: z.string().default(''),
  // P92 item 9: 0 = follow appearance.fontSize. Reaches every embedded git-ui surface (graph,
  // diff, review) through --kira-graph-font-size (git-ui's theme/git.css graph scale).
  graphFontSize: z.number().int().min(0).max(FONT_SIZE_RANGE.max).default(0),
});

// advanced carries just gitLogLevel here — this app's own diagnostic log verbosity, its entire
// `advanced` section (apps/kira-space/internal/storage/model/settings.go's own AdvancedSettings
// embeds appsettings.AdvancedCore for the same one leaf, P103 Part 4 §7.1). Not exported — nothing
// outside this file references the raw schema object or its own inferred type; AdvancedPane.vue
// reads the leaf's type through the shared `LogLevel` above instead.
const advancedSettingsSchema = /*#__PURE__*/ z.object({
  gitLogLevel: logLevelSchema.default('info'),
  // P246: system notification when a popup waits in a window that is not in front.
  notifyPrompts: z.boolean().default(true),
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

// P129 Part 2 §7: Part 3's own queue-board UI prefs (panel width, planning-horizon window, calendar
// overrides), persisted as settings leaves rather than component state so they survive a relaunch.
// No UI reads these yet — Part 3 wires the queue board to them. Not exported — nothing outside this
// file references the raw schema object; `Settings['ade']` covers real consumers.
const ADE_PANEL_WIDTH_RANGE = { min: 340, max: 4000 } as const;
const ADE_HORIZON_DAYS_RANGE = { min: 1, max: 365 } as const;
const ADE_HISTORY_DAYS_RANGE = { min: 1, max: 365 } as const;
const ADE_WORKDAY_HOURS_RANGE = { min: 1, max: 24 } as const;
const ADE_SPAN_DAY_SHARE_RANGE = { min: 0.05, max: 1 } as const;
// §0.13 keeps at most 1000 override dates in any one list — well past what a calendar UI would ever
// need to page through, so it is a sanity ceiling, not a real limit.
const ADE_DATE_LIST_MAX = 1000;

const adeIsoDateSchema = /*#__PURE__*/ z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const adeDateListSchema = /*#__PURE__*/ z.array(adeIsoDateSchema).max(ADE_DATE_LIST_MAX);

const adeSettingsSchema = /*#__PURE__*/ z.object({
  // 0 = half the window's own width (Part 3's own layout default), 340..4000 an explicit drag.
  panelWidth: z
    .number()
    .int()
    .refine((v) => v === 0 || (v >= ADE_PANEL_WIDTH_RANGE.min && v <= ADE_PANEL_WIDTH_RANGE.max), {
      message: 'expected 0 or 340..4000',
    })
    .default(0),
  horizonDays: z
    .number()
    .int()
    .min(ADE_HORIZON_DAYS_RANGE.min)
    .max(ADE_HORIZON_DAYS_RANGE.max)
    .default(14),
  historyDays: z
    .number()
    .int()
    .min(ADE_HISTORY_DAYS_RANGE.min)
    .max(ADE_HISTORY_DAYS_RANGE.max)
    .default(14),
  extraDays: adeDateListSchema.default([]),
  offDays: adeDateListSchema.default([]),
  workWeekendDays: adeDateListSchema.default([]),
  workdayHours: z
    .number()
    .min(ADE_WORKDAY_HOURS_RANGE.min)
    .max(ADE_WORKDAY_HOURS_RANGE.max)
    .default(6),
  spanDayShare: z
    .number()
    .min(ADE_SPAN_DAY_SHARE_RANGE.min)
    .max(ADE_SPAN_DAY_SHARE_RANGE.max)
    .default(0.5),
  headlessSettingSources: z.enum(['user', 'all']).default('all'),
});

// P188: keep this Mac awake while any Claude Code session runs, independent of the title bar's own
// keep-awake toggle. Off by default — an OS power assertion is opt-in. Not exported, like the
// other raw section schemas.
const claudeCodeSettingsSchema = /*#__PURE__*/ z.object({
  keepAwakeWithAgents: z.boolean().default(false),
  // P238: desktop notifications. All on by default; notifyEnabled is the master switch.
  notifyEnabled: z.boolean().default(true),
  notifyOnFinished: z.boolean().default(true),
  notifyOnNeedsInput: z.boolean().default(true),
  notifyOnRunEnded: z.boolean().default(true),
  notifyIncludeMessage: z.boolean().default(true),
  // P239: Claude Code usage limits in the ADE status bar.
  usageEnabled: z.boolean().default(true),
});

// P212: the mobile agents web server. Off until enabled; the port is unprivileged. Changed
// through MobileAccessService, which restarts the server when it is running.
export const MOBILE_PORT_RANGE = { min: 1024, max: 65535 } as const;
const mobileSettingsSchema = /*#__PURE__*/ z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(MOBILE_PORT_RANGE.min).max(MOBILE_PORT_RANGE.max).default(7790),
  agentInput: z.boolean().default(false),
});

// `.default(...)` on every section is load-bearing: an older kira-space.sqlite has a settings row
// with no `advanced`/`git`/`ade`/`claudeCode` keys, and that row must still parse on next launch.
const settingsSchema = /*#__PURE__*/ z.object({
  appearance: appSpaceAppearanceSettingsSchema,
  advanced: advancedSettingsSchema.default({ gitLogLevel: 'info', notifyPrompts: true }),
  git: gitSettingsSchema.default({
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  }),
  ade: adeSettingsSchema.default({
    panelWidth: 0,
    horizonDays: 14,
    historyDays: 14,
    extraDays: [],
    offDays: [],
    workWeekendDays: [],
    workdayHours: 6,
    spanDayShare: 0.5,
    headlessSettingSources: 'all',
  }),
  claudeCode: claudeCodeSettingsSchema.default({
    keepAwakeWithAgents: false,
    notifyEnabled: true,
    notifyOnFinished: true,
    notifyOnNeedsInput: true,
    notifyOnRunEnded: true,
    notifyIncludeMessage: true,
    usageEnabled: true,
  }),
  mobile: mobileSettingsSchema.default({
    enabled: false,
    port: 7790,
    agentInput: false,
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

const settingsPatchSchema = /*#__PURE__*/ z.object({
  appearance: appSpaceAppearanceSettingsSchema.partial().optional(),
  advanced: advancedSettingsSchema.partial().optional(),
  git: gitSettingsSchema.partial().optional(),
  ade: adeSettingsSchema.partial().optional(),
  claudeCode: claudeCodeSettingsSchema.partial().optional(),
  mobile: mobileSettingsSchema.partial().optional(),
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
    notifyPrompts: true,
  },
  git: {
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  },
  ade: {
    panelWidth: 0,
    horizonDays: 14,
    historyDays: 14,
    extraDays: [],
    offDays: [],
    workWeekendDays: [],
    workdayHours: 6,
    spanDayShare: 0.5,
    headlessSettingSources: 'all',
  },
  claudeCode: {
    keepAwakeWithAgents: false,
    notifyEnabled: true,
    notifyOnFinished: true,
    notifyOnNeedsInput: true,
    notifyOnRunEnded: true,
    notifyIncludeMessage: true,
    usageEnabled: true,
  },
  mobile: {
    enabled: false,
    port: 7790,
    agentInput: false,
  },
};
