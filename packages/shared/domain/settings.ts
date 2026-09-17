import { z } from 'zod';

export const rowDensitySchema = /*#__PURE__*/ z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

// P17 D6: the three numeric bounds a control can actually violate, as exported constants so the
// schema (where one applies), the input min/max attributes and the settings dialog's own
// validity check read one number each, not three hard-coded copies.
export const FONT_SIZE_RANGE = { min: 9, max: 24 } as const;
export const CACHE_L2_BUDGET_MB_RANGE = { min: 8, max: 1024 } as const;
export const OP_LOG_RETENTION_DAYS_RANGE = { min: 1, max: 365 } as const;
// P18 (v1.1) D14/D20: the "expensive query" threshold is an estimated-*rows-read* number, never a
// cost unit — the two dialects that report a same-named `cost` field disagree by three orders of
// magnitude for a comparable scan (see the plan's F17), so no cost-based number could be shared
// across engines. 1,000 floor keeps the field meaningful; 1e9 ceiling is generous headroom above
// any real table this app's own fixture corpus uses.
export const EXPENSIVE_QUERY_ROWS_RANGE = { min: 1_000, max: 1_000_000_000 } as const;
// G7 D16: minutes between automatic background fetches; 0 disables it.
export const FETCH_AUTO_INTERVAL_MINUTES_RANGE = { min: 0, max: 1440 } as const;

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

const pageSizeSchema = /*#__PURE__*/ z.union([
  z.literal(10),
  z.literal(100),
  z.literal(1000),
  z.literal(10000),
]);

export const dataSettingsSchema = /*#__PURE__*/ z.object({
  defaultPageSize: pageSizeSchema,
});
export type DataSettings = z.infer<typeof dataSettingsSchema>;

export const cacheSettingsSchema = /*#__PURE__*/ z.object({
  l2BudgetMb: z.number().int().min(CACHE_L2_BUDGET_MB_RANGE.min).max(CACHE_L2_BUDGET_MB_RANGE.max),
});
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const advancedSettingsSchema = /*#__PURE__*/ z.object({
  opLogRetentionDays: z
    .number()
    .int()
    .min(OP_LOG_RETENTION_DAYS_RANGE.min)
    .max(OP_LOG_RETENTION_DAYS_RANGE.max),
  // P18 D14/D20: drives both the manual Explain panel's over-threshold flag and auto-explain's
  // warning strip. `.default(...)` is load-bearing the same way every other P17-era leaf's is —
  // an older stored settings row has no such key.
  expensiveQueryRows: z
    .number()
    .int()
    .min(EXPENSIVE_QUERY_ROWS_RANGE.min)
    .max(EXPENSIVE_QUERY_ROWS_RANGE.max)
    .default(100_000),
  // P72 §9.2: the git graph's own diagnostic log verbosity — moved here from the per-repo
  // RepoSettingsDialog.vue's `kiraVersion.log.level` (`instanceWide: true` there was a label, not
  // a mechanism; this is where installation-wide settings actually live). `.default('info')`
  // matches that leaf's own pre-existing default (schema.ts).
  gitLogLevel: z.enum(['off', 'error', 'warn', 'info', 'debug']).default('info'),
});
export type AdvancedSettings = z.infer<typeof advancedSettingsSchema>;

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

// P90 §2.1: the seven request-settings leaves that used to be internal/httpclient package
// constants (options.go states the coupling back at this file: its normalize() defaults must
// equal this section's own defaults, field for field, since neither package may import the
// other). Three deliberate default changes from pre-P90 httpclient behaviour: timeout 30s -> none,
// max response 10 MiB -> 50 MB, max redirects unchanged at 10.
export const HTTP_VERSIONS = ['1.1', '2'] as const;
export const httpVersionSchema = /*#__PURE__*/ z.enum(HTTP_VERSIONS);
export type HttpVersion = z.infer<typeof httpVersionSchema>;

// 0 = no timeout. Ceiling is one hour — past that a request is a subscription, not a request.
export const REQUEST_TIMEOUT_MS_RANGE = { min: 0, max: 3_600_000 } as const;
// 0 = unlimited. Whole MB, cache.l2BudgetMb's own unit. 2048 is well past any response a
// request builder should be holding in memory and rendering.
export const MAX_RESPONSE_MB_RANGE = { min: 0, max: 2048 } as const;
export const MAX_REDIRECTS_RANGE = { min: 0, max: 100 } as const;

