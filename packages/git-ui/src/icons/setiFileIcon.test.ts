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

// P7 (item 3): `seti-icons@0.0.4`'s own bundled definitions.json is stale for the TypeScript/TSX
// test-file pair (still yellow) — VS Code's own real vs-seti-icon-theme.json renders every test/spec
// file orange (#e37933), same glyph as the language's plain file. Confirmed against the real theme
// JSON during P7's own research pass (docs/v1.4/plans/P7-git-graph-polish.md §3.1).
describe('setiIconFor — test/spec files render orange, matching VS Code exactly', () => {
  const ORANGE = '#e37933';

  for (const name of [
    'foo.test.ts',
    'foo.spec.ts',
    'foo.test.tsx',
    'foo.spec.tsx',
    'foo.test.cjs',
    'foo.spec.cjs',
    'foo.test.mjs',
    'foo.spec.mjs',
  ]) {
    test(`${name} is orange, not seti-icons' own stale yellow`, () => {
      expect(setiIconFor(name).color).toBe(ORANGE);
    });
  }

  test('a plain .ts file (no test/spec) is unaffected — still blue', () => {
    expect(setiIconFor('foo.ts').color).toBe('#519aba');
  });

  test('.test.js/.spec.js were already correct and stay untouched by the override', () => {
    expect(setiIconFor('foo.test.js').color).toBe(ORANGE);
    expect(setiIconFor('foo.spec.js').color).toBe(ORANGE);
  });

  test('the glyph itself is unchanged by the color override — same icon as the plain file', () => {
    // The whole point of VS Code's own _typescript_1 icon def: identical fontCharacter to
    // _typescript, only fontColor differs. This repo's CSS-mask equivalent is maskUrl.
    expect(setiIconFor('foo.test.ts').maskUrl).toBe(setiIconFor('foo.ts').maskUrl);
  });

  test('a nested path still resolves the override correctly (basename-only matching)', () => {
    expect(setiIconFor('src/components/Widget.test.tsx').color).toBe(ORANGE);
  });
});

describe('setiIconFor — ignored files use VS Code’s own real ignore colour', () => {
  test('ignore colour is the real VS Code value, not the old guessed grey-light', () => {
    expect(setiIconFor('.gitignore').color).not.toBe('#6d8086');
  });
});
