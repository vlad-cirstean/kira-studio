import type {
  AdeBranch,
  AdeDependency,
  AdeNewWork,
  AdePair,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../frontend/src/ade/wire';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { showAllWork } from './support/ade';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P129 Part 6 §3.4: the detail panel end to end, under mocked control, `test:ui:space`. Fixture
// extends Part 5's own shape (`fullBranch`/`plan`/`snapshot`/`bootControl`/`snapshotControl`, same
// helpers, re-declared here per this directory's own convention — `ade-dialogs.spec.ts` and
// `ade-timeline.spec.ts` each keep their own copy rather than sharing one module). One `test()` per
// numbered §3.4 scenario; several scenarios use more than one branch/item in the same test where the
// business rule they exercise (a Jira/PR edge case, a Notes toolbar action) needs its own fresh item
// to avoid one item's state leaking into the next assertion.

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

function newWork(overrides: Partial<AdeNewWork> & Pick<AdeNewWork, 'id' | 'title'>): AdeNewWork {
  return {
    workType: 'work',
    startFrom: '',
    branchName: '',
    est: '',
    notes: '',
    jira: { key: '', url: '' },
    createdAt: Date.now(),
    ...overrides,
  };
}

function pair(overrides: Partial<AdePair> & Pick<AdePair, 'a' | 'b'>): AdePair {
  return { shared: [], conflicts: [], ...overrides };
}

function dependency(overrides: Partial<AdeDependency> & Pick<AdeDependency, 'id'>): AdeDependency {
  return {
    title: 'Dependency',
    waitingOn: '',
    expectedBy: null,
    createdAt: Date.now(),
    blocks: [],
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
 *  `ade-timeline.spec.ts`'s own per-test boot. */
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

function stackRow(id: string) {
  return `[data-testid="ade-stack-row"][data-ade-id="${id}"]`;
}

async function select(page: import('@playwright/test').Page, id: string): Promise<void> {
  await page.locator(stackRow(id)).click();
}

/** The Details tab's Jira/PR rows both render an `Input#ade-link-<Label>` plus a `Save` button
 *  when unset — a bare `getByRole('button', { name: 'Save' })` matches both rows at once, so every
 *  Save click is scoped to the one row's own input via its following sibling. */
function saveButtonFor(page: import('@playwright/test').Page, label: 'Jira' | 'PR') {
  return page.locator(`xpath=//input[@id="ade-link-${label}"]/following-sibling::button[1]`);
}

async function dragMouse(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

function settingsSetCalls(
  control: { log(): { channel: string; args: unknown }[] },
  needle: string,
) {
  return control
    .log()
    .filter((e) => e.channel === IPC.settingsSet && JSON.stringify(e.args).includes(needle));
}

// ---------------------------------------------------------------------------------------------
// 1. Resize
// ---------------------------------------------------------------------------------------------

test('resize: dragging the handle patches panelWidth (clamped at 340), a reload keeps the stored width, ArrowLeft grows it', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 });
  const snap = snapshot({ branches: [a], plan: plan({ a: TODAY_ISO }) });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.settingsSet,
        response: { ...defaultSettings, ade: { ...defaultSettings.ade, panelWidth: 340 } },
      },
      {
        channel: IPC.settingsSet,
        response: { ...defaultSettings, ade: { ...defaultSettings.ade, panelWidth: 341 } },
      },
    ],
  });

  const panel = page.locator('[data-testid="ade-detail-panel"]');
  await expect(panel).toBeVisible();

  const handle = page.locator('[data-testid="ade-panel-resize-handle"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle has no bounding box');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Drag far to the right — narrows the panel past the 340px floor, which clamps it there.
  await dragMouse(page, start, { x: start.x + 2000, y: start.y });
  await expect.poll(() => settingsSetCalls(control, '"panelWidth":340').length > 0).toBe(true);

  // ArrowLeft grows the panel from its current (now 340) effective width — asserted as a second,
  // larger settingsSet call rather than pinning the exact px delta (owned by AdePanelResizeHandle's
  // own arithmetic, not this phase's own concern).
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.settingsSet).length)
    .toBeGreaterThan(1);
  // The bound call's own args shape wraps the patch: {patch: {ade: {panelWidth}}}.
  const secondWidth = JSON.parse(
    JSON.stringify(control.log().filter((e) => e.channel === IPC.settingsSet)[1]?.args),
  ) as { patch?: { ade?: { panelWidth?: number } } };
  expect(secondWidth.patch?.ade?.panelWidth ?? 0).toBeGreaterThan(340);

  // A reload with a stored width renders the panel at exactly that width (not the "half" default).
  const { window: page2 } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      {
        channel: IPC.settingsGetAll,
        response: { ...defaultSettings, ade: { ...defaultSettings.ade, panelWidth: 400 } },
      },
      ...bootControl(),
      ...snapshotControl(snap),
    ],
  });
  await expect(page2.locator('[data-testid="ade-detail-panel"]')).toHaveCSS('width', '400px');
});

// ---------------------------------------------------------------------------------------------
// 2. Header actions and titles
// ---------------------------------------------------------------------------------------------

