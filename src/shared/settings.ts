export type RowDensity = 'compact' | 'comfortable';

export interface AppearanceSettings {
  fontFamily: string;
  fontSize: number;
  rowDensity: RowDensity;
}

export interface Settings {
  appearance: AppearanceSettings;
}

export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>;
}

export const defaultSettings: Settings = {
  appearance: {
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: 12,
    rowDensity: 'comfortable',
  },
};
