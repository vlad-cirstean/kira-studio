import { StorageSerializers, useLocalStorage } from '@vueuse/core';
import { effectScope, type Ref } from 'vue';

/** Structural zod schema: workbench takes no zod dependency. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

// One shared ref per key: two components binding the same key see the same value. The ref lives in
// a detached scope so the first component to unmount does not stop it for the others.
const cache = new Map<string, Ref<unknown>>();
const scope = effectScope(true);

function serializerFor<T>(defaultValue: T, schema: Schema<T> | undefined) {
  const type =
    defaultValue === null || typeof defaultValue === 'object'
      ? 'object'
      : (typeof defaultValue as 'boolean' | 'number' | 'string');
  const base = StorageSerializers[type] as {
    read(raw: string): unknown;
    write(value: unknown): string;
  };
  return {
    read(raw: string): T {
      let value: unknown;
      try {
        value = base.read(raw);
      } catch {
        return defaultValue;
      }
      if (!schema) return value as T;
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : defaultValue;
    },
    write: (value: T): string => base.write(value),
  };
}

function migrateLegacyKey(key: string, legacyKey: string): void {
  try {
    if (localStorage.getItem(key) !== null) return;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage blocked (private window): the default stands.
  }
}

/**
 * Per-device UI state in `localStorage` under `kira.<module>.<name>` (each app and the phone UI is
 * its own origin, so no app segment). A stored value that fails `schema` reads as the default.
 * `migrateFrom` moves a value stored under an older key, once. Geometry that follows the user across
 * windows belongs in the Go layout store and per-tab view state in the tab's `state_json`, not here.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  opts: { schema?: Schema<T>; migrateFrom?: string } = {},
): Ref<T> {
  const cached = cache.get(key);
  if (cached) return cached as Ref<T>;
  if (opts.migrateFrom) migrateLegacyKey(key, opts.migrateFrom);
  const state = scope.run(() =>
    useLocalStorage<T>(key, defaultValue, {
      serializer: serializerFor(defaultValue, opts.schema),
      writeDefaults: false,
    }),
  ) as Ref<T>;
  cache.set(key, state as Ref<unknown>);
  return state;
}
