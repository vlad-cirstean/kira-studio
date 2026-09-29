import { describe, expect, test } from 'bun:test';
import { prRow } from '../../frontend/src/ade/links';
import { localIsoOfMs } from '../../frontend/src/ade/localDay';
import { myWorkCap } from '../../frontend/src/ade/myWorkCap';
import {
  LATER,
  type QueueBand,
  type QueueSegment,
  useQueue,
} from '../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeDependency,
  AdeNewWork,
  AdePair,
  AdePlan,
  AdePr,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
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
    workType: overrides.kind === 'review' ? 'review' : 'work',
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

function session(overrides: Partial<AdeSession> & Pick<AdeSession, 'id' | 'branch'>): AdeSession {
  return {
    claudeSessionId: 'abcdef12-0000-0000-0000-000000000000',
    codeRepoId: 'repo',
    newWorkId: '',
    cwd: '',
    state: 'running',
    terminalId: 't1',
    startedAt: 0,
    lastActiveAt: 0,
    cwdMissing: false,
    ...overrides,
  };
}

function newWork(overrides: Partial<AdeNewWork> & Pick<AdeNewWork, 'id'>): AdeNewWork {
  return {
    workType: 'work',
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

function dependency(overrides: Partial<AdeDependency> & Pick<AdeDependency, 'id'>): AdeDependency {
  return {
    title: 'Dep',
    waitingOn: '',
    expectedBy: null,
    createdAt: 0,
    blocks: [],
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
    dependencies: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '',
    ...overrides,
  };
}

const NO_PRS: AdeRepoPrs = { kind: 'ok', branches: {}, webUrl: '' };

function view(snap: AdeRepoSnapshot, overrides: Partial<Parameters<typeof useQueue>[0]> = {}) {
  return useQueue({
    snapshot: snap,
    sessions: [],
    activity: new Map(),
    prs: NO_PRS,
    settings: DEFAULT_SETTINGS,
    today: '2026-09-22',
    localDayOf: localIsoOfMs,
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
      webUrl: '',
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

  // P129 Part 5 §0.5/§3.1 — the parity spec's own mockup oracle has no zone concept at all (it
  // always computes a history day from the same process clock `useQueue` would), so the bug this
  // fixes (an evening local archive landing on the wrong UTC day) can only be exercised here, with
  // a hand-picked `localDayOf` standing in for a real caller in a non-UTC zone.
  test('6. history entry lands on localDayOf, not archivedAt own UTC-floor day', () => {
    // 03:00 UTC on today (2026-09-22) — 20:00 the previous evening in, say, US Pacific. A naive
    // `Math.floor(ms / DAY_MS)` would floor this to *today* (offset 0); the caller's own local day
    // (fed in via `localDayOf`, standing in for `localIsoOfMs` in a real non-UTC zone) says
    // yesterday (offset -1).
    const archivedAt = Date.UTC(2026, 8, 22, 3, 0);
    const snap = snapshot({
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
      history: [{ item: 'x', kind: 'archived', title: 'X title', branch: 'x-branch', archivedAt }],
    });
    const v = view(snap, { historyOpen: true, localDayOf: () => '2026-09-21' });
    const yesterday = v.bands.find((b) => b.day === -1);
    expect(yesterday?.history).toEqual([{ title: 'X title', branch: 'x-branch', how: 'archived' }]);
    const today = v.bands.find((b) => b.day === 0);
    expect(today?.history ?? []).toEqual([]);
  });

  test('7. band facts: iso, isMonday, weekend flags, nextWorkDay, overdueIds, startIds, overflowMoveLabel, isEmpty', () => {
    const settings: Settings['ade'] = {
      ...DEFAULT_SETTINGS,
      workWeekendDays: ['2026-09-26'], // that Saturday, worked
    };
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine', est: '480m' }), // 8h
        branch({ id: 'b', branch: 'feat/b', kind: 'mine', est: '120m' }), // 2h
        branch({ id: 'over', branch: 'feat/over', kind: 'mine', est: '60m' }), // 1h — 11h > 6h cap
        branch({ id: 'late', branch: 'feat/late', kind: 'mine' }), // past, unmerged: overdue
      ],
      plan: plan({
        day: { a: '2026-09-22', b: '2026-09-22', over: '2026-09-22', late: '2026-09-20' },
        order: ['a', 'b', 'over', 'late'],
      }),
    });
    const v = view(snap, { settings });

    // today (2026-09-22, a Tuesday): overflow moves all three (8+2+1=11h over a 6h cap).
    const today = v.bands.find((b) => b.day === 0) as QueueBand;
    expect(today.iso).toBe('2026-09-22');
    expect(today.isMonday).toBe(false);
    expect(today.isCalendarWeekend).toBe(false);
    expect(today.isEmpty).toBe(false);
    expect([...today.startIds].sort()).toEqual(['a', 'b', 'over']);
    expect(today.nextWorkDay).toBe(1);
    expect(today.nextWorkLabel).toBe('Wed 23');
    expect(today.overflowMoveLabel).toBe('Move to Wed 23 · 3 branches');

    // an empty weekday inside the horizon.
    const empty = v.bands.find((b) => b.day === 2) as QueueBand;
    expect(empty.isEmpty).toBe(true);
    expect(empty.startIds).toEqual([]);

    // the next Monday (offset 6, 2026-09-28).
    const monday = v.bands.find((b) => b.day === 6) as QueueBand;
    expect(monday.iso).toBe('2026-09-28');
    expect(monday.isMonday).toBe(true);

    // a worked weekend (offset 4, 2026-09-26): calendar weekend, exempted via workWeekendDays.
    const sat = v.bands.find((b) => b.day === 4) as QueueBand;
    expect(sat.iso).toBe('2026-09-26');
    expect(sat.isCalendarWeekend).toBe(true);
    expect(sat.isWorkedWeekend).toBe(true);
    expect(sat.isWeekend).toBe(false);

    // a past, unmerged, overdue lead segment.
    const late = v.bands.find((b) => b.day === -2) as QueueBand;
    expect(late.isOverdue).toBe(true);
    expect(late.overdueIds).toEqual(['late']);

    expect(v.firstWorkDay).toBe(0);
    expect(v.effDay.a).toBe(0);
  });

  test('8. dragIds exclude review members; QueueAction.tip only on Force push; cell/action tips', () => {
    const ARCHIVE_TIP =
      'Stop its agents, delete its worktree and hide it. The branch, notes and links are kept; it stays in history.';
    const snap = snapshot({
      branches: [
        branch({ id: 'rev', branch: 'someone/rev', kind: 'review', owner: 'someone' }),
        branch({ id: 'm2', branch: 'feat/m2', kind: 'mine', base: 'rev' }),
        branch({ id: 'up', branch: 'feat/up', kind: 'mine' }),
        branch({ id: 'bh', branch: 'feat/bh', kind: 'mine', behind: 2 }),
        branch({ id: 'st', branch: 'feat/st', kind: 'mine' }),
        branch({ id: 'st2', branch: 'feat/st2', kind: 'mine' }),
        branch({ id: 'mg', branch: 'feat/mg', kind: 'mine', merged: true }),
      ],
      plan: plan({ unpushed: { up: true } }),
    });
    const v = view(snap, {
      sessions: [session({ id: 's1', branch: 'feat/st', lastActiveAt: 12_345 })],
    });

    const stackSeg = v.segments.find((s) => s.members.some((m) => m.id === 'm2')) as QueueSegment;
    expect(stackSeg.dragIds).toEqual(['m2']);

    const upSeg = v.segments.find((s) => s.members.some((m) => m.id === 'up')) as QueueSegment;
    expect(upSeg.action?.kind).toBe('forcePush');
    expect(upSeg.action?.tip).toBe('git push --force-with-lease');

    const bhSeg = v.segments.find((s) => s.members.some((m) => m.id === 'bh')) as QueueSegment;
    expect(bhSeg.action?.kind).toBe('rebase');
    expect(bhSeg.action?.tip).toBe('');

    const stSeg = v.segments.find((s) => s.members.some((m) => m.id === 'st2')) as QueueSegment;
    expect(stSeg.cells[0]?.tip).toBe(stSeg.tag.tip);
    expect(stSeg.cells[0]?.action).toEqual({
      kind: 'start',
      id: 'st2',
      label: '▶ Start',
      tip: 'start Claude Code in its worktree',
    });

    const mgSeg = v.segments.find((s) => s.members.some((m) => m.id === 'mg')) as QueueSegment;
    expect(mgSeg.cells[0]?.action).toEqual({
      kind: 'archive',
      id: 'mg',
      label: 'Archive',
      tip: ARCHIVE_TIP,
    });

    const stItem = v.items.find((it) => it.id === 'st');
    expect(stItem?.agents).toEqual([
      { sessionId: 's1', label: 'claude abcdef12', kind: 'idle', lastActiveAt: 12_345 },
    ]);
  });

  // P129 Part 6 §3.3 — the panel deviations the parity spec's own default fixture never lands on:
  // `Rebase stack` (a design-only action, no mockup equivalent at all) across its six conditions.
  test('9. Rebase stack shown/hidden across its six conditions', () => {
    const stack = (overrides: {
      rootOverrides?: Partial<AdeBranch>;
      childOverrides?: Partial<AdeBranch>;
    }): AdeRepoSnapshot =>
      snapshot({
        branches: [
          branch({
            id: 'r',
            branch: 'feat/r',
            kind: 'mine',
            behind: 0,
            ...overrides.rootOverrides,
          }),
          branch({
            id: 'c',
            branch: 'feat/c',
            kind: 'mine',
            base: 'r',
            behind: 3,
            ...overrides.childOverrides,
          }),
        ],
      });

    const hasRebaseStack = (snap: AdeRepoSnapshot): boolean =>
      (view(snap, { selectedId: 'c' }).panel?.actions ?? []).some((a) => a.kind === 'rebaseStack');

    // baseline: shows.
    expect(hasRebaseStack(stack({}))).toBe(true);

    // (a) merged.
    expect(hasRebaseStack(stack({ childOverrides: { merged: true } }))).toBe(false);
    // (b) not mine (review).
    expect(hasRebaseStack(stack({ childOverrides: { kind: 'review', owner: 'them' } }))).toBe(
      false,
    );
    // (c) draft (no real branch yet).
    expect(hasRebaseStack(stack({ childOverrides: { exists: false } }))).toBe(false);
    // (d) no parent (base main — parentOf has no entry for it).
    expect(hasRebaseStack(stack({ childOverrides: { base: '' } }))).toBe(false);
    // (e) not behind (nothing to rebase onto).
    expect(hasRebaseStack(stack({ childOverrides: { behind: 0 } }))).toBe(false);
    // (f) root not mine.
    expect(hasRebaseStack(stack({ rootOverrides: { kind: 'review', owner: 'them' } }))).toBe(false);
    // (g) root itself behind main — Rebase-onto-main takes over instead.
    const rootBehind = stack({ rootOverrides: { behind: 2 } });
    expect(hasRebaseStack(rootBehind)).toBe(false);
    expect(
      (view(rootBehind, { selectedId: 'c' }).panel?.actions ?? []).some(
        (a) => a.kind === 'rebaseMain',
      ),
    ).toBe(true);
  });

  test('10. Start agent shows only with zero sessions ever, running or stopped', () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const hasStart = (sessions: AdeSession[]): boolean =>
      (view(snap, { sessions, selectedId: 'a' }).panel?.actions ?? []).some(
        (a) => a.kind === 'start',
      );

    expect(hasStart([])).toBe(true);
    expect(hasStart([session({ id: 's1', branch: 'feat/a', state: 'stopped' })])).toBe(false);
    expect(hasStart([session({ id: 's1', branch: 'feat/a', state: 'running' })])).toBe(false);
  });

  test('11. new-work mono line reads `no branch yet · <pos>` (design wins over the mockup order)', () => {
    const snap = snapshot({ newWork: [newWork({ id: 'd1', title: 'Some new thing' })] });
    const mono = view(snap, { selectedId: 'd1' }).panel?.mono;
    expect(mono?.startsWith('no branch yet · ')).toBe(true);
  });

  test('12. Force push label: no count suffix at N=1, "(2)" at N=2', () => {
    const one = snapshot({
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
      plan: plan({ unpushed: { a: true } }),
    });
    const oneAction = (view(one, { selectedId: 'a' }).panel?.actions ?? []).find(
      (a) => a.kind === 'forcePush',
    );
    expect(oneAction?.label).toBe('Force push');

    const two = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine' }),
        branch({ id: 'b', branch: 'feat/b', kind: 'mine', base: 'a' }),
      ],
      plan: plan({ unpushed: { a: true, b: true } }),
    });
    const twoAction = (view(two, { selectedId: 'a' }).panel?.actions ?? []).find(
      (a) => a.kind === 'forcePush',
    );
    expect(twoAction?.label).toBe('Force push (2)');
  });

  // P129 Part 6 §0.11/§3.3 — `prRow`'s own decision matrix (`links.ts`), direct unit coverage since
  // no parity scenario drives every combination of a resolved PR and a pasted-over one.
  describe('prRow', () => {
    const resolved: AdePr = {
      number: 42,
      title: 'Fix the thing',
      url: 'https://x/pull/42',
      state: 'open',
    };

    test('resolved only: chip and title from the resolved PR', () => {
      const r = prRow(resolved, '');
      expect(r).toEqual({
        url: 'https://x/pull/42',
        number: 42,
        chip: { label: 'Open', tone: 'green' },
        title: 'Fix the thing',
      });
    });

    test('pasted only: no chip, no title — just the link', () => {
      const r = prRow(undefined, 'https://x/pull/7');
      expect(r).toEqual({ url: 'https://x/pull/7', number: 7, chip: null, title: '' });
    });

    test('both, matching numbers: resolved chip and title still show', () => {
      const r = prRow(resolved, 'https://x/pull/42');
      expect(r.chip).toEqual({ label: 'Open', tone: 'green' });
      expect(r.title).toBe('Fix the thing');
      expect(r.url).toBe('https://x/pull/42');
    });

    test('both, differing numbers: pasted wins as a bare link, no chip/title', () => {
      const r = prRow(resolved, 'https://x/pull/99');
      expect(r).toEqual({ url: 'https://x/pull/99', number: 99, chip: null, title: '' });
    });

    test('neither on a review item: empty row', () => {
      const r = prRow(undefined, '');
      expect(r).toEqual({ url: '', number: null, chip: null, title: '' });
    });
  });

  // P135 §4.4/§7 — the scheduling rule (several interacting inputs: link set, merged items, Later,
  // expected date, past dates) is the only piece of the dependency kind this bar keeps a test for.
  describe('dependency', () => {
    test('unlinked with no date lands Later', () => {
      const snap = snapshot({ dependencies: [dependency({ id: 'dep:1' })] });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(LATER);
    });

    test('unlinked with a date lands on it', () => {
      const snap = snapshot({
        dependencies: [dependency({ id: 'dep:1', expectedBy: '2026-09-25' })],
      });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(3);
    });

    test("linked with no date lands on the blocked item's day", () => {
      const snap = snapshot({
        branches: [branch({ id: 'm1', branch: 'feat/m1', kind: 'mine' })],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1'] })],
        plan: plan({ day: { m1: '2026-09-24' } }),
      });
      const v = view(snap);
      expect(v.effDay.m1).toBe(2);
      expect(v.effDay['dep:1']).toBe(2);
    });

    test("linked with a later date lands on the item's day and is late", () => {
      const snap = snapshot({
        branches: [branch({ id: 'm1', branch: 'feat/m1', kind: 'mine' })],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1'], expectedBy: '2026-09-30' })],
        plan: plan({ day: { m1: '2026-09-24' } }),
      });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(2);
      expect(v.items.find((it) => it.id === 'dep:1')?.dependency?.late).toBe(true);
    });

    test('two blocked items take the earliest', () => {
      const snap = snapshot({
        branches: [
          branch({ id: 'm1', branch: 'feat/m1', kind: 'mine' }),
          branch({ id: 'm2', branch: 'feat/m2', kind: 'mine' }),
        ],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1', 'm2'] })],
        plan: plan({ day: { m1: '2026-09-27', m2: '2026-09-24' } }),
      });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(2);
    });

    test('a merged blocked item is ignored', () => {
      const snap = snapshot({
        branches: [
          branch({ id: 'm1', branch: 'feat/m1', kind: 'mine', merged: true }),
          branch({ id: 'm2', branch: 'feat/m2', kind: 'mine' }),
        ],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1', 'm2'] })],
        plan: plan({ day: { m1: '2026-09-23', m2: '2026-09-27' } }),
      });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(5);
    });

    test('a past date with no link is late', () => {
      const snap = snapshot({
        dependencies: [dependency({ id: 'dep:1', expectedBy: '2026-09-20' })],
      });
      const v = view(snap);
      expect(v.effDay['dep:1']).toBe(-2);
      expect(v.items.find((it) => it.id === 'dep:1')?.dependency?.late).toBe(true);
    });

    test('zero day hours', () => {
      const snap = snapshot({ dependencies: [dependency({ id: 'dep:1' })] });
      const v = view(snap);
      expect(v.bands.find((b) => b.isLater)?.hours).toBe(0);
    });

    test('no mergeN', () => {
      const snap = snapshot({ dependencies: [dependency({ id: 'dep:1' })] });
      const v = view(snap);
      const seg = v.segments.find((s) => s.stackRoot === 'dep:1');
      expect(seg?.mergeN).toEqual({});
    });

    test('absent from dragIds, startIds, overdueIds', () => {
      const snap = snapshot({
        dependencies: [dependency({ id: 'dep:1', expectedBy: '2026-09-20' })],
      });
      const v = view(snap);
      const seg = v.segments.find((s) => s.stackRoot === 'dep:1');
      expect(seg?.dragIds).toEqual([]);
      const band = v.bands.find((b) => b.day === -2);
      expect(band?.startIds ?? []).not.toContain('dep:1');
      expect(band?.overdueIds ?? []).not.toContain('dep:1');
    });

    test('blocked chip tone red only when late', () => {
      const onTime = snapshot({
        branches: [branch({ id: 'm1', branch: 'feat/m1', kind: 'mine' })],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1'] })],
        plan: plan({ day: { m1: '2026-09-24' } }),
      });
      const onTimeView = view(onTime);
      const onTimeSeg = onTimeView.segments.find((s) => s.members.some((m) => m.id === 'm1'));
      const onTimeIdx = onTimeSeg?.members.findIndex((m) => m.id === 'm1') ?? -1;
      expect(onTimeSeg?.cells[onTimeIdx]?.blocked?.tone).toBe('blue');

      const late = snapshot({
        branches: [branch({ id: 'm1', branch: 'feat/m1', kind: 'mine' })],
        dependencies: [dependency({ id: 'dep:1', blocks: ['m1'], expectedBy: '2026-09-30' })],
        plan: plan({ day: { m1: '2026-09-24' } }),
      });
      const lateView = view(late);
      const lateSeg = lateView.segments.find((s) => s.members.some((m) => m.id === 'm1'));
      const lateIdx = lateSeg?.members.findIndex((m) => m.id === 'm1') ?? -1;
      expect(lateSeg?.cells[lateIdx]?.blocked?.tone).toBe('red');
    });
  });
  // P136: the top-5 my-work cap ranks stacks, it never recomputes queue facts.
  describe('my work cap', () => {
    // Workdays from today (Tue 2026-09-22): offsets 0-4 then 6-8 skip the weekend.
    const DAYS = [
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ];

    function mine(id: string, extra: Partial<AdeBranch> = {}): AdeBranch {
      return branch({ id, branch: `feat/${id}`, kind: 'mine', ...extra });
    }

    function cap(snap: AdeRepoSnapshot) {
      return myWorkCap(view(snap));
    }

    test('7 mine stacks keep the earliest 5; hiddenCount counts the rest', () => {
      const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      const c = cap(
        snapshot({
          branches: ids.map((id) => mine(id)),
          plan: plan({ day: Object.fromEntries(ids.map((id, i) => [id, DAYS[i]])) }),
        }),
      );
      expect([...c.visibleRoots].sort()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
      expect(c.hiddenCount).toBe(2);
    });

    test('3 mine stacks hide nothing', () => {
      const c = cap(
        snapshot({
          branches: [mine('m0'), mine('m1'), mine('m2')],
          plan: plan({ day: { m0: DAYS[0], m1: DAYS[1], m2: DAYS[2] } }),
        }),
      );
      expect(c.hiddenCount).toBe(0);
    });

    test('an overdue stack ranks first', () => {
      const ids = ['m0', 'm1', 'm2', 'm3', 'm4'];
      const c = cap(
        snapshot({
          branches: [...ids.map((id) => mine(id)), mine('late')],
          plan: plan({
            day: { ...Object.fromEntries(ids.map((id, i) => [id, DAYS[i]])), late: '2026-09-21' },
          }),
        }),
      );
      expect(c.visibleRoots.has('late')).toBe(true);
      expect(c.visibleRoots.has('m4')).toBe(false);
    });

    test('an all-merged stack ranks after a Later one', () => {
      const c = cap(
        snapshot({
          branches: [
            mine('m0'),
            mine('m1'),
            mine('m2'),
            mine('m3'),
            mine('later'),
            mine('done', { merged: true }),
          ],
          plan: plan({
            day: { m0: DAYS[0], m1: DAYS[1], m2: DAYS[2], m3: DAYS[3], done: DAYS[0] },
          }),
        }),
      );
      expect(c.visibleRoots.has('later')).toBe(true);
      expect(c.visibleRoots.has('done')).toBe(false);
    });

    test('a two-segment stack counts once, ranked by its earliest day', () => {
      const c = cap(
        snapshot({
          branches: [
            mine('a'),
            mine('a2', { base: 'a' }),
            mine('b'),
            mine('c'),
            mine('d'),
            mine('e'),
            mine('f'),
          ],
          plan: plan({
            day: {
              a: DAYS[0],
              a2: DAYS[6],
              b: DAYS[1],
              c: DAYS[2],
              d: DAYS[3],
              e: DAYS[4],
              f: DAYS[5],
            },
          }),
        }),
      );
      expect([...c.visibleRoots].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(c.visibleItems.has('a2')).toBe(true);
      expect(c.hiddenCount).toBe(1);
    });

    test('a review root with a mine kid and a dated draft qualify; parked does not', () => {
      const c = cap(
        snapshot({
          branches: [
            branch({ id: 'r', branch: 'them/r', kind: 'review', owner: 'them' }),
            mine('k', { base: 'r' }),
            mine('p', { kind: 'parked' }),
          ],
          newWork: [newWork({ id: 'nw:1', title: 'Draft' })],
          plan: plan({ day: { r: DAYS[0], k: DAYS[0], p: DAYS[0], 'nw:1': DAYS[1] } }),
        }),
      );
      expect(c.visibleRoots.has('r')).toBe(true);
      expect(c.visibleItems.has('k')).toBe(true);
      expect(c.visibleRoots.has('nw:1')).toBe(true);
      expect(c.visibleRoots.has('p')).toBe(false);
      expect(c.hiddenCount).toBe(1);
    });

    test('a dependency shows only while it blocks a visible item', () => {
      const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      const c = cap(
        snapshot({
          branches: ids.map((id) => mine(id)),
          dependencies: [
            dependency({ id: 'dep:vis', blocks: ['m1'] }),
            dependency({ id: 'dep:hid', blocks: ['m6'] }),
            dependency({ id: 'dep:free' }),
          ],
          plan: plan({ day: Object.fromEntries(ids.map((id, i) => [id, DAYS[i]])) }),
        }),
      );
      expect(c.visibleRoots.has('dep:vis')).toBe(true);
      expect(c.visibleRoots.has('dep:hid')).toBe(false);
      expect(c.visibleRoots.has('dep:free')).toBe(false);
      expect(c.hiddenCount).toBe(4);
    });
  });
});
