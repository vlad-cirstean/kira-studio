import type { Page } from '@playwright/test';
import type {
  AdeBranch,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../frontend/src/ade/wire';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P129 Part 7 §3.4: the pinned "All agents" view end to end, `test:ui:space`, mocked control.
// Two repos (alpha/beta), one session per activity kind plus a stopped/archived/cwdMissing row,
// spread across both repos so grouping and the filter counts are meaningful. Helpers mirror
// `ade-panel.spec.ts`'s own (`fullBranch`/`snapshot`/`plan`/`bootControl`/`snapshotControl`/
// `agentEvent`/`settingsSetCalls`), extended for two repos — this directory's own "each spec file
// keeps its own copy" convention (`ade-dialogs.spec.ts`/`ade-timeline.spec.ts` do the same).

const TODAY_ISO = '2026-10-07'; // Wednesday.
const CLOCK_TIME = '2026-10-07T12:00:00';

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

const EMPTY_PRS: AdeRepoPrs = { kind: 'ok', branches: {}, webUrl: '' };

function fullBranch(overrides: Partial<AdeBranch> & Pick<AdeBranch, 'id' | 'branch'>): AdeBranch {
  return {
    kind: 'mine',
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

function plan(day: Record<string, string | null>): AdeRepoSnapshot['plan'] {
  return { day, order: Object.keys(day), queuedAfter: {}, unpushed: {} };
}

function snapshot(codeRepoId: string, overrides: Partial<AdeRepoSnapshot> = {}): AdeRepoSnapshot {
  return {
    codeRepoId,
    gitRepoId: codeRepoId,
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

/** Every scenario boots the same four calls before its own `adeRepoSnapshot`/`adeRepoPrs` per repo —
 *  `windowsEnsure`/`codeWorkspaceListRepos`/`terminalAgentSessions`/`adeSessions`, same as
 *  `ade-panel.spec.ts`'s own per-test boot, extended to the two-repo `codeWorkspaceListRepos`
 *  response every test in this file shares. */
function bootControl(sessions: AdeSession[] = []): ControlSnapshot[] {
  return [
    { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
    { channel: IPC.codeWorkspaceListRepos, response: [REPO_A, REPO_B] },
    { channel: IPC.terminalAgentSessions, response: { sessions: [] } },
    { channel: IPC.adeSessions, response: { sessions } },
  ];
}

function snapshotControl(
  codeRepoId: string,
  snap: AdeRepoSnapshot,
  prs: AdeRepoPrs = EMPTY_PRS,
): ControlSnapshot[] {
  return [
    { channel: IPC.adeRepoSnapshot, args: { codeRepoId }, response: snap },
    { channel: IPC.adeRepoPrs, args: { codeRepoId }, response: prs },
  ];
}

function settingsSetCalls(
  control: { log(): { channel: string; args: unknown }[] },
  needle: string,
) {
  return control
    .log()
    .filter((e) => e.channel === IPC.settingsSet && JSON.stringify(e.args).includes(needle));
}

function repoTab(page: Page, repoId: string) {
  return page.locator(`[data-testid="ade-repo-tab"][data-repo-id="${repoId}"]`);
}

function modeTab(page: Page, mode: 'git' | 'terminal' | 'ade') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

function allAgentsTab(page: Page) {
  return page.locator('[data-testid="ade-all-agents-tab"]');
}

function agentRow(page: Page, sessionId: string) {
  return page.locator(`[data-testid="ade-all-agents-row"][data-session-id="${sessionId}"]`);
}

function agentRowAction(page: Page, sessionId: string) {
  return agentRow(page, sessionId).locator('[data-testid="ade-all-agents-action"]');
}

async function openAllAgents(page: Page): Promise<void> {
  await allAgentsTab(page).click();
}

/** The `Older` filter toggle write-through — `onFilterChange` (`AdeAllAgentsView.vue`) awaits
 *  `SettingsService.Set` before it applies the patch locally (`patchSettings`'s own confirm-first
 *  rule), so every test that switches to Older needs this mocked or the click has no visible
 *  effect at all. */
const SETTINGS_SET_OLDER: ControlSnapshot = {
  channel: IPC.settingsSet,
  response: { ...defaultSettings, ade: { ...defaultSettings.ade, allAgentsFilter: 'older' } },
};

async function selectOlder(page: Page): Promise<void> {
  await page.locator('[data-testid="ade-all-agents-filter"] button', { hasText: 'Older' }).click();
}

/** `activityKind` (`activity.ts`) reads only `agentSessionsStore.activity`, keyed by `terminalId` —
 *  a running session with no hook event yet reads `idle` regardless of which fixture row it is
 *  meant to represent (`sess-idle` needs none). `term-input`/`term-working`/`term-waiting` each get
 *  the one hook sequence `packages/workbench/src/state/agentActivity.ts`'s own reducer maps to
 *  `attention`/`working`/`waiting`. */
async function primeActivity(page: Page): Promise<void> {
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({
      terminalId: 'term-input',
      event: 'Notification',
      notificationType: 'permission',
      message: 'needs a permission decision',
    }),
  );
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({
      terminalId: 'term-working',
      event: 'PreToolUse',
      toolName: 'Bash',
      toolUseId: 'tu-1',
    }),
  );
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({
      terminalId: 'term-waiting',
      event: 'PreToolUse',
      toolName: 'Monitor',
      toolUseId: 'tu-2',
    }),
  );
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-waiting', event: 'Stop' }),
  );
}

// ---------------------------------------------------------------------------------------------
// The full fixture — one running session per activity kind, plus a stopped-on-a-live-branch, a
// stopped-on-an-archived-branch (a `snapshot.history` entry, since an archived branch never stays
// in `snapshot.branches`) and a stopped `cwdMissing` row. Repo alpha carries the input/working/
// live-stopped rows; repo beta carries waiting/idle/archived/cwdMissing — spread across both so a
// group-order or cross-repo count check is meaningful (§3.4 scenarios 1/3/4).
// ---------------------------------------------------------------------------------------------

const A_INPUT = fullBranch({ id: 'a-input', branch: 'feat/input' });
// `name` (§0.6's own `nameOverride`) makes this row's own title diverge from its branch — the one
// live row in this fixture that exercises the "branch worktree" line at all (scenario 5).
const A_WORKING = fullBranch({ id: 'a-working', branch: 'feat/working', name: 'Custom title' });
const A_LIVE = fullBranch({ id: 'a-live', branch: 'feat/live' });

const B_WAITING = fullBranch({ id: 'b-waiting', branch: 'feat/waiting' });
const B_IDLE = fullBranch({ id: 'b-idle', branch: 'feat/idle' });
const B_LIVE2 = fullBranch({ id: 'b-live2', branch: 'feat/live2' });

const B_ARCHIVED_HIST = {
  item: 'b-hist',
  kind: 'mine',
  title: 'Archived work',
  branch: 'feat/archived',
  archivedAt: Date.now(),
};

const SESS_INPUT: AdeSession = {
  id: 'sess-input',
  claudeSessionId: 'cs-input01',
  codeRepoId: REPO_A.id,
  branch: 'feat/input',
  newWorkId: '',
  cwd: '/tmp/wt/a-input',
  state: 'running',
  terminalId: 'term-input',
  startedAt: 0,
  lastActiveAt: 4000,
  cwdMissing: false,
};

const SESS_WORKING: AdeSession = {
  id: 'sess-working',
  claudeSessionId: 'cs-workin1',
  codeRepoId: REPO_A.id,
  branch: 'feat/working',
  newWorkId: '',
  cwd: '/tmp/wt/a-working',
  state: 'running',
  terminalId: 'term-working',
  startedAt: 0,
  lastActiveAt: 3000,
  cwdMissing: false,
};

const SESS_STOPPED_LIVE: AdeSession = {
  id: 'sess-stopped-live',
  claudeSessionId: 'cs-stopliv',
  codeRepoId: REPO_A.id,
  branch: 'feat/live',
  newWorkId: '',
  cwd: '/tmp/wt/a-live',
  state: 'stopped',
  terminalId: '',
  startedAt: 0,
  lastActiveAt: 1000,
  cwdMissing: false,
};

const SESS_WAITING: AdeSession = {
  id: 'sess-waiting',
  claudeSessionId: 'cs-waiting1',
  codeRepoId: REPO_B.id,
  branch: 'feat/waiting',
  newWorkId: '',
  cwd: '/tmp/wt/b-waiting',
  state: 'running',
  terminalId: 'term-waiting',
  startedAt: 0,
  lastActiveAt: 2500,
  cwdMissing: false,
};

const SESS_IDLE: AdeSession = {
  id: 'sess-idle',
  claudeSessionId: 'cs-idle0001',
  codeRepoId: REPO_B.id,
  branch: 'feat/idle',
  newWorkId: '',
  cwd: '/tmp/wt/b-idle',
  state: 'running',
  terminalId: 'term-idle',
  startedAt: 0,
  lastActiveAt: 2000,
  cwdMissing: false,
};

const SESS_ARCHIVED: AdeSession = {
  id: 'sess-archived',
  claudeSessionId: 'cs-archived',
  codeRepoId: REPO_B.id,
  branch: 'feat/archived',
  newWorkId: '',
  cwd: '/tmp/wt/b-archived',
  state: 'stopped',
  terminalId: '',
  startedAt: 0,
  lastActiveAt: 900,
  cwdMissing: false,
};

const SESS_CWD_MISSING: AdeSession = {
  id: 'sess-cwdmissing',
  claudeSessionId: 'cs-cwdmiss1',
  codeRepoId: REPO_B.id,
  branch: 'feat/live2',
  newWorkId: '',
  cwd: '/tmp/wt/b-live2-gone',
  state: 'stopped',
  terminalId: '',
  startedAt: 0,
  lastActiveAt: 800,
  cwdMissing: true,
};

const ALL_SESSIONS = [
  SESS_INPUT,
  SESS_WORKING,
  SESS_STOPPED_LIVE,
  SESS_WAITING,
  SESS_IDLE,
  SESS_ARCHIVED,
  SESS_CWD_MISSING,
];

function fullSnapA(): AdeRepoSnapshot {
  return snapshot(REPO_A.id, {
    branches: [A_INPUT, A_WORKING, A_LIVE],
    plan: plan({ 'a-input': TODAY_ISO, 'a-working': TODAY_ISO, 'a-live': TODAY_ISO }),
  });
}

function fullSnapB(): AdeRepoSnapshot {
  return snapshot(REPO_B.id, {
    branches: [B_WAITING, B_IDLE, B_LIVE2],
    plan: plan({ 'b-waiting': TODAY_ISO, 'b-idle': TODAY_ISO, 'b-live2': TODAY_ISO }),
    history: [B_ARCHIVED_HIST],
  });
}

/** The full two-repo, seven-session fixture every read-only scenario (1/2/3/4/5/9) shares. */
function fullControl(): ControlSnapshot[] {
  return [
    ...bootControl(ALL_SESSIONS),
    ...snapshotControl(REPO_A.id, fullSnapA()),
    ...snapshotControl(REPO_B.id, fullSnapB()),
  ];
}

// ---------------------------------------------------------------------------------------------
// 1. Pinned tab: label, count, hidden when zero
// ---------------------------------------------------------------------------------------------

test('1. pinned tab: first, labelled All agents, shows the cross-repo needs-input count, hidden at zero', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ clockTime: CLOCK_TIME, control: fullControl() });
  await primeActivity(page);

  const tabs = page.locator('[data-testid="ade-repo-tab"], [data-testid="ade-all-agents-tab"]');
  await expect(tabs.first()).toHaveAttribute('data-testid', 'ade-all-agents-tab');
  await expect(allAgentsTab(page)).toContainText('All agents');
  // Only `sess-input` (repo alpha) reads `input` — the count is the sum across both repos, which a
  // single contributor still exercises (the sum itself, not a same-repo-only bug, is what §0.4
  // would regress).
  await expect(allAgentsTab(page)).toContainText('1');

  // With no running session reading `input` anywhere, the count is hidden entirely.
  const { window: page2 } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([SESS_WORKING, SESS_IDLE]),
      ...snapshotControl(REPO_A.id, fullSnapA()),
      ...snapshotControl(REPO_B.id, fullSnapB()),
    ],
  });
  await expect(allAgentsTab(page2).locator('[aria-label="needs input"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 2. Selecting the pinned tab / a repo tab
// ---------------------------------------------------------------------------------------------

test('2. selecting the pinned tab shows the amber-bordered All agents view; a repo tab shows that repo', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ clockTime: CLOCK_TIME, control: fullControl() });

  await repoTab(page, REPO_B.id).click();
  await expect(page.locator('[data-testid="ade-repo-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-all-agents-view"]')).toHaveCount(0);

  await openAllAgents(page);
  await expect(page.locator('[data-testid="ade-all-agents-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-repo-view"]')).toHaveCount(0);
  await expect(allAgentsTab(page)).toHaveCSS('border-top-color', 'rgb(232, 163, 61)');

  await repoTab(page, REPO_A.id).click();
  await expect(page.locator('[data-testid="ade-repo-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-all-agents-view"]')).toHaveCount(0);

  // §0.3: `showAllAgents()` (`state/adeUi.ts`) sets only `state.allAgents` — `activeRepoId` is
  // never read or written by it, so it reads exactly what the last `showRepo` call set (`repo-b`
  // above) for as long as the pinned tab shows. Nothing here re-exposes that id in the DOM while
  // pinned (`AdeRepoTabs`' own `modelValue` renders `ALL_AGENTS_TAB` regardless of it, and
  // `AdeRepoView` itself is unmounted, §0.3/§2.1) for a runtime assertion to read — verified by
  // source instead of a DOM probe, per CLAUDE.md's bar for a one-line, no-branch store action.
});

