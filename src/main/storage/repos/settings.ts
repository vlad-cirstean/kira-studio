import {
  defaultSettings,
  type Settings,
  type SettingsPatch,
  settingsPatchSchema,
  settingsSchema,
} from '../../../shared/settings';
import type { KiraDb } from '../db';
import { settings } from '../schema/settings';

// Each leaf of each section is stored as its own `${section}.${key}` row (not a JSON blob per
// section), so a P2 build reading a P1-era database simply finds no `data.*`/`cache.*` rows and
// falls back to `defaults` below — the per-leaf fallback, not settingsSchema's `.default()`,
// is what makes an existing ~/.kira-studio/kira.sqlite keep launching after the upgrade.
function sectionFromStore<T extends Record<string, unknown>>(
  stored: Map<string, unknown>,
  section: string,
  defaults: T,
): T {
  const result = {} as T;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = stored.get(`${section}.${String(key)}`);
    result[key] = (value ?? defaults[key]) as T[typeof key];
  }
  return result;
}

export async function getAllSettings(db: KiraDb): Promise<Settings> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  const candidate = {
    appearance: sectionFromStore(stored, 'appearance', defaultSettings.appearance),
    data: sectionFromStore(stored, 'data', defaultSettings.data),
    cache: sectionFromStore(stored, 'cache', defaultSettings.cache),
  };
  // A hand-edited or stale-shape row must fail loudly here, not propagate `undefined`s into the UI.
  return settingsSchema.parse(candidate);
}

export async function setSettings(db: KiraDb, patch: SettingsPatch): Promise<Settings> {
  const validPatch = settingsPatchSchema.parse(patch);
  const current = await getAllSettings(db);
  const merged: Settings = {
    appearance: { ...current.appearance, ...validPatch.appearance },
    data: { ...current.data, ...validPatch.data },
    cache: { ...current.cache, ...validPatch.cache },
  };

  await db.transaction(async (tx) => {
    for (const [section, values] of Object.entries(merged)) {
      for (const [key, value] of Object.entries(values)) {
        await tx
          .insert(settings)
          .values({ key: `${section}.${key}`, value: JSON.stringify(value) })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: JSON.stringify(value) },
          });
      }
    }
  });

  return merged;
}