export const apiSettingsSchema = /*#__PURE__*/ z.object({
  httpVersion: httpVersionSchema.default('2'),
  requestTimeoutMs: z
    .number()
    .int()
    .min(REQUEST_TIMEOUT_MS_RANGE.min)
    .max(REQUEST_TIMEOUT_MS_RANGE.max)
    .default(0),
  maxResponseMb: z
    .number()
    .int()
    .min(MAX_RESPONSE_MB_RANGE.min)
    .max(MAX_RESPONSE_MB_RANGE.max)
    .default(50),
  sslVerify: z.boolean().default(true),
  followRedirects: z.boolean().default(true),
  maxRedirects: z
    .number()
    .int()
    .min(MAX_REDIRECTS_RANGE.min)
    .max(MAX_REDIRECTS_RANGE.max)
    .default(10),
  disableCookieJar: z.boolean().default(true),
});
export type ApiSettings = z.infer<typeof apiSettingsSchema>;

// C3 §7.1: one leaf, default false. The embedded repo-map MCP server instance's own on/off switch
// (internal/bridge/repomap.go owns the actual start/stop side effect; this leaf is only the
// persisted, cross-restart record of "should it be on"). A new section on its own, not folded into
// `advanced` or `git` — C5-C7 add their own code-intelligence leaves beside it.
export const codeIntelSettingsSchema = /*#__PURE__*/ z.object({
  mcpServerEnabled: z.boolean().default(false),
});
export type CodeIntelSettings = z.infer<typeof codeIntelSettingsSchema>;

// M1 §6.2: mirrors codeIntelSettingsSchema exactly — the embedded DB MCP server instance's own
// on/off switch (internal/bridge/dbmcp.go owns the actual start/stop side effect).
export const dbMcpSettingsSchema = /*#__PURE__*/ z.object({
  serverEnabled: z.boolean().default(false),
});
export type DbMcpSettings = z.infer<typeof dbMcpSettingsSchema>;

// P86 §9.2: mirrors dbMcpSettingsSchema exactly — hooksEnabled is read fresh at every Claude Code
// launch (internal/bridge/agenthooks.go owns the actual listener start/stop side effect), never
// cached. hooksPromptDismissed is the first-run banner's own "don't ask again" leaf (§9.4),
// independent of hooksEnabled so declining the prompt once doesn't reappear on every new tab.
export const claudeCodeSettingsSchema = /*#__PURE__*/ z.object({
  hooksEnabled: z.boolean().default(false),
  hooksPromptDismissed: z.boolean().default(false),
});
export type ClaudeCodeSettings = z.infer<typeof claudeCodeSettingsSchema>;

// `.default(...)` on every new section is load-bearing: an older kira.sqlite has a settings
// row with no `data`/`cache`/`advanced`/`git`/`codeIntel` keys, and that row must still parse on
// next launch.
export const settingsSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema.default({ defaultPageSize: 100 }),
  cache: cacheSettingsSchema.default({ l2BudgetMb: 64 }),
  advanced: advancedSettingsSchema.default({
    opLogRetentionDays: 30,
    expensiveQueryRows: 100_000,
    gitLogLevel: 'info',
  }),
  git: gitSettingsSchema.default({
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  }),
  api: apiSettingsSchema.default({
    httpVersion: '2',
    requestTimeoutMs: 0,
    maxResponseMb: 50,
    sslVerify: true,
    followRedirects: true,
    maxRedirects: 10,
    disableCookieJar: true,
  }),
  codeIntel: codeIntelSettingsSchema.default({ mcpServerEnabled: false }),
  dbMcp: dbMcpSettingsSchema.default({ serverEnabled: false }),
  claudeCode: claudeCodeSettingsSchema.default({
    hooksEnabled: false,
    hooksPromptDismissed: false,
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
  data: dataSettingsSchema.partial().optional(),
  cache: cacheSettingsSchema.partial().optional(),
  advanced: advancedSettingsSchema.partial().optional(),
  git: gitSettingsSchema.partial().optional(),
  api: apiSettingsSchema.partial().optional(),
  codeIntel: codeIntelSettingsSchema.partial().optional(),
  dbMcp: dbMcpSettingsSchema.partial().optional(),
  claudeCode: claudeCodeSettingsSchema.partial().optional(),
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
  data: {
    defaultPageSize: 100,
  },
  cache: {
    l2BudgetMb: 64,
  },
  advanced: {
    opLogRetentionDays: 30,
    expensiveQueryRows: 100_000,
    gitLogLevel: 'info',
  },
  git: {
    protectedBranches: ['main', 'master', 'release/*'],
    fetchAutoIntervalMinutes: 0,
    gitPath: '',
    graphFontSize: 0,
  },
  api: {
    httpVersion: '2',
    requestTimeoutMs: 0,
    maxResponseMb: 50,
    sslVerify: true,
    followRedirects: true,
    maxRedirects: 10,
    disableCookieJar: true,
  },
  codeIntel: {
    mcpServerEnabled: false,
  },
  dbMcp: {
    serverEnabled: false,
  },
  claudeCode: {
    hooksEnabled: false,
    hooksPromptDismissed: false,
  },
};