// ---------------------------------------------------------------------------------------------
// 3. Active by default: counts and aggregated line
// ---------------------------------------------------------------------------------------------

test('3. active by default: Active/Older counts, aggregated line shows input/working/waiting, no idle', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ clockTime: CLOCK_TIME, control: fullControl() });
  await primeActivity(page);
  await openAllAgents(page);

  await expect(page.locator('[data-testid="ade-all-agents-filter"]')).toContainText('Active 4');
  await expect(page.locator('[data-testid="ade-all-agents-filter"]')).toContainText('Older 3');

  const acts = page.locator('[data-testid="ade-all-agents-acts"]');
  await expect(acts).toBeVisible();
  await expect(acts).toContainText('1 needs input');
  await expect(acts).toContainText('1 working');
  await expect(acts).toContainText('1 waiting on monitor');
  await expect(acts).not.toContainText('idle');
});

// ---------------------------------------------------------------------------------------------
// 4. Groups in record order, urgency-sorted rows, needs-input tint
// ---------------------------------------------------------------------------------------------

test('4. groups render in repo record order; rows are urgency-sorted; the needs-input row is tinted', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ clockTime: CLOCK_TIME, control: fullControl() });
  await primeActivity(page);
  await openAllAgents(page);

  const groups = page.locator('[data-testid="ade-all-agents-group"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-repo-id', REPO_A.id);
  await expect(groups.nth(0)).toContainText('alpha');
  await expect(groups.nth(1)).toHaveAttribute('data-repo-id', REPO_B.id);
  await expect(groups.nth(1)).toContainText('beta');

  // Active filter: alpha shows input then working (actRank 0 then 1); beta shows waiting then idle
  // (actRank 2 then 3).
  const alphaRows = groups.nth(0).locator('[data-testid="ade-all-agents-row"]');
  await expect(alphaRows).toHaveCount(2);
  await expect(alphaRows.nth(0)).toHaveAttribute('data-session-id', 'sess-input');
  await expect(alphaRows.nth(1)).toHaveAttribute('data-session-id', 'sess-working');

  const betaRows = groups.nth(1).locator('[data-testid="ade-all-agents-row"]');
  await expect(betaRows).toHaveCount(2);
  await expect(betaRows.nth(0)).toHaveAttribute('data-session-id', 'sess-waiting');
  await expect(betaRows.nth(1)).toHaveAttribute('data-session-id', 'sess-idle');

  await expect(agentRow(page, 'sess-input')).toHaveCSS(
    'background-color',
    'rgba(232, 163, 61, 0.07)',
  );
  await expect(agentRow(page, 'sess-working')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

// ---------------------------------------------------------------------------------------------
// 5. Row text
// ---------------------------------------------------------------------------------------------

test('5. row text: coloured label, claude <8 chars>, title, and branch worktree (blank when title equals branch)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ clockTime: CLOCK_TIME, control: fullControl() });
  await primeActivity(page);
  await openAllAgents(page);

  const inputLabel = agentRow(page, 'sess-input').locator('text=needs input');
  await expect(inputLabel).toHaveCSS('color', 'rgb(240, 184, 92)');
  await expect(agentRow(page, 'sess-input')).toContainText('claude cs-input');
  await expect(agentRow(page, 'sess-input')).toContainText('feat/input'); // the title itself
  const inputWorktreeLine = agentRow(page, 'sess-input')
    .locator('div.flex.min-w-0.flex-col > span')
    .nth(1);
  await expect(inputWorktreeLine).toHaveText('/tmp/wt/a-input'); // branchText blank: title === branch

  await expect(agentRow(page, 'sess-working')).toContainText('claude cs-worki');
  await expect(
    agentRow(page, 'sess-working').locator('[data-testid="ade-all-agents-title"]'),
  ).toHaveText('Custom title');
  const workingWorktreeLine = agentRow(page, 'sess-working')
    .locator('div.flex.min-w-0.flex-col > span')
    .nth(1);
  await expect(workingWorktreeLine).toHaveText('feat/working /tmp/wt/a-working');
});

