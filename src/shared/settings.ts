import { z } from 'zod';

export const rowDensitySchema = z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

const pageSizeSchema = z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]);

export const dataSettingsSchema = z.object({
  defaultPageSize: pageSizeSchema,
  prefetch: z.boolean(),
  countOnOpen: z.boolean(),
});
export type DataSettings = z.infer<typeof dataSettingsSchema>;

export const cacheSettingsSchema = z.object({
  l2BudgetMb: z.number().int().min(8).max(1024),
});
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

// `.default(...)` on both new sections is load-bearing: a P1-era kira.sqlite has a settings
// row with no `data`/`cache` keys, and that row must still parse on the first P2 launch.
export const settingsSchema = z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema.default({ defaultPageSize: 100, prefetch: true, countOnOpen: false }),
  cache: cacheSettingsSchema.default({ l2BudgetMb: 64 }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
  data: dataSettingsSchema.partial().optional(),
  cache: cacheSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
  },
  data: {
    defaultPageSize: 100,
    prefetch: true,
    countOnOpen: false,
  },
  cache: {
    l2BudgetMb: 64,
  },
};
