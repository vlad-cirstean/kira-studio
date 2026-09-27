import { describe, expect, test } from 'bun:test';
import { useQueue } from '../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeNewWork,
  AdePair,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
} from '../../frontend/src/ade/wire';
import type { Settings } from '../../frontend/src/state/settingsDomain';

// P129 Part 3 §3.2 — only what the parity spec (the mockup itself as oracle) structurally cannot
// reach: a design-wins-over-mockup divergence (1), non-default estimate constants (2), calendar
// label edge cases the default fixture never lands on (3), the title chain's own PR/Jira-key rungs
// with no mockup equivalent state to drive them (4), and a malformed-input guard the mockup itself
// has no way to construct (5, `useQueue`'s own defensive `byId.has()` checks).

const DEFAULT_SETTINGS: Settings['ade'] = {
  panelWidth: 0,
  allAgentsFilter: 'active',
  horizonDays: 14,
  historyDays: 14,
  extraDays: [],
  offDays: [],
  workWeekendDays: [],
  workdayHours: 6,
  spanDayShare: 0.5,
};

function branch(
  overrides: Partial<AdeBranch> & Pick<AdeBranch, 'id' | 'branch' | 'kind'>,
): AdeBranch {
  return {
    name: '',
    draftTitle: '',
    startFrom: '',
    exists: true,
    ref: `refs/heads/${overrides.branch}`,
    tip: '0000000',
    owner: '',
    authorEmail: '',
    isMine: overrides.kind === 'mine',
    lastCommitAt: 0,
    base: '',
    ahead: 0,
    behind: 0,
    merged: false,
    mergedAt: null,
    worktree: '',
    files: [],
    commits: [],
    commitCount: 0,
    dirty: [],
    upstream: '',
    upstreamAhead: 0,
    upstreamBehind: 0,
    jira: { key: '', url: '' },
    prUrl: '',
    est: '',
    notes: '',
    addedAt: 0,
    ...overrides,
  };
}

