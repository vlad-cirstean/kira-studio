import { describe, expect, test } from 'bun:test';
import type { SettingDef, SettingKey } from './schema.ts';
import {
  coerceSettings,
  defaultSettings,
  repoSettingKeys,
  SETTINGS,
  toVsCodeConfiguration,
} from './schema.ts';

describe('defaultSettings', () => {
  test('returns every SETTINGS key at its declared default', () => {
    const settings = defaultSettings();
    for (const key of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
      expect(settings[key]).toEqual(SETTINGS[key].default);
    }
  });

  // G14 D6/D11: the fallback for a host that reports nothing — 8, VS Code's own default for
  // workbench.tree.indent.
  test('carries workbench.tree.indent at its host-matching default of 8', () => {
    expect(defaultSettings()['workbench.tree.indent']).toBe(8);
  });
});

describe('coerceSettings', () => {
  test('an empty object coerces to the defaults with no problems', () => {
    const result = coerceSettings({});
    expect(result.settings).toEqual(defaultSettings());
    expect(result.problems).toEqual([]);
  });

  test('accepts a valid value for every type: ranged number, enum, and stringArray', () => {
    const result = coerceSettings({
      'kiraVersion.graph.pageSize': 1000,
      'kiraVersion.graph.scope': 'head',
      'kiraVersion.review.baseCandidates': ['trunk', 'develop'],
    });
    expect(result.problems).toEqual([]);
    expect(result.settings['kiraVersion.graph.pageSize']).toBe(1000);
    expect(result.settings['kiraVersion.graph.scope']).toBe('head');
    expect(result.settings['kiraVersion.review.baseCandidates']).toEqual(['trunk', 'develop']);
  });

  // G18 D10/D15: kiraVersion.git.path is no longer a SETTINGS key at all (it moved to kira.db's
  // existing server-owned `settings` table) — a raw client that still sends it is treated exactly
  // like any other stranger, not specially.
  test('kiraVersion.git.path is an unknown key, not a settable string (G18 D15)', () => {
    const result = coerceSettings({ 'kiraVersion.git.path': '/usr/bin/git' });
    expect(result.problems).toEqual([{ key: 'kiraVersion.git.path', reason: 'unknown key' }]);
  });

  test('stringArray: a non-array value falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraVersion.review.baseCandidates': 'main' });
    expect(result.settings['kiraVersion.review.baseCandidates']).toEqual(
      SETTINGS['kiraVersion.review.baseCandidates'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraVersion.review.baseCandidates', reason: 'wrong type' },
    ]);
  });

  test('stringArray: one non-string member rejects the WHOLE array, never partly', () => {
    const result = coerceSettings({
      'kiraVersion.review.baseCandidates': ['main', 42, 'master'],
    });
    expect(result.settings['kiraVersion.review.baseCandidates']).toEqual(
      SETTINGS['kiraVersion.review.baseCandidates'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraVersion.review.baseCandidates', reason: 'wrong type' },
    ]);
  });

  test('stringArray: an empty array is a valid value, not an error', () => {
    const result = coerceSettings({ 'kiraVersion.review.baseCandidates': [] });
    expect(result.settings['kiraVersion.review.baseCandidates']).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  test('a wrong type falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraVersion.graph.pageSize': 'lots' });
    expect(result.settings['kiraVersion.graph.pageSize']).toBe(
      SETTINGS['kiraVersion.graph.pageSize'].default,
    );
    expect(result.problems).toEqual([{ key: 'kiraVersion.graph.pageSize', reason: 'wrong type' }]);
  });

  test('an out-of-range number falls back to the default and is reported', () => {
    const tooLow = coerceSettings({ 'kiraVersion.graph.pageSize': 1 });
    expect(tooLow.settings['kiraVersion.graph.pageSize']).toBe(
      SETTINGS['kiraVersion.graph.pageSize'].default,
    );
    expect(tooLow.problems).toEqual([
      { key: 'kiraVersion.graph.pageSize', reason: 'out of range' },
    ]);

    const tooHigh = coerceSettings({ 'kiraVersion.graph.pageSize': 1_000_000 });
    expect(tooHigh.problems).toEqual([
      { key: 'kiraVersion.graph.pageSize', reason: 'out of range' },
    ]);
  });

  test('an unknown enum member falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraVersion.graph.scope': 'everything' });
    expect(result.settings['kiraVersion.graph.scope']).toBe(
      SETTINGS['kiraVersion.graph.scope'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraVersion.graph.scope', reason: 'unknown enum member' },
    ]);
  });

  test('an unknown key falls back to defaults for everything and is reported, without touching known keys', () => {
    const result = coerceSettings({
      'kiraVersion.nonsense': true,
      'kiraVersion.log.level': 'debug',
    });
    expect(result.settings).toEqual({ ...defaultSettings(), 'kiraVersion.log.level': 'debug' });
    expect(result.problems).toEqual([{ key: 'kiraVersion.nonsense', reason: 'unknown key' }]);
  });

  test('never throws on a hostile input shape', () => {
    expect(() =>
      coerceSettings({
        'kiraVersion.git.path': 42,
        'kiraVersion.graph.pageSize': null,
        'kiraVersion.log.level': {},
      }),
    ).not.toThrow();
  });
});

