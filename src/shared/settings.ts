import { z } from 'zod';

export const rowDensitySchema = z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

export const countOnOpenSchema = z.enum(['never', 'estimate', 'exact']);

export const dataSettingsSchema = z.object({
  defaultPageSize: z.number().int().default(500),
  prefetchNextPage: z.boolean().default(true),
  countOnOpen: countOnOpenSchema.default('estimate'),
});
export type DataSettings = z.infer<typeof dataSettingsSchema>;

export const cacheSettingsSchema = z.object({
  l2BudgetMb: z.number().int().min(16).max(512).default(64), // §7
  l3TtlSeconds: z.number().int().min(0).default(300), // §7
});
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const settingsSchema = z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema,
  cache: cacheSettingsSchema,
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
    defaultPageSize: 500,
    prefetchNextPage: true,
    countOnOpen: 'estimate',
  },
  cache: {
    l2BudgetMb: 64,
    l3TtlSeconds: 300,
  },
};