test('header: action labels open the right dialog title; Force push and merged Archive skip the dialog', async ({
  relaunch,
}) => {
  const rebaseMe = fullBranch({ id: 'rebase-me', branch: 'feat/rebase-me', behind: 1 });
  const stackRoot = fullBranch({ id: 'stack-root', branch: 'feat/stack-root' });
  const stackChild = fullBranch({
    id: 'stack-child',
    branch: 'feat/stack-child',
    base: 'stack-root',
    behind: 1,
  });
  const cf = fullBranch({ id: 'cf', branch: 'feat/cf' });
  const other = fullBranch({
    id: 'other',
    branch: 'feat/other',
    kind: 'review',
    owner: 'alice',
    authorEmail: 'alice@example.com',
    isMine: false,
  });
  const pushMe = fullBranch({ id: 'push-me', branch: 'feat/push-me', ahead: 1 });
  const merged = fullBranch({ id: 'merged', branch: 'feat/merged', merged: true });

  const snap = snapshot({
    branches: [rebaseMe, stackRoot, stackChild, cf, other, pushMe, merged],
    newWork: [newWork({ id: 'draft1', title: 'Draft one' })],
    plan: plan(
      {
        'rebase-me': TODAY_ISO,
        'stack-root': TODAY_ISO,
        'stack-child': TODAY_ISO,
        cf: TODAY_ISO,
        other: TODAY_ISO,
        'push-me': TODAY_ISO,
        merged: TODAY_ISO,
        draft1: TODAY_ISO,
      },
      { unpushed: { 'push-me': true } },
    ),
    pairs: [pair({ a: 'cf', b: 'other', conflicts: ['x.ts'] })],
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeForcePush, response: [{ branch: 'feat/push-me', kind: 'ok' }] },
      ...snapshotControl(snap),
      {
        channel: IPC.adeArchiveRisk,
        args: { codeRepoId: REPO.id, item: 'merged' },
        response: { dirty: [], unmerged: 0, worktree: '/tmp/wt/merged' },
      },
      {
        channel: IPC.adeArchive,
        args: { codeRepoId: REPO.id, item: 'merged', discard: true },
        response: null,
      },
      ...snapshotControl(snap),
    ],
  });
  await showAllWork(page);

  const dialog = page.locator('[data-testid="ade-dialog"]');

  await select(page, 'rebase-me');
  await page.locator('[data-testid="ade-panel-action-rebaseMain"]').click();
  await expect(dialog).toContainText('Rebase onto main');
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
  await expect(dialog).toHaveCount(0);

  await select(page, 'stack-child');
  await page.locator('[data-testid="ade-panel-action-rebaseStack"]').click();
  await expect(dialog).toContainText('Rebase stack');
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
  await expect(dialog).toHaveCount(0);

  await select(page, 'cf');
  await page.locator('[data-testid="ade-panel-action-queueAfter"]').click();
  await expect(dialog).toContainText('Queue after');
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
  await expect(dialog).toHaveCount(0);

  await select(page, 'draft1');
  await page.locator('[data-testid="ade-panel-action-start"]').click();
  await expect(dialog).toContainText('Start new work');
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
  await expect(dialog).toHaveCount(0);

  await select(page, 'push-me');
  await page.locator('[data-testid="ade-panel-action-forcePush"]').click();
  await expect(dialog).toHaveCount(0); // No dialog — forcePush dispatches directly.
  await expect.poll(() => control.log().some((e) => e.channel === IPC.adeForcePush)).toBe(true);

  await select(page, 'merged');
  await page.locator('[data-testid="ade-panel-action-archive"]').click();
  await expect(dialog).toHaveCount(0); // Nothing at risk — archives directly.
  await expect.poll(() => control.log().some((e) => e.channel === IPC.adeArchive)).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 3. Review item
// ---------------------------------------------------------------------------------------------

test('review item: read-only banner, no name input or estimate, read-only links, notes still write SetBranchMeta', async ({
  relaunch,
}) => {
  const rev = fullBranch({
    id: 'rev',
    branch: 'feat/rev',
    kind: 'review',
    owner: 'alice',
    authorEmail: 'alice@example.com',
    isMine: false,
  });
  const snap = snapshot({ branches: [rev], plan: plan({ rev: TODAY_ISO }) });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
    ],
  });

  await select(page, 'rev');
  await expect(page.locator('[data-testid="ade-panel-review-banner"]')).toContainText(
    'alice’s work',
  );
  await expect(page.locator('[data-testid="ade-name-input"]')).toHaveCount(0);
  await expect(page.locator('#ade-est-num')).toHaveCount(0);
  await expect(page.locator('[aria-label="Edit Jira link"]')).toHaveCount(0);

  const editor = page.locator('[data-testid="ade-notes-editor"] [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type('read-only notes');
  await page.locator('[data-testid="ade-panel-title"]').click(); // blur, forces flush.

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ notes: 'read-only notes' }),
        ),
    )
    .toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 4. Name
// ---------------------------------------------------------------------------------------------

test('name: a branch writes SetBranchMeta {name}, a draft writes UpdateNewWork {title}, Esc reverts without a write', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const draft1 = newWork({ id: 'draft1', title: 'Draft one' });
  const snap = snapshot({
    branches: [a],
    newWork: [draft1],
    plan: plan({ a: TODAY_ISO, draft1: TODAY_ISO }),
  });
  const renamedSnap = snapshot({
    branches: [a],
    newWork: [{ ...draft1, title: 'Renamed draft' }],
    plan: snap.plan,
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeUpdateNewWork, response: null },
      ...snapshotControl(renamedSnap),
    ],
  });

  await select(page, 'a');
  const nameInput = page.locator('[data-testid="ade-name-input"]');
  await nameInput.fill('Renamed branch');
  await nameInput.blur();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ name: 'Renamed branch' }),
        ),
    )
    .toBe(true);

  await select(page, 'draft1');
  const draftNameInput = page.locator('[data-testid="ade-name-input"]');
  await draftNameInput.fill('Renamed draft');
  await draftNameInput.blur();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeUpdateNewWork &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ title: 'Renamed draft' }),
        ),
    )
    .toBe(true);

  const writesBefore = control.log().length;
  await draftNameInput.fill('never sent');
  await draftNameInput.press('Escape');
  await expect(draftNameInput).toHaveValue('Renamed draft');
  expect(control.log().length).toBe(writesBefore);
});

