/**
 * One schema for every Git-mode setting, in `git-core` — so a setting is defined once rather than
 * accreting in two places, and so a second host's settings surface generates from the same schema
 * rather than inventing one.
 *
 * The source project generated VS Code's `contributes.configuration` from this file at build time.
 * There is no VS Code manifest here, so that generator (`toVsCodeConfiguration`) is dropped rather
 * than carried unused (`docs/v1.3/SPEC.md`, "What deliberately does not come across"). How these
 * keys join this app's own settings surface — `packages/shared/domain/settings` and the `settings`
 * table in `kira.sqlite` — is P1's to decide; the schema is deliberately independent of that
 * choice, which is the point of it being here at all.
 *
 * Keys are prefixed `git.` rather than the source's dead `kiraVersion.` product name, and stay
 * namespaced under the module so they can only ever collide with each other.
 */
import { assert } from '../util/assert';

/** Which shell mounted the UI bundle — a structural copy of `@kira/git-ipc`'s `HostKind`
 *  (ipc may not import core and core may not import ipc; kept honest by `wire.test.ts`, same as
 *  `SettingsSnapshot`/`HeadState`/`DecorationRef`). `"harness"` is a real value, not a test-only
 *  stand-in: the mock-bridge harness is a first-class Transport consumer. */
export type HostKind = 'kira-studio' | 'harness';

export type SettingType = 'string' | 'number' | 'boolean' | 'enum';

export interface SettingDef<T> {
  readonly key: string;
  readonly type: SettingType;
  readonly default: T;
  /** Shown verbatim wherever the setting is surfaced. */
  readonly description: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly scope?: 'window' | 'resource';
}

export const SETTINGS = {
  'git.path': {
    key: 'git.path',
    type: 'string',
    default: '',
    description:
      "Path to the git executable. Empty uses the host's own discovery — PATH, then the " +
      "platform's own probe order.",
  },
  'git.graph.pageSize': {
    key: 'git.graph.pageSize',
    type: 'number',
    default: 5000,
    description: 'How many commits a single Load more page fetches.',
    minimum: 100,
    maximum: 50000,
  },
  'git.graph.scope': {
    key: 'git.graph.scope',
    type: 'enum',
    default: 'all',
    description: 'Whether the graph shows every ref ("all") or only the current HEAD\'s ancestry.',
    enum: ['all', 'head'],
  },
  'git.log.level': {
    key: 'git.log.level',
    type: 'enum',
    default: 'info',
    description: "Verbosity of Git mode's own diagnostic log.",
    enum: ['off', 'error', 'warn', 'info', 'debug'],
  },
} as const satisfies Record<string, SettingDef<unknown>>;

export type SettingKey = keyof typeof SETTINGS;

const SETTING_KEYS = Object.keys(SETTINGS) as readonly SettingKey[];

/** The set of legal values for a def, derived from its `type`/`enum` rather than its `default` —
 *  `default`'s own literal type (e.g. exactly `5000`) is one legal value, not the type. */
type ValueOfDef<D extends SettingDef<unknown>> = D['type'] extends 'string'
  ? string
  : D['type'] extends 'boolean'
    ? boolean
    : D['type'] extends 'number'
      ? number
      : D['enum'] extends readonly (infer E)[]
        ? E
        : never;

export type SettingValue<K extends SettingKey> = ValueOfDef<(typeof SETTINGS)[K]>;

export type Settings = { readonly [K in SettingKey]: SettingValue<K> };

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** The canonical default for every key, straight from `SETTINGS` — the single cast below just
 *  restates what `SETTINGS`'s own `satisfies` clause already guarantees element-by-element. */
export function defaultSettings(): Settings {
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].default])) as Settings;
}

export interface CoerceProblem {
  readonly key: string;
  readonly reason: 'unknown key' | 'wrong type' | 'out of range' | 'unknown enum member';
}

export interface CoerceResult {
  readonly settings: Settings;
  readonly problems: readonly CoerceProblem[];
}

type CoerceOne =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: CoerceProblem['reason'] };

function coerceOne(def: SettingDef<unknown>, value: unknown): CoerceOne {
  switch (def.type) {
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : { ok: false, reason: 'wrong type' };
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, reason: 'wrong type' };
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, reason: 'wrong type' };
      }
      if (def.minimum !== undefined && value < def.minimum)
        return { ok: false, reason: 'out of range' };
      if (def.maximum !== undefined && value > def.maximum)
        return { ok: false, reason: 'out of range' };
      return { ok: true, value };
    }
    case 'enum': {
      if (typeof value !== 'string') return { ok: false, reason: 'wrong type' };
      const members: readonly string[] | undefined = def.enum;
      assert(members !== undefined, `SETTINGS[${def.key}]: type "enum" without an enum list`);
      if (!members.includes(value)) return { ok: false, reason: 'unknown enum member' };
      return { ok: true, value };
    }
  }
}

/**
 * Never throws and never returns a partly-valid object: a wrong type, an out-of-range number
 * or an unknown enum member falls back to that key's default and is reported in
 * `problems`, which the host logs. A user with `"pageSize": "lots"` in their settings.json gets
 * a working panel and a log line, not a dead one.
 */
export function coerceSettings(raw: Readonly<Record<string, unknown>>): CoerceResult {
  const settings = defaultSettings() as Record<string, unknown>;
  const problems: CoerceProblem[] = [];

  for (const rawKey of Object.keys(raw)) {
    if (!isSettingKey(rawKey)) {
      problems.push({ key: rawKey, reason: 'unknown key' });
      continue;
    }
    const outcome = coerceOne(SETTINGS[rawKey], raw[rawKey]);
    if (outcome.ok) {
      settings[rawKey] = outcome.value;
    } else {
      problems.push({ key: rawKey, reason: outcome.reason });
    }
  }

  return { settings: settings as Settings, problems };
}
