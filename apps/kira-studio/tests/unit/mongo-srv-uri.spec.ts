// Round-2 review finding 1 (regression from round 1's own mongo fix): `canRoundTripToFields` must
// stay false for `mongodb+srv://` — nothing downstream can actually represent the `+srv` scheme
// (formatConnectionUri derives the scheme from `kind` alone, and the backend's
// buildURIFromFields hardcodes `mongodb://`), so allowing a +srv URI into fields mode silently
// discards the scheme with no way back, and SRV hosts have no port to satisfy fields mode's
// required-port validation. Plain `mongodb://` is unaffected and must keep round-tripping.
import { describe, expect, test } from 'bun:test';
import { canRoundTripToFields, type ParsedUri, parseConnectionUri } from '@shared/domain/uri';

function mustParse(uri: string): ParsedUri {
  const parsed = parseConnectionUri(uri);
  if (!parsed) throw new Error(`expected ${uri} to parse`);
  return parsed;
}

describe('canRoundTripToFields (mongo +srv regression, round-2 finding 1)', () => {
  test('mongodb+srv:// stays URI-only (no port, scheme unrepresentable in fields mode)', () => {
    const parsed = mustParse(
      'mongodb+srv://user:pass@cluster0.xyz.mongodb.net/app?authSource=admin',
    );
    expect(canRoundTripToFields(parsed, 'mongodb')).toBe(false);
  });

  test('plain mongodb:// still round-trips to fields mode', () => {
    const parsed = mustParse('mongodb://user:pass@localhost:27017/app?authSource=admin');
    expect(canRoundTripToFields(parsed, 'mongodb')).toBe(true);
  });
});
