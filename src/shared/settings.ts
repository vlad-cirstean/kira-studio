import { z } from 'zod';

export const rowDensitySchema = z.enum(['compact', 'comfortable']);
export type RowDensity = z.infer<typeof rowDensitySchema>;

export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

export const settingsSchema = z.object({
  appearance: appearanceSettingsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = z.object({
  appearance: appearanceSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
  },
};
