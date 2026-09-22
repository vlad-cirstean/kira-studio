/**
 * G12 D11/D17 — the round trip that shipped broken: `RepoID` is an absolute worktree root, so a
 * real key always starts with `/`, and `vscode-uri`'s `Uri.parse` throws on a path that begins
 * `//` once percent-decoded. This corpus keeps the exact edge case that threw, plus the other
 * shapes a real key takes, all provable with no `vscode` import.
 */
import { describe, expect, test } from 'bun:test';
import { decodeKey, encodeKey, parseVirtualKey, virtualKey } from './virtualKey.ts';

describe('encodeKey/decodeKey', () => {
  const corpus: ReadonlyArray<{ readonly name: string; readonly key: string }> = [
    {
      name: 'an absolute repo root (every real repo, G3 D7) — the shape that threw',
      key: virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/main.ts'),
    },
    {
      name: 'a path with a space',
      key: virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/some file.ts'),
    },
    {
      name: 'a non-ASCII filename',
      key: virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/café/résumé.ts'),
    },
    {
      name: "a rename's originalPath side",
      key: virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/old-name.ts'),
    },
  ];

  for (const { name, key } of corpus) {
    test(`round-trips: ${name}`, () => {
      const encoded = encodeKey(key);
      // base64url's alphabet — never a `/`, so it can never collide with the URI's own path
      // separators or begin a segment with `//` once a host decodes it.
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeKey(encoded)).toBe(key);
      expect(parseVirtualKey(decodeKey(encoded))).toEqual(parseVirtualKey(key));
    });
  }
});

// G13 D8a: the fourth field is what marks a document as the branch-tip side of a review diff —
// present only there, and its round trip must not disturb the three-part shape every existing
// caller (editor.openDiff, editor.goToFile) still relies on.
describe('the optional fourth field (G13 D8a)', () => {
  test('a four-part key round-trips with reviewBranch set', () => {
    const key = virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/main.ts', 'feature/login');
    const encoded = encodeKey(key);
    expect(decodeKey(encoded)).toBe(key);
    expect(parseVirtualKey(decodeKey(encoded))).toEqual({
      repoId: '/Users/me/code/kira-studio',
      rev: 'abc1234',
      path: 'src/main.ts',
      reviewBranch: 'feature/login',
    });
  });

  test('an empty fourth part is rejected, not treated as absent', () => {
    const threePart = virtualKey('/Users/me/code/kira-studio', 'abc1234', 'src/main.ts');
    expect(parseVirtualKey(`${threePart}\0`)).toBeUndefined();
  });

  test('a five-part key is rejected', () => {
    const fourPart = virtualKey(
      '/Users/me/code/kira-studio',
      'abc1234',
      'src/main.ts',
      'feature/login',
    );
    expect(parseVirtualKey(`${fourPart}\0extra`)).toBeUndefined();
  });
});
