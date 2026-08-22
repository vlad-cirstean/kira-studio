import {
  defaultSettings,
  type Settings,
  type SettingsPatch,
  settingsPatchSchema,
  settingsSchema,
} from '../../shared/settings';
import type { Db } from './db';

const PREFIX = 'appearance.';

export function getAllSettings(db: Db): Settings {
  const rows = db.all('SELECT key, value FROM settings') as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  const candidate = {
    appearance: {
      fontFamily: stored.get(`${PREFIX}fontFamily`) ?? defaultSettings.appearance.fontFamily,
      fontSize: stored.get(`${PREFIX}fontSize`) ?? defaultSettings.appearance.fontSize,
      rowDensity: stored.get(`${PREFIX}rowDensity`) ?? defaultSettings.appearance.rowDensity,
    },
  };
  // A hand-edited or stale-shape row must fail loudly here, not propagate `undefined`s into the UI.
  return settingsSchema.parse(candidate);
}

export function setSettings(db: Db, patch: SettingsPatch): Settings {
  const validPatch = settingsPatchSchema.parse(patch);
  const current = getAllSettings(db);
  const merged: Settings = { appearance: { ...current.appearance, ...validPatch.appearance } };

  db.transaction(() => {
    for (const [suffix, value] of Object.entries(merged.appearance)) {
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [`${PREFIX}${suffix}`, JSON.stringify(value)],
      );
    }
  });

  return merged;
}