// ---------------------------------------------------------------------------------------------
// 5. Jira
// ---------------------------------------------------------------------------------------------

test('jira: a pasted link writes {key,url}, a bare key writes an unlinked ref, garbage errors inline, Edit then empty Save clears', async ({
  relaunch,
}) => {
  const link = fullBranch({ id: 'link', branch: 'feat/link' });
  const bareKey = fullBranch({ id: 'bare-key', branch: 'feat/bare-key' });
  const garbage = fullBranch({ id: 'garbage', branch: 'feat/garbage' });
  const clear = fullBranch({
    id: 'clear',
    branch: 'feat/clear',
    jira: { key: 'GHI-789', url: 'https://jira.example.com/browse/GHI-789' },
  });

  const snap = snapshot({
    branches: [link, bareKey, garbage, clear],
    plan: plan({ link: TODAY_ISO, 'bare-key': TODAY_ISO, garbage: TODAY_ISO, clear: TODAY_ISO }),
  });

  const bareKeySnap = snapshot({
    branches: [link, { ...bareKey, jira: { key: 'DEF-456', url: '' } }, garbage, clear],
    plan: snap.plan,
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(bareKeySnap),
      { channel: IPC.adeSetBranchMeta, response: null },
    ],
  });

  await select(page, 'link');
  await page.locator('#ade-link-Jira').fill('https://jira.example.com/browse/ABC-123');
  await saveButtonFor(page, 'Jira').click();
  await expect
    .poll(() =>
      control.log().some(
        (e) =>
          e.channel === IPC.adeSetBranchMeta &&
          JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
            JSON.stringify({
              jira: { key: 'ABC-123', url: 'https://jira.example.com/browse/ABC-123' },
            }),
      ),
    )
    .toBe(true);

  await select(page, 'bare-key');
  await page.locator('#ade-link-Jira').fill('DEF-456');
  await saveButtonFor(page, 'Jira').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ jira: { key: 'DEF-456', url: '' } }),
        ),
    )
    .toBe(true);
  await select(page, 'garbage');
  const callsBefore = control.log().filter((e) => e.channel === IPC.adeSetBranchMeta).length;
  await page.locator('#ade-link-Jira').fill('nothing jira-shaped here');
  await saveButtonFor(page, 'Jira').click();
  await expect(page.locator('[data-testid="ade-link-row-error"]')).toContainText(
    'No Jira key found',
  );
  expect(control.log().filter((e) => e.channel === IPC.adeSetBranchMeta).length).toBe(callsBefore);

  await select(page, 'clear');
  await page.locator('[aria-label="Edit Jira link"]').click();
  const editInput = page.locator('#ade-link-Jira');
  await editInput.fill('');
  await saveButtonFor(page, 'Jira').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ jira: { key: '', url: '' } }),
        ),
    )
    .toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 6. PR
// ---------------------------------------------------------------------------------------------

