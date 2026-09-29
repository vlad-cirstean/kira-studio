import type {
  AdeBranch,
  AdeCandidateBranch,
  AdeForcePushResult,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../frontend/src/ade/wire';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// P129 Part 5 §3.4: the timeline end to end, under mocked control, `test:ui:space`. Clock pinned to
// a Wednesday (`CLOCK_TIME`) so weekday/weekend assertions never depend on the day the suite
// happens to run — every test below relaunches with it. Split into one `test()` per §3.4 scenario
// (not one shared fixture per branch/history item the plan lists together) — `ade-module.spec.ts`'s
// own precedent in this same tier, and each scenario's own minimal fixture is easier to read and
// debug than one repo carrying all ten scenarios' state at once.

const TODAY_ISO = '2026-10-07'; // Wednesday.
const CLOCK_TIME = '2026-10-07T12:00:00';

const REPO = {
  id: 'repo-a',
  name: 'alpha',
  root: '/tmp/alpha',
  repoId: '/tmp/alpha',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EMPTY_PRS: AdeRepoPrs = { kind: 'ok', branches: {}, webUrl: '' };

function fullBranch(overrides: Partial<AdeBranch> & Pick<AdeBranch, 'id' | 'branch'>): AdeBranch {
  return {
    kind: 'mine',
    workType: overrides.kind === 'review' ? 'review' : 'work',
    name: '',
    draftTitle: '',
    startFrom: '',
    exists: true,
    ref: `refs/heads/${overrides.branch}`,
    tip: 'abc123',
    owner: 'me',
    authorEmail: 'me@example.com',
    isMine: true,
    lastCommitAt: Date.now(),
    base: '',
    ahead: 0,
    behind: 0,
    merged: false,
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
    addedAt: Date.now(),
    ...overrides,
  };
}

function plan(day: Record<string, string | null>, overrides: Partial<AdePlan> = {}): AdePlan {
  return { day, order: Object.keys(day), queuedAfter: {}, unpushed: {}, ...overrides };
}

function snapshot(overrides: Partial<AdeRepoSnapshot> = {}): AdeRepoSnapshot {
  return {
    codeRepoId: REPO.id,
    gitRepoId: REPO.id,
    main: { name: 'main', ref: 'origin/main', tip: 'abc123' },
    remote: 'origin',
    branches: [],
    newWork: [],
    plan: plan({}),
    colors: {},
    pairs: [],
    history: [],
    dependencies: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '/tmp/wt',
    ...overrides,
  };
}

function agentEvent(overrides: Record<string, unknown>) {
  return {
    terminalId: '',
    event: '',
    sessionId: '',
    cwd: '',
    toolName: '',
    toolUseId: '',
    notificationType: '',
    message: '',
    source: '',
    reason: '',
    ...overrides,
  };
}

/** Every scenario boots the same four calls before its own `adeRepoSnapshot`/`adeRepoPrs` —
 *  `windowsEnsure`/`codeWorkspaceListRepos`/`terminalAgentSessions`/`adeSessions`, same as
 *  `ade-module.spec.ts`'s own per-test boot. */
function bootControl(
  sessions: AdeSession[] = [],
  liveTerminals: { terminalId: string; cwd: string }[] = [],
): ControlSnapshot[] {
  return [
    { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
    { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
    { channel: IPC.terminalAgentSessions, response: { sessions: liveTerminals } },
    { channel: IPC.adeSessions, response: { sessions } },
  ];
}

function snapshotControl(snap: AdeRepoSnapshot, prs: AdeRepoPrs = EMPTY_PRS): ControlSnapshot[] {
  return [
    { channel: IPC.adeRepoSnapshot, args: { codeRepoId: REPO.id }, response: snap },
    { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO.id }, response: prs },
  ];
}

function dragBox(dataTestid: string) {
  return `[data-testid="${dataTestid}"]`;
}

/** SortableJS's own fallback drag (`forceFallback: true`) reacts to plain mouse events — down on
 *  the source, a small move past `fallbackTolerance` (4px) to arm it, then to the target, a beat
 *  for `AdeTimeline`'s own `useElementByPoint`/`watchEffect` to resolve the drop target, then up. */
async function dragMouse(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

async function centerOf(locator: ReturnType<import('@playwright/test').Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------------------------
// 1. Render
// ---------------------------------------------------------------------------------------------

test('render: separators, weekend/later ordering, continuation rows, overdue strip, agents/owner pills, merged tint, month label', async ({
  relaunch,
}) => {
  const SESSION_A: AdeSession = {
    id: 'sess-a',
    claudeSessionId: 'cs-a',
    codeRepoId: REPO.id,
    branch: 'feat/a',
    newWorkId: '',
    cwd: '/tmp/wt/a',
    state: 'running',
    terminalId: 'term-a',
    startedAt: 0,
    lastActiveAt: 0,
    cwdMissing: false,
  };

  const branches = [
    fullBranch({ id: 'overdue-a', branch: 'feat/overdue', ahead: 1 }),
    fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 }),
    fullBranch({ id: 'long', branch: 'feat/long', est: '3d' }),
    fullBranch({
      id: 'r',
      branch: 'feat/r',
      kind: 'review',
      owner: 'alice',
      authorEmail: 'alice@example.com',
      isMine: false,
    }),
    fullBranch({ id: 'r2', branch: 'feat/r2', base: 'r', ahead: 1 }),
    fullBranch({ id: 'm', branch: 'feat/m', merged: true }),
    // Far past the default 14-day horizon, in November — the one band whose own month differs
    // from every band before it, so `dayLabelWithMonth` suffixes its label (§3.4 "month label").
    fullBranch({ id: 's', branch: 'feat/s', ahead: 1 }),
  ];

  const snap = snapshot({
    branches,
    plan: plan({
      'overdue-a': '2026-10-05',
      a: TODAY_ISO,
      long: '2026-10-08',
      r: '2026-10-12',
      r2: '2026-10-12',
      m: '2026-10-06',
      s: '2026-11-01',
    }),
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([SESSION_A], [{ terminalId: 'term-a', cwd: '/tmp/wt/a' }]),
      ...snapshotControl(snap),
    ],
  });

  // Today band, Later band last, the day-range controls sit right above Later.
  await expect(page.locator(`${dragBox('ade-day-band')}[data-ade-day="0"]`)).toContainText('Today');
  const bands = page.locator(dragBox('ade-day-band'));
  await expect(bands.last()).toContainText('Later');
  await expect(page.locator('[data-testid="ade-more-week"]')).toBeVisible();
  await expect(page.locator('#ade-add-day')).toBeVisible();

  // Overdue strip: "Move to today" plus the note.
  const overdueBand = page.locator(`${dragBox('ade-day-band')}[data-ade-day="-2"]`);
  await expect(overdueBand).toContainText('1 stack not merged');
  await expect(overdueBand.locator('[data-testid="ade-band-rollover"]')).toHaveText(
    'Move to today',
  );

  // 3-day estimate: continuation rows on day 2 and day 3 (the end, weekend-skipping — Thu start,
  // Fri, then Monday since Sat/Sun are calendar weekends, §0.6's own `spanDays`).
  const continuations = page.locator('[data-testid="ade-continuation-row"]');
  await expect(continuations).toContainText(['day 2/3', 'day 3/3 · merges']);

  // Agents pill (session A) and owner pill (review R).
  await expect(page.locator('[data-testid="ade-agent-sess-a"]')).toBeVisible();
  await expect(page.locator(`${dragBox('ade-stack-row')}[data-ade-id="r"]`)).toContainText('alice');

  // Merged tint: the merged branch's own box carries the "✓ merged" tag.
  await expect(
    page.locator(dragBox('ade-stack-block')).filter({ hasText: '✓ merged' }),
  ).toBeVisible();

  // Month label: the Nov 1 band (offset 25) suffixes its label with the month name.
  await expect(page.locator(`${dragBox('ade-day-band')}[data-ade-day="25"]`)).toContainText('Nov');
});

// ---------------------------------------------------------------------------------------------
// 2. History pull and history bar
// ---------------------------------------------------------------------------------------------

test('history pull: wheel gesture states, 700ms reset, opening past 400, the history bar, and Go to date', async ({
  relaunch,
}) => {
  const NEAR_MS = new Date('2026-09-28T10:00:00').getTime(); // within the default 14-day window.
  const FAR_MS = new Date('2026-09-15T10:00:00').getTime(); // older than 14 days.

  const snap = snapshot({
    branches: [fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 })],
    plan: plan({ a: TODAY_ISO }),
    history: [
      {
        item: 'old',
        kind: 'mine',
        title: 'Old work',
        branch: 'feat/old',
        archivedAt: NEAR_MS,
        mergedAt: NEAR_MS,
      },
      {
        item: 'ancient',
        kind: 'mine',
        title: 'Ancient work',
        branch: 'feat/ancient',
        archivedAt: FAR_MS,
        mergedAt: null,
      },
    ],
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl(), ...snapshotControl(snap)],
  });

  const view = page.locator('[data-testid="ade-repo-view"]');
  const pull = page.locator('[data-testid="ade-history-pull"]');
  await expect(pull).toContainText('History · 1 archived in the last 2 weeks');

  await view.hover();
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(pull).toContainText('Keep scrolling up to open history');

  // No more wheel input: the 700ms reset (real time, the pinned clock resumed) brings the closed
  // label back.
  await page.waitForTimeout(750);
  await expect(pull).toContainText('History · 1 archived in the last 2 weeks');

  // Clicking the pull row opens history directly.
  await pull.click();
  await expect(page.locator('[data-testid="ade-history-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-hide-history"]')).toBeVisible();

  await page.locator('[data-testid="ade-hide-history"]').click();
  await expect(page.locator('[data-testid="ade-history-bar"]')).toHaveCount(0);
  await expect(pull).toBeVisible();

  // Wheel up past 400 opens it too (today's own band stays reachable — no assertion on exact
  // scrollTop, just that the band survives the open).
  await view.hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await expect(page.locator('[data-testid="ade-history-bar"]')).toBeVisible();
  await expect(page.locator(`${dragBox('ade-day-band')}[data-ade-day="0"]`)).toBeVisible();

  // Go to date older than 14 days reveals that day's own band.
  await page.locator('#ade-go-to-date').fill('2026-09-15');
  await expect(page.locator(`${dragBox('ade-day-band')}[data-ade-day="-22"]`)).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 3. Drag and drop
// ---------------------------------------------------------------------------------------------

test('drag and drop: direct parked apply, the Move dialog (with SetPlan before Send), box-to-box, parent-order refusal, and a review row bubbling to its box', async ({
  relaunch,
}) => {
  const branches = [
    fullBranch({ id: 'parked-x', branch: 'feat/parked', kind: 'parked' }),
    fullBranch({ id: 'parent-y', branch: 'feat/parent', ahead: 1 }),
    fullBranch({ id: 'child-y', branch: 'feat/child', base: 'parent-y', ahead: 1 }),
    fullBranch({ id: 'box-b', branch: 'feat/box-b', ahead: 1 }),
    fullBranch({
      id: 'review-r',
      branch: 'feat/review',
      kind: 'review',
      owner: 'alice',
      authorEmail: 'alice@example.com',
      isMine: false,
    }),
    fullBranch({ id: 'review-child', branch: 'feat/review-child', base: 'review-r', ahead: 1 }),
  ];

  const snap = snapshot({
    branches,
    plan: plan({
      'parent-y': '2026-10-12', // Monday, offset 5.
      'child-y': '2026-10-12',
      'box-b': '2026-10-08', // Thursday, offset 1.
      'review-r': '2026-10-08',
      'review-child': '2026-10-08',
    }),
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adeSetPlan,
        args: {
          codeRepoId: REPO.id,
          days: { 'parked-x': '2026-10-08' },
          order: snap.plan.order.concat('parked-x'),
        },
        response: null,
      },
      // Post-SetPlan refetch (onSettled invalidates the snapshot) — same fixture back is enough,
      // nothing in these assertions reads the refetched plan.day itself.
      ...snapshotControl(snap),
      // (c)'s own Move-dialog applyPlan — the plan the dialog closes over is the pristine `snap`
      // above (the refetch after (a) restores it, since this mock always answers with the same
      // fixture), so `child-y`'s own `movePlanArgs` computes off `snap.plan.order` untouched by (a).
      {
        channel: IPC.adeSetPlan,
        args: {
          codeRepoId: REPO.id,
          days: { 'child-y': '2026-10-13' },
          order: ['parent-y', 'box-b', 'review-r', 'review-child', 'child-y'],
        },
        response: null,
      },
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-new',
          sessionId: 'sess-new',
          command: 'claude',
          cwd: '/tmp/wt/new',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      ...snapshotControl(snap),
    ],
  });

  const day1Band = `${dragBox('ade-day-band')}[data-ade-day="1"]`;
  const day2Band = `${dragBox('ade-day-band')}[data-ade-day="2"]`;
  const day6Band = `${dragBox('ade-day-band')}[data-ade-day="6"]`;

  // (a) Parked P dropped on an empty workday band applies the plan directly — no dialog.
  const parkedRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="parked-x"]`);
  const day1Target = page.locator(day1Band);
  await dragMouse(page, await centerOf(parkedRow), await centerOf(day1Target));
  await expect(page.locator('[data-testid="ade-dialog"]')).toHaveCount(0);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetPlan &&
            (e.args as { days?: Record<string, string | null> } | undefined)?.days?.['parked-x'] ===
              '2026-10-08',
        ),
    )
    .toBe(true);

  // (b) Refusal: the child dragged to a future day still before its own parent's day — no dialog,
  // no call.
  const childRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="child-y"]`);
  const day2Target = page.locator(day2Band);
  const setPlanCallsBefore = control.log().filter((e) => e.channel === IPC.adeSetPlan).length;
  await dragMouse(page, await centerOf(childRow), await centerOf(day2Target));
  await expect(page.locator('[data-testid="ade-dialog"]')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(control.log().filter((e) => e.channel === IPC.adeSetPlan).length).toBe(setPlanCallsBefore);

  // (c) The child row dragged to a later workday opens the Move dialog; Send applies the plan
  // before delivering.
  const day6Target = page.locator(day6Band);
  await dragMouse(page, await centerOf(childRow), await centerOf(day6Target));
  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Move work');
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);

  const calls = control.log();
  const setPlanIdx = calls.findLastIndex((e) => e.channel === IPC.adeSetPlan);
  const launchIdx = calls.findIndex((e) => e.channel === IPC.adePrepareLaunch);
  expect(setPlanIdx).toBeGreaterThanOrEqual(0);
  expect(launchIdx).toBeGreaterThan(setPlanIdx);

  // (d) Box-to-box: dragging the review box (grabbed from within its own row, since a review row
  // itself carries no `data-ade-row-movable` — the drag bubbles to the block-level sortable, whose
  // ids are the segment's own non-review members) onto box B's box opens the dialog too.
  const reviewRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="review-r"]`);
  const boxBBox = page.locator(`${dragBox('ade-stack-box')}[data-ade-lead="box-b"]`);
  await dragMouse(page, await centerOf(reviewRow), await centerOf(boxBBox));
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Move work');
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
});

// ---------------------------------------------------------------------------------------------
// 4. Day menu
// ---------------------------------------------------------------------------------------------

test('day menu: mark a weekday as a day off with the move-or-leave confirm, and work-this-day on a weekend', async ({
  relaunch,
}) => {
  const snap = snapshot({
    branches: [fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 })],
    plan: plan({ a: '2026-10-08' }), // Thursday, offset 1.
  });

  const offDaysResponse = {
    ...defaultSettings,
    ade: { ...defaultSettings.ade, offDays: ['2026-10-08'] },
  };
  const revertResponse = { ...defaultSettings, ade: { ...defaultSettings.ade, offDays: [] } };
  const workWeekendResponse = {
    ...defaultSettings,
    ade: { ...defaultSettings.ade, workWeekendDays: ['2026-10-10'] },
  };

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.settingsSet,
        args: { ade: { offDays: ['2026-10-08'] } },
        response: offDaysResponse,
      },
      { channel: IPC.adeSetPlan, response: null },
      ...snapshotControl(snap),
      { channel: IPC.settingsSet, args: { ade: { offDays: [] } }, response: revertResponse },
      {
        channel: IPC.settingsSet,
        args: { ade: { workWeekendDays: ['2026-10-10'] } },
        response: workWeekendResponse,
      },
    ],
  });

  const workdayBand = page.locator(`${dragBox('ade-day-band')}[data-ade-day="1"]`);
  await workdayBand.click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  const toggleItem = menu.locator('[data-testid="menu-item-ade-day-toggle"]');
  await expect(toggleItem).toHaveText('Mark as day off');
  await toggleItem.click();

  await expect.poll(() => control.log().some((e) => e.channel === IPC.settingsSet)).toBe(true);

  const confirm = page.locator('[data-testid="ade-confirm-dialog"]');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('is a day off');
  await confirm.locator('[data-testid="ade-confirm-yes"]').click();
  await expect(confirm).toHaveCount(0);
  await expect.poll(() => control.log().some((e) => e.channel === IPC.adeSetPlan)).toBe(true);

  // Re-mark the same day off (fresh state, second offDays call — "Leave it" makes no plan call).
  await workdayBand.click({ button: 'right' });
  await menu.locator('[data-testid="menu-item-ade-day-toggle"]').click();
  const confirm2 = page.locator('[data-testid="ade-confirm-dialog"]');
  await expect(confirm2).toBeVisible();
  const setPlanCallsBefore = control.log().filter((e) => e.channel === IPC.adeSetPlan).length;
  await confirm2.locator('[data-testid="ade-confirm-no"]').click();
  await expect(confirm2).toHaveCount(0);
  expect(control.log().filter((e) => e.channel === IPC.adeSetPlan).length).toBe(setPlanCallsBefore);

  // A weekend day's own menu reads "Work this day".
  const weekendBand = page.locator(`${dragBox('ade-day-band')}[data-ade-day="3"]`); // Saturday.
  await weekendBand.click({ button: 'right' });
  await expect(toggleItem).toHaveText('Work this day');
  await toggleItem.click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.settingsSet && JSON.stringify(e.args).includes('workWeekendDays'),
        ),
    )
    .toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 5. Overdue and overflow
// ---------------------------------------------------------------------------------------------

test('overdue "Move to today" and overflow "Move to …" each call SetPlan with the shifted order', async ({
  relaunch,
}) => {
  const overdue = fullBranch({ id: 'overdue-a', branch: 'feat/overdue', ahead: 1 });
  // Six same-day mine branches, each a small estimate, to push the workday over its 6h capacity
  // and produce an overflow tail on that day.
  const overflowBranches = Array.from({ length: 4 }, (_, i) =>
    fullBranch({ id: `of-${i}`, branch: `feat/of-${i}`, ahead: 1, est: '2h' }),
  );

  const snap = snapshot({
    branches: [overdue, ...overflowBranches],
    plan: plan({
      'overdue-a': '2026-10-05',
      'of-0': '2026-10-08',
      'of-1': '2026-10-08',
      'of-2': '2026-10-08',
      'of-3': '2026-10-08',
    }),
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetPlan, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetPlan, response: null },
      ...snapshotControl(snap),
    ],
  });

  const overdueBand = page.locator(`${dragBox('ade-day-band')}[data-ade-day="-2"]`);
  await overdueBand.locator('[data-testid="ade-band-rollover"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetPlan &&
            (e.args as { days?: Record<string, string | null> } | undefined)?.days?.[
              'overdue-a'
            ] === TODAY_ISO,
        ),
    )
    .toBe(true);

  const overflowBand = page.locator(`${dragBox('ade-day-band')}[data-ade-day="1"]`);
  const overflowButton = overflowBand.locator('[data-testid="ade-band-overflow-move"]');
  await expect(overflowButton).toBeVisible();
  await overflowButton.click();
  await expect.poll(() => control.log().filter((e) => e.channel === IPC.adeSetPlan).length).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// 6. Force push
// ---------------------------------------------------------------------------------------------

test('force push: a pending state, a protected-branch confirm requiring the typed name, and a generic error', async ({
  relaunch,
}) => {
  const u = fullBranch({ id: 'u', branch: 'feat/u', ahead: 1 });
  const snap = snapshot({
    branches: [u],
    plan: plan({ u: '2026-10-08' }, { unpushed: { u: true } }),
  });

  const protectedResult: AdeForcePushResult[] = [
    {
      branch: 'feat/u',
      ok: false,
      error: { kind: 'ProtectedBranch', message: 'feat/u is protected' },
    },
  ];
  const genericResult: AdeForcePushResult[] = [
    { branch: 'feat/u', ok: false, error: { kind: 'Other', message: 'network is unreachable' } },
  ];

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adeForcePush,
        args: { codeRepoId: REPO.id, branches: ['u'] },
        response: protectedResult,
        hold: true,
      },
      ...snapshotControl(snap),
      // §0.16's own retry re-sends `[r.branch]` (the *result's* own branch name, `'feat/u'`) for
      // both `branches` and `confirmProtected` — not the original request's item id (`'u'`).
      {
        channel: IPC.adeForcePush,
        args: { codeRepoId: REPO.id, branches: ['feat/u'], confirmProtected: ['feat/u'] },
        response: genericResult,
      },
      ...snapshotControl(snap),
    ],
  });

  const pushButton = page.locator('[data-testid="ade-segment-action-forcePush"]');
  await expect(pushButton).toHaveText('Force push');
  await pushButton.click();
  await expect(pushButton).toBeDisabled();
  await expect(pushButton).toHaveText('Pushing…');

  control.release(IPC.adeForcePush);
  await expect(pushButton).toHaveText('Force push');

  const confirm = page.locator('[data-testid="ade-confirm-dialog"]');
  await expect(confirm).toBeVisible();
  const yesButton = confirm.locator('[data-testid="ade-confirm-yes"]');
  await expect(yesButton).toBeDisabled();
  // The confirm's own token is the result's branch name (`'feat/u'`), not the item id.
  await confirm.locator('[data-testid="ade-confirm-token"]').fill('feat/u');
  await expect(yesButton).toBeEnabled();
  await yesButton.click();

  await expect(confirm).toHaveCount(0);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeForcePush &&
            (e.args as { confirmProtected?: string[] } | undefined)?.confirmProtected?.[0] ===
              'feat/u',
        ),
    )
    .toBe(true);

  await expect(page.locator('[data-testid="ade-action-error"]')).toContainText(
    'network is unreachable',
  );
});

// ---------------------------------------------------------------------------------------------
// 7. Start from the action column
// ---------------------------------------------------------------------------------------------

test("start: the action column's ▶ Start opens the Start dialog, Send launches Claude", async ({
  relaunch,
}) => {
  const s = fullBranch({ id: 's', branch: 'feat/s', ahead: 1 });
  const snap = snapshot({ branches: [s], plan: plan({ s: '2026-10-08' }) });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-s',
          sessionId: 'sess-s',
          command: 'claude',
          cwd: '/tmp/wt/s',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
    ],
  });

  await page.locator('[data-testid="ade-cell-action-start-s"]').click();
  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Start Claude Code');
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adePrepareLaunch &&
            (e.args as { branch?: string } | undefined)?.branch === 's',
        ),
    )
    .toBe(true);
  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalOpen)).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 8. Archive end to end
// ---------------------------------------------------------------------------------------------

test('archive: Just delete on one merged branch, Send to Claude then archive on another', async ({
  relaunch,
}) => {
  const m = fullBranch({ id: 'm', branch: 'feat/m', merged: true });
  const m2 = fullBranch({ id: 'm2', branch: 'feat/m2', merged: true });
  const snap = snapshot({
    branches: [m, m2],
    plan: plan({ m: '2026-10-06', m2: '2026-10-06' }),
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adeArchiveRisk,
        args: { codeRepoId: REPO.id, item: 'm' },
        response: { dirty: ['file.ts'], unmerged: 0, worktree: '/tmp/wt/m' },
      },
      {
        channel: IPC.adeArchive,
        args: { codeRepoId: REPO.id, item: 'm', discard: true },
        response: null,
      },
      ...snapshotControl(snap),
      {
        channel: IPC.adeArchiveRisk,
        args: { codeRepoId: REPO.id, item: 'm2' },
        response: { dirty: [], unmerged: 1, worktree: '/tmp/wt/m2' },
      },
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-m2',
          sessionId: 'sess-m2',
          command: 'claude',
          cwd: '/tmp/wt/m2',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      {
        channel: IPC.adeArchive,
        args: { codeRepoId: REPO.id, item: 'm2', discard: false },
        response: null,
      },
      ...snapshotControl(snap),
    ],
  });

  await page.locator('[data-testid="ade-cell-action-archive-m"]').click();
  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-testid="ade-dialog-risk"]')).toBeVisible();
  await dialog.locator('[data-testid="ade-dialog-just-delete"]').click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeArchive &&
            (e.args as { item?: string; discard?: boolean } | undefined)?.item === 'm' &&
            (e.args as { discard?: boolean } | undefined)?.discard === true,
        ),
    )
    .toBe(true);

  await page.locator('[data-testid="ade-cell-action-archive-m2"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => control.log().some((e) => e.channel === IPC.adePrepareLaunch)).toBe(true);
  await emitStop(page, 'term-m2', 'sess-m2');
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeArchive &&
            (e.args as { item?: string; discard?: boolean } | undefined)?.item === 'm2' &&
            (e.args as { discard?: boolean } | undefined)?.discard === false,
        ),
    )
    .toBe(true);
});

async function emitStop(
  page: import('@playwright/test').Page,
  terminalId: string,
  sessionId: string,
) {
  const { emitWailsEvent } = await import('./support/mockRuntime');
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId, event: 'UserPromptSubmit', sessionId }),
  );
  await emitWailsEvent(page, IPC.agentEvent, agentEvent({ terminalId, event: 'Stop', sessionId }));
}

// ---------------------------------------------------------------------------------------------
// 9. Add popover
// ---------------------------------------------------------------------------------------------

test('add: New work parses the Jira field and picks a start-from branch; Existing branch searches and picks a candidate', async ({
  relaunch,
}) => {
  const startFromBranch = fullBranch({ id: 'base', branch: 'feat/base', ahead: 1 });
  const snap = snapshot({ branches: [startFromBranch], plan: plan({ base: TODAY_ISO }) });

  const candidates: AdeCandidateBranch[] = [
    {
      name: 'feat/mine-candidate',
      author: 'me',
      lastCommitAt: Date.now(),
      remoteOnly: false,
      mine: true,
    },
    {
      name: 'feat/their-candidate',
      author: 'bob',
      lastCommitAt: Date.now() - 3_600_000,
      remoteOnly: false,
      mine: false,
    },
  ];

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeAddNewWork, response: 'new-1' },
      ...snapshotControl(snap),
      { channel: IPC.adeCandidateBranches, args: { codeRepoId: REPO.id }, response: candidates },
      { channel: IPC.adeAddBranch, response: 'branch-1' },
      ...snapshotControl(snap),
    ],
  });

  await page.locator('[data-testid="ade-add-open"]').click();
  const popover = page.locator('[data-testid="ade-add-popover"]');
  await expect(popover).toBeVisible();

  await popover.locator('[data-testid="ade-add-title"]').fill('New feature');
  await popover
    .locator('[data-testid="ade-add-jira"]')
    .fill('https://issues.example.com/browse/ABC-123');
  await popover.locator('[data-testid="ade-add-start-from"]').selectOption('feat/base');
  await popover.locator('[data-testid="ade-add-submit-new"]').click();
  await expect(popover).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeAddNewWork &&
            (e.args as { title?: string; jiraKey?: string; startFrom?: string } | undefined)
              ?.title === 'New feature' &&
            (e.args as { jiraKey?: string } | undefined)?.jiraKey === 'ABC-123' &&
            (e.args as { startFrom?: string } | undefined)?.startFrom === 'feat/base',
        ),
    )
    .toBe(true);

  await page.locator('[data-testid="ade-add-open"]').click();
  await popover.locator('[data-testid="ade-add-tab-existing"]').click();
  await expect(popover.locator('[data-testid="ade-add-candidate"]')).toHaveCount(2);
  await popover.locator('[data-testid="ade-add-search"]').fill('their');
  const candidateRow = popover.locator(
    '[data-testid="ade-add-candidate"][data-branch="feat/their-candidate"]',
  );
  await expect(candidateRow).toContainText('bob');
  await candidateRow.click();
  await expect(popover).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeAddBranch &&
            (e.args as { branch?: string } | undefined)?.branch === 'feat/their-candidate',
        ),
    )
    .toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 10. Selection
// ---------------------------------------------------------------------------------------------

test('selection: a row click, the agent icon, and a continuation row all select, the continuation row scrolling to its start day', async ({
  relaunch,
}) => {
  const SESSION_A: AdeSession = {
    id: 'sess-a',
    claudeSessionId: 'cs-a',
    codeRepoId: REPO.id,
    branch: 'feat/a',
    newWorkId: '',
    cwd: '/tmp/wt/a',
    state: 'running',
    terminalId: 'term-a',
    startedAt: 0,
    lastActiveAt: 0,
    cwdMissing: false,
  };

  const snap = snapshot({
    branches: [
      fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 }),
      fullBranch({ id: 'b', branch: 'feat/b', ahead: 1 }),
      fullBranch({ id: 'long', branch: 'feat/long', est: '3d' }),
    ],
    plan: plan({ a: TODAY_ISO, b: '2026-10-09', long: '2026-10-08' }),
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([SESSION_A], [{ terminalId: 'term-a', cwd: '/tmp/wt/a' }]),
      ...snapshotControl(snap),
    ],
  });

  function selected(id: string) {
    return page.locator(`${dragBox('ade-stack-row')}[data-ade-id="${id}"][aria-selected="true"]`);
  }

  await page.locator(`${dragBox('ade-stack-row')}[data-ade-id="b"]`).click();
  await expect(selected('b')).toHaveCount(1);

  await page.locator('[data-testid="ade-agent-sess-a"]').click();
  await expect(selected('a')).toHaveCount(1);

  await page.locator('[data-testid="ade-continuation-row"]').first().click();
  await expect(selected('long')).toHaveCount(1);
  await expect(page.locator(`${dragBox('ade-day-band')}[data-ade-day="1"]`)).toBeInViewport();
});

// ---------------------------------------------------------------------------------------------
// 11. Dependency nodes (P135 §4.7)
// ---------------------------------------------------------------------------------------------

test('dependency: no drag attributes, lands on the blocked item\'s day with a blue "needed" tag and chip, a drop on it falls through to the band', async ({
  relaunch,
}) => {
  const blocked = fullBranch({ id: 'blocked', branch: 'feat/blocked', ahead: 1 });
  const parkedX = fullBranch({ id: 'parked-x', branch: 'feat/parked', kind: 'parked' });
  const snap = snapshot({
    branches: [blocked, parkedX],
    plan: plan({ blocked: '2026-10-08' }), // Thursday, offset 1.
    dependencies: [
      {
        id: 'dep-1',
        title: 'Vendor API',
        waitingOn: '',
        expectedBy: null,
        createdAt: Date.now(),
        blocks: ['blocked'],
      },
    ],
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adeSetPlan,
        args: {
          codeRepoId: REPO.id,
          days: { 'parked-x': '2026-10-08' },
          order: snap.plan.order.concat('parked-x'),
        },
        response: null,
      },
      ...snapshotControl(snap),
    ],
  });

  const depBox = page.locator(`${dragBox('ade-stack-box')}[data-ade-lead="dep-1"]`);
  await expect(depBox).toHaveAttribute('data-ade-dependency', '');
  await expect(depBox).not.toHaveAttribute('data-ade-box');
  await expect(depBox.locator('[data-ade-row-movable]')).toHaveCount(0);
  // Unlinked to no date of its own, blocking "blocked" (day offset 1) — the dependency's own box
  // lands on that same day.
  await expect(depBox).toHaveAttribute('data-ade-day', '1');

  const depBlock = page.locator(dragBox('ade-stack-block')).filter({ has: depBox });
  await expect(depBlock.getByText('needed', { exact: false })).toBeVisible();

  const chip = page.locator('[data-testid="ade-blocked-chip-blocked"]');
  await expect(chip).toContainText('1');

  // A drop on the dependency's own box falls through to the day band underneath it — no dialog,
  // a direct SetPlan (§0.12's own no-drag-target rule for a dependency segment).
  const parkedRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="parked-x"]`);
  await dragMouse(page, await centerOf(parkedRow), await centerOf(depBox));
  await expect(page.locator('[data-testid="ade-dialog"]')).toHaveCount(0);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetPlan &&
            (e.args as { days?: Record<string, string | null> } | undefined)?.days?.['parked-x'] ===
              '2026-10-08',
        ),
    )
    .toBe(true);
});

