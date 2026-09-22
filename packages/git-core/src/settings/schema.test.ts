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
      'kiraSpace.graph.pageSize': 1000,
      'kiraSpace.graph.scope': 'head',
      'kiraSpace.review.baseCandidates': ['trunk', 'develop'],
    });
    expect(result.problems).toEqual([]);
    expect(result.settings['kiraSpace.graph.pageSize']).toBe(1000);
    expect(result.settings['kiraSpace.graph.scope']).toBe('head');
    expect(result.settings['kiraSpace.review.baseCandidates']).toEqual(['trunk', 'develop']);
  });

  // G18 D10/D15: kiraSpace.git.path is no longer a SETTINGS key at all (it moved to kira.db's
  // existing server-owned `settings` table) — a raw client that still sends it is treated exactly
  // like any other stranger, not specially.
  test('kiraSpace.git.path is an unknown key, not a settable string (G18 D15)', () => {
    const result = coerceSettings({ 'kiraSpace.git.path': '/usr/bin/git' });
    expect(result.problems).toEqual([{ key: 'kiraSpace.git.path', reason: 'unknown key' }]);
  });

  test('stringArray: a non-array value falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraSpace.review.baseCandidates': 'main' });
    expect(result.settings['kiraSpace.review.baseCandidates']).toEqual(
      SETTINGS['kiraSpace.review.baseCandidates'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraSpace.review.baseCandidates', reason: 'wrong type' },
    ]);
  });

  test('stringArray: one non-string member rejects the WHOLE array, never partly', () => {
    const result = coerceSettings({
      'kiraSpace.review.baseCandidates': ['main', 42, 'master'],
    });
    expect(result.settings['kiraSpace.review.baseCandidates']).toEqual(
      SETTINGS['kiraSpace.review.baseCandidates'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraSpace.review.baseCandidates', reason: 'wrong type' },
    ]);
  });

  test('stringArray: an empty array is a valid value, not an error', () => {
    const result = coerceSettings({ 'kiraSpace.review.baseCandidates': [] });
    expect(result.settings['kiraSpace.review.baseCandidates']).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  test('a wrong type falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraSpace.graph.pageSize': 'lots' });
    expect(result.settings['kiraSpace.graph.pageSize']).toBe(
      SETTINGS['kiraSpace.graph.pageSize'].default,
    );
    expect(result.problems).toEqual([{ key: 'kiraSpace.graph.pageSize', reason: 'wrong type' }]);
  });

  test('an out-of-range number falls back to the default and is reported', () => {
    const tooLow = coerceSettings({ 'kiraSpace.graph.pageSize': 1 });
    expect(tooLow.settings['kiraSpace.graph.pageSize']).toBe(
      SETTINGS['kiraSpace.graph.pageSize'].default,
    );
    expect(tooLow.problems).toEqual([{ key: 'kiraSpace.graph.pageSize', reason: 'out of range' }]);

    const tooHigh = coerceSettings({ 'kiraSpace.graph.pageSize': 1_000_000 });
    expect(tooHigh.problems).toEqual([{ key: 'kiraSpace.graph.pageSize', reason: 'out of range' }]);
  });

  test('an unknown enum member falls back to the default and is reported', () => {
    const result = coerceSettings({ 'kiraSpace.graph.scope': 'everything' });
    expect(result.settings['kiraSpace.graph.scope']).toBe(
      SETTINGS['kiraSpace.graph.scope'].default,
    );
    expect(result.problems).toEqual([
      { key: 'kiraSpace.graph.scope', reason: 'unknown enum member' },
    ]);
  });

  test('an unknown key falls back to defaults for everything and is reported, without touching known keys', () => {
    const result = coerceSettings({
      'kiraSpace.nonsense': true,
      'kiraSpace.log.level': 'debug',
    });
    expect(result.settings).toEqual({ ...defaultSettings(), 'kiraSpace.log.level': 'debug' });
    expect(result.problems).toEqual([{ key: 'kiraSpace.nonsense', reason: 'unknown key' }]);
  });

  test('never throws on a hostile input shape', () => {
    expect(() =>
      coerceSettings({
        'kiraSpace.git.path': 42,
        'kiraSpace.graph.pageSize': null,
        'kiraSpace.log.level': {},
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

  test('does not expose a source: "repo" key, e.g. kiraSpace.graph.pageSize (G18)', () => {
    const { properties } = toVsCodeConfiguration();
    expect(properties['kiraSpace.graph.pageSize']).toBeUndefined();
  });
});

describe('repoSettingKeys', () => {
  test('returns exactly the eleven source: "repo" keys, G18 D1/G24 D16/G25 D10/G28 D16', () => {
    const expected: SettingKey[] = [
      'kiraSpace.checkout.autoStash',
      'kiraSpace.github.enabled',
      'kiraSpace.graph.pageSize',
      'kiraSpace.graph.scope',
      'kiraSpace.log.level',
      'kiraSpace.pull.strategy',
      'kiraSpace.review.baseCandidates',
      'kiraSpace.stash.includeUntracked',
      'kiraSpace.stash.showInGraph',
      'kiraSpace.worktree.basePath',
      'kiraSpace.worktree.prepareScript',
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