test('pr: a valid link writes prUrl, an invalid one errors inline, a resolved PR shows its chip and title, a mismatched paste hides them', async ({
  relaunch,
}) => {
  const valid = fullBranch({ id: 'valid', branch: 'feat/valid' });
  const invalid = fullBranch({ id: 'invalid', branch: 'feat/invalid' });
  const resolved = fullBranch({ id: 'resolved', branch: 'feat/resolved' });
  const mismatched = fullBranch({
    id: 'mismatched',
    branch: 'feat/mismatched',
    prUrl: 'https://github.com/x/y/pull/42',
  });

  const snap = snapshot({
    branches: [valid, invalid, resolved, mismatched],
    plan: plan({
      valid: TODAY_ISO,
      invalid: TODAY_ISO,
      resolved: TODAY_ISO,
      mismatched: TODAY_ISO,
    }),
  });

  const prs: AdeRepoPrs = {
    kind: 'ok',
    webUrl: 'https://github.com/x/y',
    branches: {
      'feat/resolved': {
        number: 7,
        title: 'Fix the bug',
        url: 'https://github.com/x/y/pull/7',
        state: 'open',
      },
      'feat/mismatched': {
        number: 9,
        title: 'A different PR',
        url: 'https://github.com/x/y/pull/9',
        state: 'open',
      },
    },
  };

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap, prs),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap, prs),
    ],
  });

  await select(page, 'valid');
  await page.locator('#ade-link-PR').fill('https://github.com/x/y/pull/42');
  await saveButtonFor(page, 'PR').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ prUrl: 'https://github.com/x/y/pull/42' }),
        ),
    )
    .toBe(true);

  await select(page, 'invalid');
  const callsBefore = control.log().filter((e) => e.channel === IPC.adeSetBranchMeta).length;
  await page.locator('#ade-link-PR').fill('not a pr link');
  await saveButtonFor(page, 'PR').click();
  await expect(page.locator('[data-testid="ade-link-row-error"]')).toContainText(
    'Paste a GitHub PR link',
  );
  expect(control.log().filter((e) => e.channel === IPC.adeSetBranchMeta).length).toBe(callsBefore);

  await select(page, 'resolved');
  const detailsTab = page.locator('[data-testid="ade-details-tab"]');
  await expect(detailsTab.getByText('Fix the bug')).toBeVisible();
  await expect(detailsTab.getByText('Open', { exact: true })).toBeVisible();

  await select(page, 'mismatched');
  await expect(detailsTab.getByText('A different PR')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 7. Branch link
// ---------------------------------------------------------------------------------------------

test('branch link: href is webUrl/tree/<encoded>, click opens it externally, the copy button shows a checkmark', async ({
  relaunch,
}) => {
  const z = fullBranch({ id: 'z', branch: 'feat/z' });
  const snap = snapshot({ branches: [z], plan: plan({ z: TODAY_ISO }) });
  const prs: AdeRepoPrs = { kind: 'ok', branches: {}, webUrl: 'https://github.com/x/y' };

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl(), ...snapshotControl(snap, prs)],
  });

  await page.context().grantPermissions(['clipboard-read']);
  await select(page, 'z');

  const link = page.locator('a', { hasText: 'feat/z' });
  await expect(link).toHaveAttribute('href', 'https://github.com/x/y/tree/feat/z');
  await link.click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.linkOpenExternal)).toBe(true);

  await page.locator('[aria-label="Copy Branch link"]').click();
  await expect(page.locator('[aria-label="Copy Branch link"] .codicon-check')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 8. Estimate
// ---------------------------------------------------------------------------------------------

test('estimate: settable in hours or days; once set, extend-only (P135 §6.1)', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const snap = snapshot({ branches: [a], plan: plan({ a: TODAY_ISO }) });
  const withEst3d = snapshot({ branches: [{ ...a, est: '3d' }], plan: snap.plan });
  const withEst5d = snapshot({ branches: [{ ...a, est: '5d' }], plan: snap.plan });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(withEst3d),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(withEst5d),
    ],
  });

  await select(page, 'a');
  const estimateUnit = page.locator('fieldset[aria-label="Estimate unit"]');
  // Fresh value, settable in either unit before it's set — days chosen here.
  await page.locator('#ade-est-num').fill('3');
  await estimateUnit.getByRole('button', { name: 'days' }).click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ est: '3d' }),
        ),
    )
    .toBe(true);
  await expect(page.getByText('spans')).toBeVisible();

  // Once set: the toggle is gone, the total is read-only.
  await expect(estimateUnit).toHaveCount(0);
  await expect(page.locator('[data-testid="ade-estimate-total"]')).toHaveText('3d');

  // Typing into Extend by and blurring writes nothing on its own.
  const setBranchMetaCallsBefore = control
    .log()
    .filter((e) => e.channel === IPC.adeSetBranchMeta).length;
  const extendInput = page.locator('[data-testid="ade-estimate-extend"]');
  await extendInput.fill('2');
  await extendInput.blur();
  await page.waitForTimeout(100);
  expect(control.log().filter((e) => e.channel === IPC.adeSetBranchMeta).length).toBe(
    setBranchMetaCallsBefore,
  );

  // Extend adds to the total and the hint updates.
  await page.locator('[data-testid="ade-estimate-extend-submit"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBranchMeta &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ est: '5d' }),
        ),
    )
    .toBe(true);
  await expect(page.locator('[data-testid="ade-estimate-total"]')).toHaveText('5d');
});

// ---------------------------------------------------------------------------------------------
// 9. Notes
// ---------------------------------------------------------------------------------------------