test('dependency: a later expectedBy than the blocked item\'s day shows "late" and the chip follows', async ({
  relaunch,
}) => {
  const blocked = fullBranch({ id: 'blocked', branch: 'feat/blocked', ahead: 1 });
  const snap = snapshot({
    branches: [blocked],
    plan: plan({ blocked: '2026-10-08' }), // Thursday, offset 1.
    dependencies: [
      {
        id: 'dep-1',
        title: 'Vendor API',
        waitingOn: '',
        expectedBy: '2026-10-12', // Monday, offset 5 — after the blocked item's own day.
        createdAt: Date.now(),
        blocks: ['blocked'],
      },
    ],
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl(), ...snapshotControl(snap)],
  });

  const depBox = page.locator(`${dragBox('ade-stack-box')}[data-ade-lead="dep-1"]`);
  const depBlock = page.locator(dragBox('ade-stack-block')).filter({ has: depBox });
  await expect(depBlock.getByText('late', { exact: true })).toBeVisible();

  const chip = page.locator('[data-testid="ade-blocked-chip-blocked"]');
  await expect(chip).toContainText('1');
});

// ---------------------------------------------------------------------------------------------
// 12. Jira line
// ---------------------------------------------------------------------------------------------

test('jira line: a linked item is 56px with a target="_blank" key link, an unlinked one stays 40px', async ({
  relaunch,
}) => {
  const withJira = fullBranch({
    id: 'with-jira',
    branch: 'feat/with-jira',
    ahead: 1,
    jira: { key: 'ABC-123', url: 'https://issues.example.com/browse/ABC-123' },
  });
  const plain = fullBranch({ id: 'plain', branch: 'feat/plain', ahead: 1 });
  const snap = snapshot({
    branches: [withJira, plain],
    plan: plan({ 'with-jira': TODAY_ISO, plain: TODAY_ISO }),
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl(), ...snapshotControl(snap)],
  });

  const jiraRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="with-jira"]`);
  const plainRow = page.locator(`${dragBox('ade-stack-row')}[data-ade-id="plain"]`);

  const jiraBox = await jiraRow.boundingBox();
  const plainBox = await plainRow.boundingBox();
  expect(jiraBox?.height).toBe(56);
  expect(plainBox?.height).toBe(40);

  const keyLink = jiraRow.locator('[data-testid="ade-row-jira"] a');
  await expect(keyLink).toHaveText('ABC-123');
  await expect(keyLink).toHaveAttribute('target', '_blank');
  await expect(keyLink).toHaveAttribute('href', 'https://issues.example.com/browse/ABC-123');

  await expect(plainRow.locator('[data-testid="ade-row-jira"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 13. Add popover: Dependency tab
// ---------------------------------------------------------------------------------------------

test('add: the Dependency tab creates one, selects it, and Blocks defaults to the selected item', async ({
  relaunch,
}) => {
  const target = fullBranch({ id: 'target', branch: 'feat/target', ahead: 1 });
  const snap = snapshot({ branches: [target], plan: plan({ target: TODAY_ISO }) });
  const withDep = snapshot({
    branches: [target],
    plan: snap.plan,
    dependencies: [
      {
        id: 'dep-1',
        title: 'Vendor API',
        waitingOn: 'their release',
        expectedBy: null,
        createdAt: Date.now(),
        blocks: ['target'],
      },
    ],
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeAddDependency, response: 'dep-1' },
      ...snapshotControl(withDep),
    ],
  });

  // Select the item first — the default Blocks pick, §4.8's own rule.
  await page.locator(`${dragBox('ade-stack-row')}[data-ade-id="target"]`).click();

  await page.locator('[data-testid="ade-add-open"]').click();
  const popover = page.locator('[data-testid="ade-add-popover"]');
  await popover.locator('[data-testid="ade-add-tab-dependency"]').click();

  await expect(popover.locator('[data-testid="ade-add-dependency-blocks"]')).toHaveValue('target');

  await popover.locator('[data-testid="ade-add-dependency-title"]').fill('Vendor API');
  await popover.locator('[data-testid="ade-add-dependency-waiting-on"]').fill('their release');
  await popover.locator('[data-testid="ade-add-dependency-submit"]').click();
  await expect(popover).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeAddDependency &&
            (e.args as { title?: string; waitingOn?: string; blocks?: string[] } | undefined)
              ?.title === 'Vendor API' &&
            (e.args as { waitingOn?: string } | undefined)?.waitingOn === 'their release' &&
            JSON.stringify((e.args as { blocks?: string[] } | undefined)?.blocks) ===
              JSON.stringify(['target']),
        ),
    )
    .toBe(true);

  await expect(
    page.locator(`${dragBox('ade-stack-row')}[data-ade-id="dep-1"][aria-selected="true"]`),
  ).toHaveCount(1);
});
