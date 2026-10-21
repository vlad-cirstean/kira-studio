import { describe, expect, test } from 'bun:test';
import type { ChangeRequestRecord } from '@kira/git-ipc';
import { pickBestChangeRequest } from './refBadges.ts';

/**
 * `pickBestChangeRequest` is the one piece of D9's own graph-indicator logic with no DOM in it at all —
 * `buildChangeRequestBadge`/`buildRefBadges` (like `buildBadgeElement` before them) touch `document`, and per
 * this module's own doc comment there is no jsdom/happy-dom wired into `bun:test` in this repo, so
 * those stay exercised only by the Playwright tier. This file covers exactly the pure precedence
 * rule D9/§10.8 specify: `open > draft > merged > closed`, ties broken by most recently updated.
 */
function pr(
  partial: Partial<ChangeRequestRecord> & { readonly number: number },
): ChangeRequestRecord {
  return {
    title: 't',
    url: `https://github.com/o/r/pull/${partial.number}`,
    state: 'open',
    headRef: 'b',
    headSha: 's',
    baseRef: 'main',
    updatedAt: 0,
    ...partial,
  };
}

describe('pickBestChangeRequest', () => {
  test('returns undefined for an empty list', () => {
    expect(pickBestChangeRequest([])).toBeUndefined();
  });

  test('open beats draft, merged and closed', () => {
    const open = pr({ number: 1, state: 'open' });
    const draft = pr({ number: 2, state: 'draft' });
    const merged = pr({ number: 3, state: 'merged' });
    const closed = pr({ number: 4, state: 'closed' });
    expect(pickBestChangeRequest([closed, merged, draft, open])).toEqual(open);
  });

  test('draft beats merged and closed', () => {
    const draft = pr({ number: 2, state: 'draft' });
    const merged = pr({ number: 3, state: 'merged' });
    const closed = pr({ number: 4, state: 'closed' });
    expect(pickBestChangeRequest([closed, merged, draft])).toEqual(draft);
  });

  test('merged beats closed', () => {
    const merged = pr({ number: 3, state: 'merged' });
    const closed = pr({ number: 4, state: 'closed' });
    expect(pickBestChangeRequest([closed, merged])).toEqual(merged);
  });

  test('ties within the same state are broken by most recently updated', () => {
    const older = pr({ number: 1, state: 'closed', updatedAt: 1000 });
    const newer = pr({ number: 2, state: 'closed', updatedAt: 2000 });
    expect(pickBestChangeRequest([older, newer])).toEqual(newer);
  });

  test('a single PR is returned as-is', () => {
    const only = pr({ number: 5, state: 'draft' });
    expect(pickBestChangeRequest([only])).toEqual(only);
  });
});