// ---------------------------------------------------------------------------------------------
// 6. Older filter: aggregated line hidden, settings patch, reload restores it
// ---------------------------------------------------------------------------------------------

test('6. older: aggregated line hidden; patches ade.allAgentsFilter; a reload restores Older', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...fullControl(), SETTINGS_SET_OLDER],
  });
  await openAllAgents(page);

  await selectOlder(page);
  await expect(page.locator('[data-testid="ade-all-agents-acts"]')).toHaveCount(0);
  await expect
    .poll(() => settingsSetCalls(control, '"allAgentsFilter":"older"').length > 0)
    .toBe(true);

  const { window: page2 } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      {
        channel: IPC.settingsGetAll,
        response: { ...defaultSettings, ade: { ...defaultSettings.ade, allAgentsFilter: 'older' } },
      },
      ...fullControl(),
    ],
  });
  await openAllAgents(page2);
  await expect(
    page2.locator('[data-testid="ade-all-agents-filter"] button', { hasText: 'Older' }),
  ).toHaveAttribute('data-state', 'on');
});

// ---------------------------------------------------------------------------------------------
// 7. Archived row: label, Start forces a new worktree
// ---------------------------------------------------------------------------------------------

test('7. archived row reads stopped · archived; Start offers only new worktree', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...fullControl(), SETTINGS_SET_OLDER],
  });
  await openAllAgents(page);
  await selectOlder(page);

  await expect(agentRow(page, 'sess-archived')).toContainText('stopped · archived');
  await agentRowAction(page, 'sess-archived').click();

  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toContainText('Start Claude Code');
  const chips = dialog.locator('[data-testid="ade-dialog-worktree"] button');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText('new worktree');
  await expect(dialog.locator('[data-testid="ade-dialog-message"]')).toHaveValue(
    /create a new worktree for it/,
  );
});

