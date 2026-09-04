import { describe, expect, test } from 'bun:test';
import { coerceSettings, defaultSettings, SETTINGS } from './schema';

describe('defaultSettings', () => {
  test('returns every SETTINGS key at its declared default', () => {
    const settings = defaultSettings();
    for (const key of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
      expect(settings[key]).toEqual(SETTINGS[key].default);
    }
  });
});

describe('coerceSettings', () => {
  test('an empty object coerces to the defaults with no problems', () => {
    const result = coerceSettings({});
    expect(result.settings).toEqual(defaultSettings());
    expect(result.problems).toEqual([]);
  });

  test('accepts a valid value for every type: string, ranged number, and enum', () => {
    const result = coerceSettings({
      'git.path': '/usr/bin/git',
      'git.graph.pageSize': 1000,
      'git.graph.scope': 'head',
    });
    expect(result.problems).toEqual([]);
    expect(result.settings['git.path']).toBe('/usr/bin/git');
    expect(result.settings['git.graph.pageSize']).toBe(1000);
    expect(result.settings['git.graph.scope']).toBe('head');
  });

  test('a wrong type falls back to the default and is reported', () => {
    const result = coerceSettings({ 'git.graph.pageSize': 'lots' });
    expect(result.settings['git.graph.pageSize']).toBe(SETTINGS['git.graph.pageSize'].default);
    expect(result.problems).toEqual([{ key: 'git.graph.pageSize', reason: 'wrong type' }]);
  });

  test('an out-of-range number falls back to the default and is reported', () => {
    const tooLow = coerceSettings({ 'git.graph.pageSize': 1 });
    expect(tooLow.settings['git.graph.pageSize']).toBe(SETTINGS['git.graph.pageSize'].default);
    expect(tooLow.problems).toEqual([{ key: 'git.graph.pageSize', reason: 'out of range' }]);

    const tooHigh = coerceSettings({ 'git.graph.pageSize': 1_000_000 });
    expect(tooHigh.problems).toEqual([{ key: 'git.graph.pageSize', reason: 'out of range' }]);
  });

  test('an unknown enum member falls back to the default and is reported', () => {
    const result = coerceSettings({ 'git.graph.scope': 'everything' });
    expect(result.settings['git.graph.scope']).toBe(SETTINGS['git.graph.scope'].default);
    expect(result.problems).toEqual([{ key: 'git.graph.scope', reason: 'unknown enum member' }]);
  });

  test('an unknown key falls back to defaults for everything and is reported, without touching known keys', () => {
    const result = coerceSettings({
      'git.nonsense': true,
      'git.log.level': 'debug',
    });
    expect(result.settings).toEqual({ ...defaultSettings(), 'git.log.level': 'debug' });
    expect(result.problems).toEqual([{ key: 'git.nonsense', reason: 'unknown key' }]);
  });

  test('never throws on a hostile input shape', () => {
    expect(() =>
      coerceSettings({
        'git.path': 42,
        'git.graph.pageSize': null,
        'git.log.level': {},
      }),
    ).not.toThrow();
  });
});
