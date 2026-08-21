import { defaultSettings, type Settings, type SettingsPatch } from '../../shared/settings';
import type { Db } from './db';

const PREFIX = 'appearance.';

export function getAllSettings(db: Db): Settings {
  const rows = db.all('SELECT key, value FROM settings') as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  return {
    appearance: {
      fontFamily:
        (stored.get(`${PREFIX}fontFamily`) as string | undefined) ??
        defaultSettings.appearance.fontFamily,
      fontSize:
        (stored.get(`${PREFIX}fontSize`) as number | undefined) ??
        defaultSettings.appearance.fontSize,
      rowDensity:
        (stored.get(`${PREFIX}rowDensity`) as Settings['appearance']['rowDensity'] | undefined) ??
        defaultSettings.appearance.rowDensity,
    },
  };
}

export function setSettings(db: Db, patch: SettingsPatch): Settings {
  const current = getAllSettings(db);
  const merged: Settings = { appearance: { ...current.appearance, ...patch.appearance } };

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
