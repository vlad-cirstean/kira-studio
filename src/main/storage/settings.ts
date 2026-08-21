import { sql } from 'drizzle-orm';
import {
  defaultSettings,
  type Settings,
  type SettingsPatch,
  settingsPatchSchema,
  settingsSchema,
} from '../../shared/settings';
import type { Db } from './db';
import { settings } from './schema';

const PREFIX = 'appearance.';

export async function getAllSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
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

export async function setSettings(db: Db, patch: SettingsPatch): Promise<Settings> {
  const validPatch = settingsPatchSchema.parse(patch);
  const current = await getAllSettings(db);
  const merged: Settings = { appearance: { ...current.appearance, ...validPatch.appearance } };

  await db.transaction(async (tx) => {
    for (const [suffix, value] of Object.entries(merged.appearance)) {
      await tx
        .insert(settings)
        .values({ key: `${PREFIX}${suffix}`, value: JSON.stringify(value) })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: sql`excluded.value` },
        });
    }
  });

  return merged;
}
