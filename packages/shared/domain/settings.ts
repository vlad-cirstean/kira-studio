import { z } from 'zod';

// P103 Part 4 (§7.3): trimmed to the sections genuinely shared between both apps' own
// settingsSchema — appearance, the gitLogLevel enum (both apps' own `advanced` section embeds it,
// alongside whatever else is app-only) and git. Everything app-only (data/cache/api/dbMcp/
// claudeCode, Kira Studio only) moved to each app's own frontend/src/state/settingsDomain.ts,
// which composes its own settingsSchema/settingsPatchSchema/defaultSettings out of this file's
// exports plus its own sections — the same split apps/*/internal/storage/model/settings.go already
// follows against internal/appsettings (§7.1).

export const rowDensitySchema = /*#__PURE__*/ z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

// P17 D6: the one numeric bound both apps' appearance/git panes read (input min/max attributes,
// the settings dialog's own validity check), as an exported constant so it's one number, not two
// hard-coded copies.
export const FONT_SIZE_RANGE = { min: 9, max: 24 } as const;
// G7 D16: minutes between automatic background fetches; 0 disables it.
export const FETCH_AUTO_INTERVAL_MINUTES_RANGE = { min: 0, max: 1440 } as const;

// P90 §2.1: genuinely shared, not merely parallel — domain/http.ts's own HttpRequestSettingsWire
// (Kira Studio's HTTP request builder, the only consumer of either) needs this enum from a shared
// package file, and a shared package may not import apps/*/frontend/src/state/settingsDomain.ts
// (CLAUDE.md's "a shared package never imports apps/*/internal/..." applies the same way to
// apps/*/frontend/src/state), so it stays here rather than moving into Kira Studio's own
// settingsDomain.ts with the rest of apiSettingsSchema.
export const HTTP_VERSIONS = ['1.1', '2'] as const;
export const httpVersionSchema = /*#__PURE__*/ z.enum(HTTP_VERSIONS);
export type HttpVersion = z.infer<typeof httpVersionSchema>;

export const appearanceSettingsSchema = /*#__PURE__*/ z.object({
  fontFamily: z.string(),
  // UI-only bound (FONT_SIZE_RANGE) — deliberately not enforced here, same discipline as
  // wordWrap/rowColoring's `.default(...)` below: an already-stored row outside 9-24 must still
  // hydrate.
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
  // P42 D14: word wrap in every CodeMirror surface (query console, Mongo console, cell editor,
  // definition view, ...). `.default(true)` is today's hard-coded behavior
  // (CodeMirrorHost.vue's own unconditional EditorView.lineWrapping, F11), so a settings row
  // saved before this field existed parses and behaves identically.
  wordWrap: z.boolean().default(true),
  // P9: colour grid cell text by the column's data type. `.default(true)` keeps a pre-P9 stored
  // shape parsing to today's behavior (colouring on).
  rowColoring: z.boolean().default(true),
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
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

// P72 §9.2/P103 Part 4 §7.1: the git graph's own diagnostic log verbosity enum — genuinely shared,
// not merely parallel, between Kira Studio's own `advanced.gitLogLevel` (alongside
// opLogRetentionDays/expensiveQueryRows, app-only) and Kira Space's `advanced` section (this one
// leaf, its entire content). Go's own appsettings.ValidLogLevel mirrors this same enum.
export const gitLogLevelSchema = /*#__PURE__*/ z.enum(['off', 'error', 'warn', 'info', 'debug']);
export type GitLogLevel = z.infer<typeof gitLogLevelSchema>;

// G7 D16: server-owned — two windows disagreeing about either is a correctness/safety issue (a
// force-push confirmation only one window enforces, an auto-fetch cadence that differs per
// viewer), edited only in this dialog, never as a per-window VS Code setting.
export const gitSettingsSchema = /*#__PURE__*/ z.object({
  protectedBranches: z.array(z.string()).default(['main', 'master', 'release/*']),
  fetchAutoIntervalMinutes: z
    .number()
    .int()
    .min(FETCH_AUTO_INTERVAL_MINUTES_RANGE.min)
    .max(FETCH_AUTO_INTERVAL_MINUTES_RANGE.max)
    .default(0),
  // G18 D15: git.path was already classified server-owned (it answers "where is the git binary
  // on this machine", not a per-repo or per-window preference) but its wiring was dead until this
  // phase — a third leaf of this same trio, fixed the same way, not a redesign. Empty means "auto-
  // discover" (VS Code's own git.path, then PATH) — gitclient.Discovery's own existing contract.
  gitPath: z.string().default(''),
  // P92 item 9: 0 = follow appearance.fontSize. Reaches every embedded git-ui surface (graph,
  // diff, review) through --vscode-font-size, which nothing else in this app consumes.
  graphFontSize: z.number().int().min(0).max(FONT_SIZE_RANGE.max).default(0),
});
export type GitSettings = z.infer<typeof gitSettingsSchema>;