function newWork(overrides: Partial<AdeNewWork> & Pick<AdeNewWork, 'id'>): AdeNewWork {
  return {
    title: '',
    startFrom: '',
    branchName: '',
    est: '',
    notes: '',
    jira: { key: '', url: '' },
    createdAt: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<AdePlan> = {}): AdePlan {
  return { day: {}, order: [], queuedAfter: {}, unpushed: {}, ...overrides };
}

function snapshot(overrides: Partial<AdeRepoSnapshot> = {}): AdeRepoSnapshot {
  return {
    codeRepoId: 'repo',
    gitRepoId: 'repo',
    remote: 'origin',
    branches: [],
    newWork: [],
    plan: plan(),
    colors: {},
    pairs: [],
    history: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '',
    ...overrides,
  };
}

const NO_PRS: AdeRepoPrs = { kind: 'ok', branches: {} };

function view(snap: AdeRepoSnapshot, overrides: Partial<Parameters<typeof useQueue>[0]> = {}) {
  return useQueue({
    snapshot: snap,
    sessions: [],
    activity: new Map(),
    prs: NO_PRS,
    settings: DEFAULT_SETTINGS,
    today: '2026-09-22',
    ...overrides,
  });
}

describe('ade-queue-rules', () => {
  test('1. file overlap mine×review without `conflicts` is not a conflict (§0.3)', () => {
    const pairs: AdePair[] = [{ a: 'm1', b: 'r1', shared: ['src/shared.ts'], conflicts: [] }];
    const snap = snapshot({
      branches: [
        branch({
          id: 'm1',
          branch: 'feat/m1',
          kind: 'mine',
          files: [{ path: 'src/shared.ts', added: 1, deleted: 0, binary: false }],
        }),
        branch({
          id: 'r1',
          branch: 'someone/r1',
          kind: 'review',
          owner: 'someone',
          files: [{ path: 'src/shared.ts', added: 2, deleted: 0, binary: false }],
        }),
      ],
      pairs,
    });
    const v = view(snap);
    const m1 = v.items.find((it) => it.id === 'm1');
    expect(m1?.status.label).not.toBe('conflict');
    // still "new" (no sessions) rather than up to date, but definitely not conflict/red.
    expect(m1?.status.tone).not.toBe('red');
  });

  test('2. workdayHours 8 / spanDayShare 0.25: 1d/3d/1w hours+spans, capacity 8', () => {
    const settings: Settings['ade'] = { ...DEFAULT_SETTINGS, workdayHours: 8, spanDayShare: 0.25 };
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine', est: '1d' }),
        branch({ id: 'b', branch: 'feat/b', kind: 'mine', est: '3d' }),
        branch({ id: 'c', branch: 'feat/c', kind: 'mine', est: '1w' }),
      ],
      plan: plan({ day: { a: '2026-09-22', b: '2026-09-23', c: '2026-09-24' } }),
    });
    const v = view(snap, { settings });
    const byId = new Map(v.items.map((it) => [it.id, it] as const));
    expect(byId.get('a')?.estimate).toEqual({ hours: 8, days: 1 });
    expect(byId.get('b')?.estimate).toEqual({ hours: 6, days: 3 }); // 3 * 8 * 0.25
    expect(byId.get('c')?.estimate).toEqual({ hours: 10, days: 5 }); // ceil(1*5) * 8 * 0.25
    expect(v.bands.every((b) => b.capacity === 8)).toBe(true);
  });

  test('3. month/year boundary band labels; today on a Saturday', () => {
    const monthSnap = snapshot({ branches: [] });
    const monthView = view(monthSnap, {
      today: '2026-01-29', // Thursday
      settings: { ...DEFAULT_SETTINGS, horizonDays: 5, historyDays: 0 },
    });
    // day offset 3 = 2026-02-01, the first day whose month differs from the previous band's.
    const febBand = monthView.bands.find((b) => b.day === 3);
    expect(febBand?.label).toBe('Sun 1 Feb');

    const yearSnap = snapshot({ branches: [] });
    const yearView = view(yearSnap, {
      today: '2025-12-30', // Tuesday
      settings: { ...DEFAULT_SETTINGS, horizonDays: 4, historyDays: 0 },
    });
    const janBand = yearView.bands.find((b) => b.day === 2); // 2026-01-01
    expect(janBand?.label).toBe('Thu 1 Jan');

    const satSnap = snapshot({ branches: [] });
    const satView = view(satSnap, {
      today: '2026-01-31', // Saturday
      settings: { ...DEFAULT_SETTINGS, horizonDays: 1, historyDays: 0 },
    });
    const todayBand = satView.bands.find((b) => b.day === 0);
    expect(todayBand?.label).toBe('Today');
    expect(todayBand?.isWeekend).toBe(true);
  });

  test('4. title chain: PR title when no name/draft; Jira key when no branch and no title', () => {
    const snap = snapshot({
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
      newWork: [newWork({ id: 'd1', title: '', jira: { key: 'ABC-1', url: 'https://x/ABC-1' } })],
    });
    const prs: AdeRepoPrs = {
      kind: 'ok',
      branches: { 'feat/a': { number: 1, title: 'PR Title A', url: '', state: 'Open' } },
    };
    const v = view(snap, { prs });
    expect(v.items.find((it) => it.id === 'a')?.title).toBe('PR Title A');
    expect(v.items.find((it) => it.id === 'd1')?.title).toBe('ABC-1');
  });

  test('5. stale plan.order/queuedAfter naming a missing item is ignored, not thrown', () => {
    const snap = snapshot({
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
      plan: plan({ order: ['a', 'ghost'], queuedAfter: { a: 'ghost', ghost2: 'a' } }),
    });
    expect(() => view(snap)).not.toThrow();
    const v = view(snap);
    expect(v.items.map((it) => it.id)).toEqual(['a']);
    // the stale `queuedAfter` entries are both ignored — 'a' keeps no parent.
    expect(v.segments.some((s) => s.after !== null)).toBe(false);
  });
});