test('notes: Bold/Checklist/Link toolbar actions produce Markdown, the checkbox click writes checked, a focused editor ignores a push refetch', async ({
  relaunch,
}) => {
  const bold = fullBranch({ id: 'bold', branch: 'feat/bold' });
  const checklist = fullBranch({ id: 'checklist', branch: 'feat/checklist' });
  const link = fullBranch({ id: 'link', branch: 'feat/link' });
  const focused = fullBranch({ id: 'focused', branch: 'feat/focused', notes: 'original' });

  const snap = snapshot({
    branches: [bold, checklist, link, focused],
    plan: plan({ bold: TODAY_ISO, checklist: TODAY_ISO, link: TODAY_ISO, focused: TODAY_ISO }),
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
      { channel: IPC.adeSetBranchMeta, response: null },
      ...snapshotControl(snap),
    ],
  });

  function notesOf(control_: { log(): { channel: string; args: unknown }[] }): string[] {
    return control_
      .log()
      .filter((e) => e.channel === IPC.adeSetBranchMeta)
      .map((e) => (e.args as { patch?: { notes?: string } } | undefined)?.patch?.notes ?? '');
  }

  await select(page, 'bold');
  const editor = page.locator('[data-testid="ade-notes-editor"] [contenteditable="true"]');
  await editor.click();
  await page.keyboard.type('hello');
  await editor.press('Control+a');
  await page.locator('[aria-label="Bold"]').click();
  await page.locator('[data-testid="ade-panel-title"]').click(); // blur, forces flush.
  await expect.poll(() => notesOf(control).some((n) => n.includes('**hello**'))).toBe(true);

  await select(page, 'checklist');
  const editor2 = page.locator('[data-testid="ade-notes-editor"] [contenteditable="true"]');
  await editor2.click();
  await page.keyboard.type('todo');
  await editor2.press('Control+a');
  await page.locator('[aria-label="Checklist"]').click();
  await page.locator('[data-testid="ade-panel-title"]').click();
  await expect.poll(() => notesOf(control).some((n) => n.includes('- [ ] todo'))).toBe(true);

  const checkbox = page.locator('[data-testid="ade-notes-editor"] input[type="checkbox"]');
  await checkbox.click();
  await page.locator('[data-testid="ade-panel-title"]').click();
  await expect.poll(() => notesOf(control).some((n) => n.includes('- [x] todo'))).toBe(true);

  await select(page, 'link');
  const editor3 = page.locator('[data-testid="ade-notes-editor"] [contenteditable="true"]');
  await editor3.click();
  await page.keyboard.type('linktext');
  await editor3.press('Control+a');
  await page.locator('[aria-label="Link"]').click();
  await page.locator('#ade-notes-link').fill('https://example.com');
  await page.locator('#ade-notes-link').press('Enter');
  await page.locator('[data-testid="ade-panel-title"]').click();
  await expect
    .poll(() => notesOf(control).some((n) => n.includes('[linktext](https://example.com)')))
    .toBe(true);

  await select(page, 'focused');
  const editor4 = page.locator('[data-testid="ade-notes-editor"] [contenteditable="true"]');
  await editor4.click();
  await page.keyboard.type(' typed while focused');
  // A push-driven refetch (nothing actually changed server-side) must not clobber the caret text
  // while this editor is still focused.
  await emitWailsEvent(page, IPC.adeRepo, { codeRepoId: REPO.id });
  await page.waitForTimeout(200);
  await expect(editor4).toContainText('original typed while focused');
});

// ---------------------------------------------------------------------------------------------
// 10. Draft base and candidate picker
// ---------------------------------------------------------------------------------------------

test('draft: the from-select writes UpdateNewWork {startFrom} ("" for main); the candidate picker calls BindNewWork and selects the bound branch', async ({
  relaunch,
}) => {
  const root = fullBranch({ id: 'root', branch: 'feat/root' });
  // A real branch's own id is its branch name (useQueue.ts's Item.base doc comment, Part 2 result) —
  // `onCandidatePick` selects by that raw branch string, so this fixture's id must match it for the
  // post-bind selection assertion below to resolve the right item.
  const candA = fullBranch({ id: 'feat/cand-a', branch: 'feat/cand-a' });
  const draft1 = newWork({
    id: 'draft1',
    title: 'Draft one',
    startFrom: 'root',
    branchCandidates: ['feat/cand-a', 'feat/cand-b'],
  });

  const snap = snapshot({
    branches: [root, candA],
    newWork: [draft1],
    plan: plan({ root: TODAY_ISO, 'feat/cand-a': TODAY_ISO, draft1: TODAY_ISO }),
  });

  const afterBase = snapshot({
    branches: [root, candA],
    newWork: [{ ...draft1, startFrom: '' }],
    plan: snap.plan,
  });

  const afterBind = snapshot({
    branches: [root, candA],
    newWork: [],
    plan: plan({ root: TODAY_ISO, 'feat/cand-a': TODAY_ISO }),
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeUpdateNewWork, response: null },
      ...snapshotControl(afterBase),
      { channel: IPC.adeBindNewWork, response: null },
      ...snapshotControl(afterBind),
      { channel: IPC.adeSessions, response: { sessions: [] } },
    ],
  });

  await select(page, 'draft1');
  await page.locator('#ade-draft-base').selectOption('');
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeUpdateNewWork &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ startFrom: '' }),
        ),
    )
    .toBe(true);

  await select(page, 'draft1');
  await expect(page.locator('[data-testid="ade-candidate-picker"]')).toBeVisible();
  await page.locator('[data-testid="ade-candidate-picker"] select').selectOption('feat/cand-a');
  await page
    .locator('[data-testid="ade-candidate-picker"]')
    .getByRole('button', { name: 'Use branch' })
    .click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeBindNewWork &&
            (e.args as { branch?: string } | undefined)?.branch === 'feat/cand-a',
        ),
    )
    .toBe(true);
  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('feat/cand-a');
});

// ---------------------------------------------------------------------------------------------
// 11. Changes tab
// ---------------------------------------------------------------------------------------------

