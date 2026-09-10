import { describe, expect, test } from 'bun:test';
import { setiIconFor } from './setiFileIcon.ts';

// G-UX (item 10): `seti-icons`' own bundled data has no `files`/`extensions`/`partials` entry for
// `go.mod`/`go.sum`/`go.work`(`.sum`) at all — every one of `getDetails`' own lookup stages misses
// (see setiFileIcon.ts's own doc comment for exactly why), so before this fix they fell all the
// way through to the generic default icon despite being at least as common in a real Go diff as
// `.go` source itself. This proves each of them now resolves to the SAME icon+color a real `.go`
// file gets, not the default.
describe('setiIconFor — Go tooling filenames route to the .go icon', () => {
  const goIcon = setiIconFor('main.go');

  test('a plain .go file resolves to a real (non-default) icon', () => {
    // The default/unknown icon's own colour is `var(--kv-description-fg)` (setiFileIcon.ts's own
    // module doc comment) — a real language icon never resolves to that.
    expect(goIcon.color).not.toBe('var(--kv-description-fg)');
  });

  for (const name of ['go.mod', 'go.sum', 'go.work', 'go.work.sum']) {
    test(`${name} resolves to the same icon as a .go file, not the generic default`, () => {
      const icon = setiIconFor(name);
      expect(icon.maskUrl).toBe(goIcon.maskUrl);
      expect(icon.color).toBe(goIcon.color);
    });
  }

  test('a nested path still resolves go.mod correctly (basename-only matching)', () => {
    const icon = setiIconFor('backend/service/go.mod');
    expect(icon.maskUrl).toBe(goIcon.maskUrl);
    expect(icon.color).toBe(goIcon.color);
  });

  test('an unrelated file ending in "sum" is not swept up by the go.sum override', () => {
    // Guards the exact-basename match in GO_TOOLING_FILENAMES against a too-broad implementation
    // (e.g. a suffix/substring check) that would also catch something like "checksum".
    const icon = setiIconFor('checksum');
    expect(icon.maskUrl).not.toBe(goIcon.maskUrl);
  });
});