// ---------------------------------------------------------------------------------------------
// 8. Live stopped row: both chips, Send delivers the resume
// ---------------------------------------------------------------------------------------------

test('8. live stopped row: both worktree chips; picking new switches the line; Send resumes the record', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...fullControl(),
      SETTINGS_SET_OLDER,
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-resumed',
          sessionId: 'sess-stopped-live',
          command: 'claude',
          cwd: '/tmp/wt/a-live',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
    ],
  });
  await openAllAgents(page);
  await selectOlder(page);

  await expect(agentRow(page, 'sess-stopped-live')).toContainText('stopped');
  await expect(agentRow(page, 'sess-stopped-live')).not.toContainText('archived');
  await agentRowAction(page, 'sess-stopped-live').click();

  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toContainText('Start Claude Code');
  const worktree = dialog.locator('[data-testid="ade-dialog-worktree"]');
  const chips = worktree.locator('button');
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: 'same worktree' })).toHaveAttribute('data-state', 'on');
  await expect(dialog.locator('[data-testid="ade-dialog-message"]')).toHaveValue(
    /\/tmp\/wt\/a-live/,
  );

  await chips.filter({ hasText: 'new worktree' }).click();
  await expect(dialog.locator('[data-testid="ade-dialog-message"]')).toHaveValue(
    /create a new worktree for it/,
  );

  await dialog.locator('[data-testid="ade-dialog-send"]').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => control.log().some((e) => e.channel === IPC.adePrepareLaunch)).toBe(true);
  const sendCall = control.log().find((e) => e.channel === IPC.adePrepareLaunch) as {
    args?: { resume?: string; branch?: string; newWorkId?: string; cwd?: string };
  };
  expect(sendCall.args?.resume).toBe('sess-stopped-live');
  expect(sendCall.args?.branch).toBe('feat/live');
  expect(sendCall.args?.newWorkId).toBe('');
  expect(sendCall.args?.cwd).toBe('/tmp/wt/a-live');
  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalOpen)).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 9. cwdMissing row: only new worktree
