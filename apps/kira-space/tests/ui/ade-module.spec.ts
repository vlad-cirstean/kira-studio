import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P129 Part 3 §3.3: `ade`'s own full-area shell, data layer and the 6 §2.7 components, under
// mocked control — a fresh `relaunch()` per test (this fixture tier's own convention, modules.spec.ts's
// own three tests do the same), each booting straight into `windowsEnsure → { mode: 'ade' }`. Relative
// time text (§0.16's `ago`) reads off the real wall clock at fixture-build time rather than a pinned
// `page.clock`: VueUse's `useTimeAgo` re-derives from its own periodic tick, which a clock frozen
// *after* boot does not reliably force a resync of — every assertion below still runs well inside the
// same minute a fixture's `lastFetchAt` was built against.

function repoTab(page: Page, repoId: string) {
  return page.locator(`[data-testid="ade-repo-tab"][data-repo-id="${repoId}"]`);
}

function modeTab(page: Page, mode: 'git' | 'terminal' | 'ade') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

const REPO_A = {
  id: 'repo-a',
  name: 'alpha',
  root: '/tmp/alpha',
  repoId: '/tmp/alpha',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const REPO_B = {
  id: 'repo-b',
  name: 'beta',
  root: '/tmp/beta',
  repoId: '/tmp/beta',
  sortOrder: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SESSION_A = {
  id: 's-a',
  claudeSessionId: 'cs-a',
  codeRepoId: REPO_A.id,
  branch: '',
  newWorkId: '',
  cwd: REPO_A.root,
  state: 'running',
  terminalId: 'term-a',
  startedAt: 0,
  lastActiveAt: 0,
};

const SESSION_B = {
  ...SESSION_A,
  id: 's-b',
  claudeSessionId: 'cs-b',
  codeRepoId: REPO_B.id,
  cwd: REPO_B.root,
  terminalId: 'term-b',
};

const EMPTY_PRS = { kind: 'ok', branches: {} };

function emptySnapshot(codeRepoId: string, overrides: Record<string, unknown> = {}) {
  return {
    codeRepoId,
    gitRepoId: codeRepoId,
    main: { name: 'main', ref: 'refs/heads/main', tip: 'abc123' },
    branches: [],
    newWork: [],
    plan: { day: {}, order: [], queuedAfter: {}, unpushed: {} },
    colors: {},
    pairs: [],
    history: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '/tmp',
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

test('the ade module renders full-area, hiding the project panel and tab strip; Git restores both', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
    ],
  });

  await expect(page.locator('[data-testid="ade-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tab-strip"]')).toHaveCount(0);

  await modeTab(page, 'git').click();
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="tab-strip"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();
});

test('repo tabs show a needs-input badge only while a session is in "attention", cleared by Stop (which re-fetches that repo\'s snapshot)', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      {
        channel: IPC.terminalAgentSessions,
        response: { sessions: [{ terminalId: 'term-a', cwd: REPO_A.root }] },
      },
      { channel: IPC.adeSessions, response: { sessions: [SESSION_A, SESSION_B] } },
      // Two answers on the same (channel, args) key: the initial mount, then the Stop-triggered
      // refetch — mockRuntime.ts's own cursor consumes them in order.
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id),
      },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
    ],
  });

  await expect(repoTab(page, REPO_A.id)).toBeVisible();
  await expect(repoTab(page, REPO_A.id).locator('[data-activity]')).toHaveCount(0);

  const snapshotCalls = () => control.log().filter((e) => e.channel === IPC.adeRepoSnapshot);
  expect(snapshotCalls()).toHaveLength(1);

  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({
      terminalId: 'term-a',
      event: 'Notification',
      sessionId: 'cs-a',
      cwd: REPO_A.root,
      notificationType: 'permission',
      message: 'needs a permission decision',
    }),
  );
  await expect(repoTab(page, REPO_A.id).locator('[data-activity="input"]')).toBeVisible();
  await expect(repoTab(page, REPO_A.id)).toContainText('1');
  await expect(repoTab(page, REPO_B.id).locator('[data-activity]')).toHaveCount(0);

  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a', event: 'Stop', sessionId: 'cs-a', cwd: REPO_A.root }),
  );
  await expect(repoTab(page, REPO_A.id).locator('[data-activity]')).toHaveCount(0);
  await expect.poll(() => snapshotCalls().length).toBe(2);
});

test('header: fetch label composes from lastFetchAt and autofetchMinutes', async ({ relaunch }) => {
  const lastFetchAt = Date.now() - 4 * 60_000;
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, { lastFetchAt, autofetchMinutes: 0 }),
      },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_B.id },
        response: emptySnapshot(REPO_B.id, { lastFetchAt: null, autofetchMinutes: 5 }),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_B.id }, response: EMPTY_PRS },
    ],
  });

  await expect(page.locator('[data-testid="ade-project-name"]')).toHaveText(REPO_A.name);
  await expect(page.locator('[data-testid="ade-fetch-label"]')).toContainText(
    'fetched 4m ago · autofetch off',
  );

  await repoTab(page, REPO_B.id).click();
  await expect(page.locator('[data-testid="ade-fetch-label"]')).toContainText('never fetched');
  await expect(page.locator('[data-testid="ade-fetch-label"]')).toContainText('autofetch every 5m');
});