test('changes tab: the conflicting branch shows red conflict files, the draft shows "created on Start"', async ({
  relaunch,
}) => {
  const cf = fullBranch({
    id: 'cf',
    branch: 'feat/cf',
    files: [
      { path: 'src/a.ts', added: 3, deleted: 1, binary: false },
      { path: 'src/b.ts', added: 2, deleted: 0, binary: false },
    ],
  });
  const other = fullBranch({
    id: 'other',
    branch: 'feat/other',
    kind: 'review',
    owner: 'alice',
    authorEmail: 'alice@example.com',
    isMine: false,
  });
  const draft1 = newWork({ id: 'draft1', title: 'Draft one' });

  const snap = snapshot({
    branches: [cf, other],
    newWork: [draft1],
    pairs: [pair({ a: 'cf', b: 'other', conflicts: ['src/a.ts'] })],
    plan: plan({ cf: TODAY_ISO, other: TODAY_ISO, draft1: TODAY_ISO }),
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl(), ...snapshotControl(snap)],
  });

  await select(page, 'cf');
  await page.locator('[data-testid="ade-panel-tab-changes"]').click();
  const conflictRow = page.locator('[data-testid="ade-changes-file-row"]', { hasText: 'src/a.ts' });
  await expect(conflictRow).toHaveClass(/f28b7d/);
  const cleanRow = page.locator('[data-testid="ade-changes-file-row"]', { hasText: 'src/b.ts' });
  await expect(cleanRow).not.toHaveClass(/f28b7d/);

  await select(page, 'draft1');
  await page.locator('[data-testid="ade-panel-tab-changes"]').click();
  await expect(page.getByText('created on Start')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 12. Agents tab
// ---------------------------------------------------------------------------------------------

test('agents: tabs per running session, amber input tint, terminal host for this window, Send, a session without a local terminal, +, and stopped Resume', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const snap = snapshot({ branches: [a], plan: plan({ a: TODAY_ISO }) });

  const SESSION_STOPPED: AdeSession = {
    id: 'sess-stopped',
    claudeSessionId: 'cs-stopped',
    codeRepoId: REPO.id,
    branch: 'feat/a',
    newWorkId: '',
    cwd: '/tmp/wt/a',
    state: 'stopped',
    terminalId: '',
    startedAt: 0,
    lastActiveAt: Date.now() - 60_000,
    cwdMissing: false,
  };

  // A running session with no local terminal — never opened in this window.
  const SESSION_ELSEWHERE: AdeSession = {
    id: 'sess-elsewhere',
    claudeSessionId: 'cs-elsewhere',
    codeRepoId: REPO.id,
    branch: 'feat/a',
    newWorkId: '',
    cwd: '/tmp/wt/a',
    state: 'running',
    terminalId: 'term-elsewhere',
    startedAt: 0,
    lastActiveAt: 0,
    cwdMissing: false,
  };

  const withLaunched: AdeSession = {
    id: 'sess-launched',
    claudeSessionId: 'cs-launched',
    codeRepoId: REPO.id,
    branch: 'feat/a',
    newWorkId: '',
    cwd: '/tmp/wt/a',
    state: 'running',
    terminalId: 'term-launched',
    startedAt: 0,
    lastActiveAt: 0,
    cwdMissing: false,
  };

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([SESSION_STOPPED]),
      ...snapshotControl(snap),
      {
        channel: IPC.adePrepareLaunch,
        // P129 Part 7 §0.2: this single snapshot answers both PrepareLaunch calls below (the "+"
        // launch, then the Resume Send) — the mock's own "list.length === 1" shortcut answers every
        // call on a channel with exactly one registered snapshot, regardless of its own args, so a
        // second call needs no separate literal-args fixture (this call's full args, message
        // included, can't be reproduced as a literal without real fragility).
        response: {
          terminalId: 'term-launched',
          sessionId: 'sess-launched',
          command: 'claude',
          cwd: '/tmp/wt/a',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      {
        channel: IPC.adeSessions,
        response: { sessions: [SESSION_STOPPED, SESSION_ELSEWHERE, withLaunched] },
      },
      { channel: IPC.adeSend, response: null },
    ],
  });

  await select(page, 'a');
  await page.locator('[data-testid="ade-panel-tab-agents"]').click();

  // No running session yet — the empty state, plus the Stopped list with a Resume button.
  await expect(page.locator('[data-testid="ade-agents-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-agents-stopped-row"]')).toBeVisible();

  // "+" launches a new session — the Start dialog, then Send calls PrepareLaunch + terminalOpen.
  // P135 deliverable (1): the button renders the codicon glyph, no hand-drawn SVG.
  const newSessionButton = page.locator('[data-testid="ade-agents-new"]');
  await expect(newSessionButton.locator('.codicon-add')).toHaveCount(1);
  await expect(newSessionButton.locator('svg')).toHaveCount(0);
  await newSessionButton.click();
  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toContainText('Start Claude Code');
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalOpen)).toBe(true);

  // §0.20: the active tab falls back to the first running session, which is `sess-elsewhere` here
  // (it was already running before this test's own launch) — never the session just launched, since
  // `sendStart` never calls `setAgentTab` (only the activity-icon hand-off, `openSession`, does).
  // That fallback session has no local terminal, so it shows the cross-window notice, not the host.
  await expect(page.locator('[data-testid="ade-agent-tab-sess-launched"]')).toBeVisible();
  await expect(page.getByText('Running in another window.')).toBeVisible();

  await page.locator('[data-testid="ade-agent-tab-sess-launched"]').click();
  await expect(page.locator('[data-testid="repo-terminal-host"]')).toBeVisible();

  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({
      terminalId: 'term-launched',
      event: 'Notification',
      sessionId: 'cs-launched',
      cwd: '/tmp/wt/a',
      notificationType: 'permission',
      message: 'needs a permission decision',
    }),
  );
  await expect(page.locator('[data-testid="ade-agents-tab"]')).toContainText('needs input');

  const message = page.locator('#ade-agent-input');
  await message.fill('go on');
  await message.press('Enter');
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSend &&
            (e.args as { sessionId?: string; message?: string } | undefined)?.sessionId ===
              'sess-launched' &&
            (e.args as { sessionId?: string; message?: string } | undefined)?.message === 'go on',
        ),
    )
    .toBe(true);

  await page.locator('[data-testid="ade-agent-tab-sess-elsewhere"]').click();
  await expect(page.getByText('Running in another window.')).toBeVisible();

  await page
    .locator('[data-testid="ade-agents-stopped-row"]')
    .getByRole('button', { name: 'Resume' })
    .click();
  await expect(dialog).toContainText('Resume Claude Code');

  // P129 Part 7 §0.2: clicking Send on the Resume dialog was never exercised before this part — it
  // shipped broken (branch/newWorkId both '', resume set to the Claude session id, which
  // `Tracker.Prepare` looks up as the record id and never finds). Confirm it now delivers with the
  // stopped record's own id/branch/newWorkId/cwd, and that PrepareLaunch is actually called a second
  // time (the single `adePrepareLaunch` snapshot above answers both calls regardless of args).
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adePrepareLaunch).length)
    .toBe(2);
  const resumeCall = control.log().filter((e) => e.channel === IPC.adePrepareLaunch)[1] as {
    args?: { resume?: string; branch?: string; newWorkId?: string; cwd?: string };
  };
  expect(resumeCall.args?.resume).toBe('sess-stopped');
  expect(resumeCall.args?.branch).toBe('feat/a');
  expect(resumeCall.args?.newWorkId).toBe('');
  expect(resumeCall.args?.cwd).toBe('/tmp/wt/a');
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.terminalOpen).length)
    .toBe(2);
});

