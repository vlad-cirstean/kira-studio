import { z } from 'zod';

export const rowDensitySchema = /*#__PURE__*/ z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

// P17 D6: the three numeric bounds a control can actually violate, as exported constants so the
// schema (where one applies), the input min/max attributes and the settings dialog's own
// validity check read one number each, not three hard-coded copies.
export const FONT_SIZE_RANGE = { min: 9, max: 24 } as const;
export const CACHE_L2_BUDGET_MB_RANGE = { min: 8, max: 1024 } as const;
export const OP_LOG_RETENTION_DAYS_RANGE = { min: 1, max: 365 } as const;

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
});
export type AdvancedSettings = z.infer<typeof advancedSettingsSchema>;

// `.default(...)` on every new section is load-bearing: an older kira.sqlite has a settings
// row with no `data`/`cache`/`advanced` keys, and that row must still parse on next launch.
export const settingsSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema.default({ defaultPageSize: 100 }),
  cache: cacheSettingsSchema.default({ l2BudgetMb: 64 }),
  advanced: advancedSettingsSchema.default({ opLogRetentionDays: 30 }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = /*#__PURE__*/ z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
  data: dataSettingsSchema.partial().optional(),
  cache: cacheSettingsSchema.partial().optional(),
  advanced: advancedSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: 'Menlo, monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
    wordWrap: true,
    rowColoring: true,
  },
  data: {
    defaultPageSize: 100,
  },
  cache: {
    l2BudgetMb: 64,
  },
  advanced: {
    opLogRetentionDays: 30,
  },
};