// ---------------------------------------------------------------------------------------------

test('9. cwdMissing row: Start offers only new worktree, same as an archived row', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...fullControl(), SETTINGS_SET_OLDER],
  });
  await openAllAgents(page);
  await selectOlder(page);

  await expect(agentRow(page, 'sess-cwdmissing')).not.toContainText('archived');
  await agentRowAction(page, 'sess-cwdmissing').click();

  const dialog = page.locator('[data-testid="ade-dialog"]');
  const chips = dialog.locator('[data-testid="ade-dialog-worktree"] button');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText('new worktree');
});

// ---------------------------------------------------------------------------------------------
// 10. Open (local): a session this page owns
// ---------------------------------------------------------------------------------------------

test('10. open, local terminal: repo tab active, item selected, Agents tab on that session', async ({
  relaunch,
}) => {
  const a = fullBranch({ id: 'a', branch: 'feat/a' });
  const snapA = snapshot(REPO_A.id, { branches: [a], plan: plan({ a: TODAY_ISO }) });
  const snapB = snapshot(REPO_B.id);

  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([]),
      ...snapshotControl(REPO_A.id, snapA),
      ...snapshotControl(REPO_B.id, snapB),
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-local',
          sessionId: 'sess-local',
          command: 'claude',
          cwd: '/tmp/wt/a',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      {
        channel: IPC.adeSessions,
        response: {
          sessions: [
            {
              id: 'sess-local',
              claudeSessionId: 'cs-local01',
              codeRepoId: REPO_A.id,
              branch: 'feat/a',
              newWorkId: '',
              cwd: '/tmp/wt/a',
              state: 'running',
              terminalId: 'term-local',
              startedAt: 0,
              lastActiveAt: Date.now(),
              cwdMissing: false,
            } satisfies AdeSession,
          ],
        },
      },
    ],
  });

  // ade-panel.spec.ts's own local-terminal setup (its "12. Agents tab" test): launch a session from
  // this window's own repo tab first, which is what makes `terminalsStore.terminalSession` truthy
  // for it — a session `AdeAllAgentsView`'s own `onOpen` never has to fall back to FocusSession for.
  await repoTab(page, REPO_A.id).click();
  await page.locator('[data-testid="ade-stack-row"][data-ade-id="a"]').click();
  await page.locator('[data-testid="ade-panel-tab-agents"]').click();
  await page.locator('[data-testid="ade-agents-new"]').click();
  await page.locator('[data-testid="ade-dialog-send"]').click();
  await expect(page.locator('[data-testid="ade-dialog"]')).toHaveCount(0);
  await expect.poll(() => control.log().some((e) => e.channel === IPC.terminalOpen)).toBe(true);

  await repoTab(page, REPO_B.id).click(); // something else active first — the Open is a real change.
  await openAllAgents(page);
  await agentRowAction(page, 'sess-local').click();

  await expect(repoTab(page, REPO_A.id)).toHaveAttribute('data-state', 'active');
  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('feat/a');
  await expect(page.locator('[data-testid="ade-panel-tab-agents"]')).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(page.locator('[data-testid="ade-agent-tab-sess-local"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

// ---------------------------------------------------------------------------------------------
// 11. Open (cross-window): FocusSession, then the receiving window's own kira:ade:open-session
// ---------------------------------------------------------------------------------------------

test('11. open, foreign terminal: FocusSession is called; kira:ade:open-session switches this window to it', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [...fullControl(), { channel: IPC.adeFocusSession, response: true }],
  });
  await openAllAgents(page);

  // `sess-waiting` has a `terminalId` this window never opened — the fallback path.
  await agentRowAction(page, 'sess-waiting').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.adeFocusSession)).toBe(true);
  const focusCall = control.log().find((e) => e.channel === IPC.adeFocusSession) as {
    args?: { sessionId?: string; itemId?: string };
  };
  expect(focusCall.args?.sessionId).toBe('sess-waiting');
  expect(focusCall.args?.itemId).toBe('b-waiting');

  // This window is the one FocusSession just brought forward — git mode, then the emit.
  await modeTab(page, 'git').click();
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);

  await emitWailsEvent(page, IPC.adeOpenSession, {
    codeRepoId: REPO_B.id,
    itemId: 'b-waiting',
    sessionId: 'sess-waiting',
  });

  await expect(modeTab(page, 'ade')).toHaveClass(/is-active/);
  await expect(repoTab(page, REPO_B.id)).toHaveAttribute('data-state', 'active');
  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('feat/waiting');
  await expect(page.locator('[data-testid="ade-panel-tab-agents"]')).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(page.locator('[data-testid="ade-agent-tab-sess-waiting"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

// ---------------------------------------------------------------------------------------------
// 12. No sessions
// ---------------------------------------------------------------------------------------------

test('12. no sessions: Nothing here.', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    clockTime: CLOCK_TIME,
    control: [
      ...bootControl([]),
      ...snapshotControl(REPO_A.id, snapshot(REPO_A.id)),
      ...snapshotControl(REPO_B.id, snapshot(REPO_B.id)),
    ],
  });
  await openAllAgents(page);

  await expect(page.locator('[data-testid="ade-all-agents-group"]')).toHaveCount(0);
  await expect(page.getByText('Nothing here.')).toBeVisible();
});
