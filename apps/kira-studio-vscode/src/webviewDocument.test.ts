/**
 * G30 round-1 architecture/security review, finding #3: `buildWebviewDocument`'s bootstrap island
 * used bare `JSON.stringify`, which does not escape "<" — a repository-controlled string reaching
 * `bootstrap` (a branch name, via `review.open`) that contains `</script>` closes the JSON island
 * early and injects markup into the document. `git check-ref-format` permits "<"/">" in a branch
 * name, so this is reachable with a perfectly valid ref, not a contrived one.
 */
import { describe, expect, test } from 'bun:test';
import { buildWebviewDocument } from './webviewDocument.ts';

const baseOpts = {
  scriptUrl: 'https://example.invalid/main.js',
  styleUrls: [],
  cspSource: 'https://example.invalid',
  view: 'review' as const,
  nonce: 'test-nonce',
};

describe('buildWebviewDocument bootstrap island', () => {
  test('a branch name containing </script> cannot close the JSON island early', () => {
    const hostileBranch = 'a</script><script>window.__pwned = true;</script>';
    const html = buildWebviewDocument({
      ...baseOpts,
      bootstrap: { target: { repoId: '/repo', branch: hostileBranch } },
    });

    const islandMatch = html.match(
      /<script type="application\/json" id="kira-bootstrap">([\s\S]*?)<\/script>/,
    );
    expect(islandMatch).not.toBeNull();
    const islandBody = islandMatch?.[1] ?? '';

    // The island's own body must contain no case-insensitive "</script" — if it did, the browser
    // would treat that as the real closing tag regardless of surrounding JSON syntax.
    expect(islandBody.toLowerCase()).not.toContain('</script');

    // The escaped text must still decode back to the exact original string — this is a JSON-safe
    // encoding of "<", not data loss.
    const parsed = JSON.parse(islandBody) as { target: { branch: string } };
    expect(parsed.target.branch).toBe(hostileBranch);

    // And the document must contain exactly the two script tags this function itself emits — no
    // extra tag the hostile branch name managed to inject.
    expect(html.match(/<script/g)?.length).toBe(2);
  });

  test('an ordinary bootstrap round-trips unchanged', () => {
    const html = buildWebviewDocument({
      ...baseOpts,
      bootstrap: { target: { repoId: '/repo', branch: 'feature/normal-branch' } },
    });
    const islandMatch = html.match(
      /<script type="application\/json" id="kira-bootstrap">([\s\S]*?)<\/script>/,
    );
    const parsed = JSON.parse(islandMatch?.[1] ?? '') as { target: { branch: string } };
    expect(parsed.target.branch).toBe('feature/normal-branch');
  });
});