// ---------------------------------------------------------------------------------------------
// 13. Hand-off
// ---------------------------------------------------------------------------------------------

test("hand-off: clicking a stack row's agents-pill button selects the branch, opens Agents and that session's tab", async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const b = fullBranch({ id: 'b', branch: 'feat/b' });
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
  const snap = snapshot({ branches: [a, b], plan: plan({ a: TODAY_ISO, b: TODAY_ISO }) });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...bootControl([SESSION_A]), ...snapshotControl(snap)],
  });

  await select(page, 'b'); // Something else selected first, so the hand-off is a real change.
  await page.locator('[data-testid="ade-agent-sess-a"]').click();

  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('feat/a');
  await expect(page.locator('[data-testid="ade-panel-tab-agents"]')).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(page.locator('[data-testid="ade-agent-tab-sess-a"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

// ---------------------------------------------------------------------------------------------
// 14. Reaper
// ---------------------------------------------------------------------------------------------

test('reaper: a stopped session (sessions push plus terminal exit) closes its terminal', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const snap = snapshot({ branches: [a], plan: plan({ a: TODAY_ISO }) });

  const RUNNING: AdeSession = {
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
  const STOPPED: AdeSession = { ...RUNNING, state: 'stopped', terminalId: '' };

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-a',
          sessionId: 'sess-a',
          command: 'claude',
          cwd: '/tmp/wt/a',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      { channel: IPC.adeSessions, response: { sessions: [RUNNING] } },
      { channel: IPC.terminalClose, response: null },
      { channel: IPC.adeSessions, response: { sessions: [STOPPED] } },
    ],
  });

  await select(page, 'a');
  await page.locator('[data-testid="ade-panel-tab-agents"]').click();
  await page.locator('[data-testid="ade-agents-new"]').click();
  const dialog = page.locator('[data-testid="ade-dialog"]');
  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalOpen)).toBe(true);
  await expect(page.locator('[data-testid="repo-terminal-host"]')).toBeVisible();

  // The terminal's own process exit, then the sessions push telling the reaper it's no longer running.
  await emitWailsEvent(page, IPC.terminal, { terminalId: 'term-a', exited: true, exitCode: 0 });
  await emitWailsEvent(page, IPC.adeSessionsChanged, {});

  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalClose)).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 15. Dependency panel (P135 §4.7)
// ---------------------------------------------------------------------------------------------