test('Refresh shows a pending state, composes the note from refsChanged/newlyMerged, and surfaces a git-level error', async ({
  relaunch,
}) => {
  const lastFetchAt = Date.now() - 4 * 60_000;
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, { lastFetchAt, autofetchMinutes: 0 }),
      },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, { lastFetchAt: Date.now(), autofetchMinutes: 0 }),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      {
        channel: IPC.adeRefresh,
        args: { codeRepoId: REPO_A.id },
        response: { refsChanged: 3, newlyMerged: ['a'] },
        hold: true,
      },
      {
        channel: IPC.adeRefresh,
        args: { codeRepoId: REPO_A.id },
        response: { refsChanged: 0, newlyMerged: [], error: { kind: 'auth', message: 'boom' } },
      },
    ],
  });

  const refreshButton = page.locator('[data-testid="ade-refresh"]');
  const fetchLabel = page.locator('[data-testid="ade-fetch-label"]');
  await expect(fetchLabel).toContainText('fetched 4m ago · autofetch off');

  await refreshButton.click();
  await expect(refreshButton).toBeDisabled();
  await expect(refreshButton).toContainText('Refreshing…');
  await expect(fetchLabel).toContainText('fetching…');

  control.release(IPC.adeRefresh);
  await expect(fetchLabel).toContainText(
    'just now · 3 refs changed · 1 merged · conflicts rechecked',
  );
  await expect.poll(() => control.log().filter((e) => e.channel === IPC.adeRepoPrs).length).toBe(2);

  await refreshButton.click();
  await expect(fetchLabel).toContainText('fetch failed · boom');
});

test("the main line reads the queue's behindRoots, refetching only on this repo's own kira:ade:repo push", async ({
  relaunch,
}) => {
  const branch = {
    id: 'br-1',
    branch: 'feature/x',
    kind: 'mine',
    name: '',
    draftTitle: '',
    startFrom: '',
    exists: true,
    ref: 'refs/heads/feature/x',
    tip: 'abc',
    owner: 'me',
    authorEmail: 'me@example.com',
    isMine: true,
    lastCommitAt: Date.now(),
    base: '',
    ahead: 1,
    behind: 2,
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
  };

  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, { branches: [branch] }),
      },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, { branches: [{ ...branch, behind: 0 }] }),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_B.id },
        response: emptySnapshot(REPO_B.id),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_B.id }, response: EMPTY_PRS },
    ],
  });

  await expect(page.locator('[data-testid="ade-main-note"]')).toContainText('1 stack behind');

  const snapshotCallsA = () =>
    control
      .log()
      .filter(
        (e) =>
          e.channel === IPC.adeRepoSnapshot &&
          (e.args as { codeRepoId?: string } | undefined)?.codeRepoId === REPO_A.id,
      );
  expect(snapshotCallsA()).toHaveLength(1);

  await emitWailsEvent(page, IPC.adeRepo, { codeRepoId: REPO_B.id });
  await page.waitForTimeout(100);
  expect(snapshotCallsA()).toHaveLength(1);

  await emitWailsEvent(page, IPC.adeRepo, { codeRepoId: REPO_A.id });
  await expect(page.locator('[data-testid="ade-main-note"]')).toContainText('all stacks current');
  await expect.poll(() => snapshotCallsA().length).toBe(2);
});

test("a kira:ade:credential prompt maps through the repo's repoId and answers ProvideCredential", async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      { channel: IPC.adeProvideCredential, response: true },
    ],
  });

  await emitWailsEvent(page, IPC.adeCredential, {
    requestId: 'req-1',
    repoId: REPO_A.repoId,
    prompt: 'Passphrase for key',
    masked: true,
  });
  await expect(page.locator('[data-testid="git-credential-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="git-credential-repo"]')).toHaveText(REPO_A.name);
  await expect(page.locator('[data-testid="git-credential-prompt"]')).toHaveText(
    'Passphrase for key',
  );
  await page.locator('[data-testid="git-credential-input"]').fill('secret123');
  await page.locator('[data-testid="git-credential-submit"]').click();

  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeProvideCredential))
    .toEqual([
      { channel: IPC.adeProvideCredential, args: { requestId: 'req-1', secret: 'secret123' } },
    ]);
});

test("switching the active repo tab swaps the header and main line to that repo's own data", async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
      { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
      { channel: IPC.adeSessions, response: { sessions: [] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_A.id },
        response: emptySnapshot(REPO_A.id, {
          main: { name: 'main', ref: 'refs/heads/main', tip: 'a' },
        }),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_A.id }, response: EMPTY_PRS },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO_B.id },
        response: emptySnapshot(REPO_B.id, {
          main: { name: 'master', ref: 'refs/heads/master', tip: 'b' },
        }),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO_B.id }, response: EMPTY_PRS },
    ],
  });

  await expect(page.locator('[data-testid="ade-project-name"]')).toHaveText(REPO_A.name);
  await expect(page.locator('[data-testid="ade-main-name"]')).toHaveText('main');

  await repoTab(page, REPO_B.id).click();
  await expect(page.locator('[data-testid="ade-project-name"]')).toHaveText(REPO_B.name);
  await expect(page.locator('[data-testid="ade-main-name"]')).toHaveText('master');
});
