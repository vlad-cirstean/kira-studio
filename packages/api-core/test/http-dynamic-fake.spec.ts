// P17 D12: the fake. namespace is additive and permanent beside Postman's own $name spellings —
// this is the proof that the alias layer actually works end to end (every $name still resolves,
// unchanged) rather than a migration in disguise. ALIAS_TO_FAKE/GENERATORS's own exhaustiveness is
// already a compiler guarantee (F12/D12's own doc comment) — what earns a test here is the
// dispatch function (generate()) that branches between the two vocabularies, and the specific
// collapse the plan names by name ($guid and $randomUUID both reaching fake.string.uuid).

import { describe, expect, test } from 'bun:test';
import { ALIAS_TO_FAKE, DYNAMIC_NAMES, FAKE_NAMES } from '../src/http/dynamic/catalog';
import { generate } from '../src/http/dynamic/generators';
import { isDynamicReference } from '../src/http/substitute';

describe('http/dynamic (P17 D12): the fake. alias layer', () => {
  test('every Postman $name still generates a value — the no-migration claim, asserted', () => {
    for (const name of DYNAMIC_NAMES) {
      const value = generate(name);
      expect(value).not.toBeNull();
      expect(typeof value).toBe('string');
    }
  });

  test('every fake. name generates a value directly, with no $ alias needed', () => {
    for (const name of FAKE_NAMES) {
      const value = generate(name);
      expect(value).not.toBeNull();
      expect(typeof value).toBe('string');
    }
  });

  test('$guid and $randomUUID both collapse onto fake.string.uuid — one generator, two Postman spellings', () => {
    expect(ALIAS_TO_FAKE.$guid).toBe('fake.string.uuid');
    expect(ALIAS_TO_FAKE.$randomUUID).toBe('fake.string.uuid');
  });

  test('the two clock values are the namespace’s only non-faker entries, still reachable both ways', () => {
    expect(ALIAS_TO_FAKE.$timestamp).toBe('fake.date.timestamp');
    expect(ALIAS_TO_FAKE.$isoTimestamp).toBe('fake.date.iso');
    // Both read the clock, not the RNG (P6 D9) — a numeric unix-seconds string, and a full ISO
    // string, respectively.
    expect(generate('$timestamp')).toMatch(/^\d+$/);
    expect(generate('fake.date.timestamp')).toMatch(/^\d+$/);
    expect(generate('$isoTimestamp')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(generate('fake.date.iso')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('an uncatalogued name in either vocabulary returns null, never throws', () => {
    expect(generate('$totallyMadeUp')).toBeNull();
    expect(generate('fake.nonexistent.thing')).toBeNull();
    expect(generate('plainVariableName')).toBeNull();
  });

  test('isDynamicReference recognises both prefixes and nothing else', () => {
    expect(isDynamicReference('$guid')).toBe(true);
    expect(isDynamicReference('fake.string.uuid')).toBe(true);
    expect(isDynamicReference('fakeNotReally')).toBe(false);
    expect(isDynamicReference('apiKey')).toBe(false);
  });
});
