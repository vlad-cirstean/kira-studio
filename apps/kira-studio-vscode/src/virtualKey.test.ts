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