describe('toVsCodeConfiguration', () => {
  // G18 D1/D10/D15: every SETTINGS key now carries a `source` (seven `'repo'`, one `'host'`) —
  // there is no longer any `'extension'`-sourced key left for this extension to contribute at
  // all, so the generated `contributes.configuration` has exactly zero properties.
  test('produces zero properties — every remaining key carries a source (G18)', () => {
    const { properties } = toVsCodeConfiguration();
    expect(properties).toEqual({});
  });

  // G14 D6/D11/G18 D10: this is the assertion that actually matters — it is the only thing
  // stopping a key this extension does not itself own the value of (`source: 'host'` or, since
  // G18, `source: 'repo'`) from being contributed into this extension's own manifest, which VS
  // Code would treat as a duplicate declaration of someone else's setting.
  test('does not expose a source: "host" key, e.g. workbench.tree.indent', () => {
    const { properties } = toVsCodeConfiguration();
    expect(properties['workbench.tree.indent']).toBeUndefined();
  });

  test('does not expose a source: "repo" key, e.g. kiraVersion.graph.pageSize (G18)', () => {
    const { properties } = toVsCodeConfiguration();
    expect(properties['kiraVersion.graph.pageSize']).toBeUndefined();
  });
});

describe('repoSettingKeys', () => {
  test('returns exactly the eleven source: "repo" keys, G18 D1/G24 D16/G25 D10/G28 D16', () => {
    const expected: SettingKey[] = [
      'kiraVersion.checkout.autoStash',
      'kiraVersion.github.enabled',
      'kiraVersion.graph.pageSize',
      'kiraVersion.graph.scope',
      'kiraVersion.log.level',
      'kiraVersion.pull.strategy',
      'kiraVersion.review.baseCandidates',
      'kiraVersion.stash.includeUntracked',
      'kiraVersion.stash.showInGraph',
      'kiraVersion.worktree.basePath',
      'kiraVersion.worktree.prepareScript',
    ];
    expect([...repoSettingKeys()].sort()).toEqual(expected.sort());
  });

  test('every returned key actually carries source: "repo"', () => {
    for (const key of repoSettingKeys()) {
      const def: SettingDef<unknown> = SETTINGS[key];
      expect(def.source).toBe('repo');
    }
  });
});

describe('instanceWide (G18 D10/D14)', () => {
  test('kiraVersion.log.level is the only instanceWide: true key', () => {
    for (const key of repoSettingKeys()) {
      const def: SettingDef<unknown> = SETTINGS[key];
      const expected = key === 'kiraVersion.log.level';
      expect(Boolean(def.instanceWide)).toBe(expected);
    }
  });
});