test('dependency panel: edits title, waiting-on and expected-by, Resolve moves it to history', async ({
  relaunch,
}) => {
  const dep = dependency({ id: 'dep-1', title: 'Vendor API', waitingOn: 'their release' });
  const snap = snapshot({ dependencies: [dep] });
  const snapLate = snapshot({
    dependencies: [{ ...dep, expectedBy: '2026-09-01' }], // Past TODAY_ISO — late with no blocks.
  });
  const snapResolved = snapshot({
    dependencies: [],
    history: [
      {
        item: 'dep-1',
        kind: 'dependency',
        title: 'Vendor API',
        branch: '',
        archivedAt: Date.now(),
        mergedAt: null,
      },
    ],
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeUpdateDependency, response: null },
      ...snapshotControl(snap),
      ...snapshotControl(snap),
      ...snapshotControl(snapLate),
      { channel: IPC.adeResolveDependency, response: null },
      ...snapshotControl(snapResolved),
    ],
  });
  await showAllWork(page);

  await select(page, 'dep-1');
  const details = page.locator('[data-testid="ade-dependency-details"]');
  await expect(details).toBeVisible();

  const nameInput = page.locator('[data-testid="ade-dependency-name-input"]');
  await nameInput.fill('Vendor API v2');
  await nameInput.blur();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeUpdateDependency &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ title: 'Vendor API v2' }),
        ),
    )
    .toBe(true);

  const waitingOnInput = page.locator('[data-testid="ade-dependency-waiting-on-input"]');
  await waitingOnInput.fill('their next release');
  await waitingOnInput.blur();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeUpdateDependency &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ waitingOn: 'their next release' }),
        ),
    )
    .toBe(true);

  const expectedByInput = page.locator('[data-testid="ade-dependency-expected-by-input"]');
  await expectedByInput.fill('2026-09-01');
  await expectedByInput.dispatchEvent('change');
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeUpdateDependency &&
            JSON.stringify((e.args as { patch?: unknown } | undefined)?.patch) ===
              JSON.stringify({ expectedBy: '2026-09-01' }),
        ),
    )
    .toBe(true);
  await expect(page.locator('[data-testid="ade-dependency-late"]')).toBeVisible();

  await page.locator('[data-testid="ade-panel-action-resolve"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeResolveDependency &&
            (e.args as { codeRepoId?: string; id?: string } | undefined)?.id === 'dep-1',
        ),
    )
    .toBe(true);
  await expect(page.locator('[data-testid="ade-detail-panel"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 16. Blocked-by (P135 §4.7)
// ---------------------------------------------------------------------------------------------

test('blocked-by: a blocked item panel shows the chip, unlink removes it, Link relinks it', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const dep = dependency({ id: 'dep-1', title: 'Vendor API', blocks: ['a'] });
  const snapLinked = snapshot({ branches: [a], plan: plan({ a: TODAY_ISO }), dependencies: [dep] });
  const snapUnlinked = snapshot({
    branches: [a],
    plan: plan({ a: TODAY_ISO }),
    dependencies: [{ ...dep, blocks: [] }],
  });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snapLinked),
      { channel: IPC.adeSetBlocker, response: null },
      ...snapshotControl(snapUnlinked),
      ...snapshotControl(snapLinked),
    ],
  });

  await select(page, 'a');
  const blockerRow = page.locator('[data-testid="ade-blocker-row"]');
  await expect(blockerRow).toBeVisible();
  const chip = page.locator('[data-testid="ade-blocker-chip-dep-1"]');
  await expect(chip).toContainText('Vendor API');

  await page.locator('[data-testid="ade-blocker-unlink-dep-1"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBlocker &&
            (e.args as { dependency?: string; item?: string; linked?: boolean } | undefined)
              ?.dependency === 'dep-1' &&
            (e.args as { item?: string } | undefined)?.item === 'a' &&
            (e.args as { linked?: boolean } | undefined)?.linked === false,
        ),
    )
    .toBe(true);
  await expect(chip).toHaveCount(0);

  await page.locator('[data-testid="ade-blocker-link-open"]').click();
  await page.locator('[data-testid="ade-blocker-link-option-dep-1"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetBlocker &&
            (e.args as { linked?: boolean } | undefined)?.linked === true,
        ),
    )
    .toBe(true);
  await expect(chip).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// P136. Work type
// ---------------------------------------------------------------------------------------------

test('work type: a branch lists four kinds; To test writes SetWorkType; a stored test item reads back', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a', ahead: 1 });
  const t = fullBranch({
    id: 'rt',
    branch: 'feat/rt',
    kind: 'review',
    workType: 'test',
    owner: 'alice',
    authorEmail: 'alice@example.com',
    isMine: false,
  });
  const snap = snapshot({ branches: [a, t], plan: plan({ a: TODAY_ISO, rt: TODAY_ISO }) });

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      { channel: IPC.adeSetWorkType, response: null },
      ...snapshotControl(snap),
    ],
  });

  const field = page.locator('[data-testid="ade-work-type"]');
  await select(page, 'a');
  await expect(field.locator('option')).toHaveCount(4);
  await expect(field).toHaveValue('work');
  await field.selectOption('test');

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSetWorkType &&
            JSON.stringify(e.args) ===
              JSON.stringify({ codeRepoId: REPO.id, item: 'a', workType: 'test' }),
        ),
    )
    .toBe(true);

  await select(page, 'rt');
  await expect(field).toHaveValue('test');
  await expect(field).toBeEnabled();
  await expect(page.locator('[data-testid="ade-panel-header"]')).toContainText('test');
  await expect(page.locator('[data-testid="ade-panel-mono"]')).toContainText('alice · test');
  await expect(page.locator('[data-testid="ade-name-input"]')).toHaveCount(0);
});

test('work type: a draft offers two kinds; review and test are disabled while blocked; a refused write shows the error and reverts', async ({
  relaunch,
}) => {
  const blocked = fullBranch({ id: 'blocked', branch: 'feat/blocked', ahead: 1 });
  const free = fullBranch({ id: 'free', branch: 'feat/free', ahead: 1 });
  const dep = dependency({ id: 'dep-1', title: 'Vendor API', blocks: ['blocked'] });
  const snap = snapshot({
    branches: [blocked, free],
    newWork: [newWork({ id: 'draft1', title: 'Draft one' })],
    plan: plan({ draft1: TODAY_ISO, blocked: TODAY_ISO, free: TODAY_ISO }),
    dependencies: [dep],
  });

  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl(),
      ...snapshotControl(snap),
      {
        channel: IPC.adeSetWorkType,
        error: { code: 'E_INVALID', message: 'work type refused' },
      },
    ],
  });

  const field = page.locator('[data-testid="ade-work-type"]');

  await select(page, 'draft1');
  await expect(field.locator('option')).toHaveCount(2);

  await select(page, 'blocked');
  await expect(field.locator('option[value="review"]')).toBeDisabled();
  await expect(field.locator('option[value="test"]')).toBeDisabled();
  await expect(field.locator('option[value="investigate"]')).toBeEnabled();

  await select(page, 'free');
  await field.selectOption('review');
  await expect(page.locator('[data-testid="ade-work-type-error"]')).toBeVisible();
  await expect(field).toHaveValue('work');
});
