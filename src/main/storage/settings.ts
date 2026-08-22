import { sql } from 'drizzle-orm';
import {
  type Settings,
  type SettingsPatch,
  defaultSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../shared/settings';
import type { Db } from './db';
import { settings } from './schema';

// Settings are stored flat as `{section}.{field}` keys in the `settings` table. Sections are
// self-describing via their Zod schema, so adding one is a shared/settings.ts change plus this
// file's generic loop — no per-section branches.

const PREFIX = '';

// Flatten a full Settings object into `{section.field}` rows. The schema is the source of truth for
// which keys exist; defaults fill anything the store lacks.
function flatten(current: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [section, fields] of Object.entries(current)) {
    for (const [field, value] of Object.entries(fields)) {
      out[`${section}.${field}`] = value;
    }
  }
  return out;
}

export async function getAllSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));

  // Build the candidate by merging stored values over defaults, keyed by flattened name.
  const flat: Record<string, unknown> = flatten(defaultSettings);
  for (const [key, value] of stored) flat[key] = value;

  const candidate: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(flat)) {
    const dot = key.indexOf('.');
    const section = dot === -1 ? key : key.slice(0, dot);
    const field = dot === -1 ? key : key.slice(dot + 1);
    (candidate[section] ??= {})[field] = value;
  }

  // A hand-edited or stale-shape row must fail loudly here, not propagate `undefined`s into the UI.
  return settingsSchema.parse(candidate);
}

export async function setSettings(db: Db, patch: SettingsPatch): Promise<Settings> {
  const validPatch = settingsPatchSchema.parse(patch);
  const current = await getAllSettings(db);
  const merged: Settings = {
    appearance: { ...current.appearance, ...validPatch.appearance },
    data: { ...current.data, ...validPatch.data },
    cache: { ...current.cache, ...validPatch.cache },
  };

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(flatten(merged))) {
      await tx
        .insert(settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: sql`excluded.value` },
        });
    }
  });

  return merged;
}
