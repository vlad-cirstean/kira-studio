import { z } from 'zod';

export const rowDensitySchema = z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
  // P42 D14: word wrap in every CodeMirror surface (query console, Mongo console, cell editor,
  // definition view, ...). `.default(true)` is today's hard-coded behavior
  // (CodeMirrorHost.vue's own unconditional EditorView.lineWrapping, F11), so a settings row
  // saved before this field existed parses and behaves identically.
  wordWrap: z.boolean().default(true),
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

const pageSizeSchema = z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]);

export const dataSettingsSchema = z.object({
  defaultPageSize: pageSizeSchema,
});
export type DataSettings = z.infer<typeof dataSettingsSchema>;

export const cacheSettingsSchema = z.object({
  l2BudgetMb: z.number().int().min(8).max(1024),
});
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const advancedSettingsSchema = z.object({
  engineMemoryCapMb: z.number().int().min(256).max(4096),
  opLogRetentionDays: z.number().int().min(1).max(365),
});
export type AdvancedSettings = z.infer<typeof advancedSettingsSchema>;

// `.default(...)` on every new section is load-bearing: an older kira.sqlite has a settings
// row with no `data`/`cache`/`advanced` keys, and that row must still parse on next launch.
export const settingsSchema = z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema.default({ defaultPageSize: 100 }),
  cache: cacheSettingsSchema.default({ l2BudgetMb: 64 }),
  advanced: advancedSettingsSchema.default({ engineMemoryCapMb: 512, opLogRetentionDays: 30 }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
  data: dataSettingsSchema.partial().optional(),
  cache: cacheSettingsSchema.partial().optional(),
  advanced: advancedSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
    wordWrap: true,
  },
  data: {
    defaultPageSize: 100,
  },
  cache: {
    l2BudgetMb: 64,
  },
  advanced: {
    engineMemoryCapMb: 512,
    opLogRetentionDays: 30,
  },
};
