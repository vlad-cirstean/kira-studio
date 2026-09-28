import { composeDialog, type DialogCtx, rebaseAllSpec } from '../../frontend/src/ade/dialogCompose';
import { localIsoOfMs } from '../../frontend/src/ade/localDay';
import { useQueue } from '../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../frontend/src/ade/wire';
import type { Settings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P129 Part 4 §3.4: the Claude Code dialog end to end, under mocked control, `test:ui:space`.
// Fixture: one repo, two behind mine roots (A with a restacked child A2, B). Sessions: A2 running,
// activity driven by emitted kira:agent:event; B running idle. One continuous scenario walking the
// plan's own 9 numbered steps, since each depends on the dialog state the step before it left.

const REPO = {
  id: 'repo-a',
  name: 'alpha',
  root: '/tmp/alpha',
  repoId: '/tmp/alpha',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

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

const BRANCH_A = fullBranch({ id: 'a', branch: 'feat/a', behind: 2, worktree: '/tmp/wt/a' });
const BRANCH_A2 = fullBranch({
  id: 'a2',
  branch: 'feat/a2',
  base: 'a',
  ahead: 1,
  worktree: '/tmp/wt/a2',
});
const BRANCH_B = fullBranch({ id: 'b', branch: 'feat/b', behind: 3, worktree: '/tmp/wt/b' });

const SESSION_A2: AdeSession = {
  id: 'sess-a2',
  claudeSessionId: 'cs-a2',
  codeRepoId: REPO.id,
  branch: 'feat/a2',
  newWorkId: '',
  cwd: '/tmp/wt/a2',
  state: 'running',
  terminalId: 'term-a2',
  startedAt: 0,
  lastActiveAt: 0,
};

const SESSION_B: AdeSession = {
  id: 'sess-b',
  claudeSessionId: 'cs-b',
  codeRepoId: REPO.id,
  branch: 'feat/b',
  newWorkId: '',
  cwd: '/tmp/wt/b',
  state: 'running',
  terminalId: 'term-b',
  startedAt: 0,
  lastActiveAt: 0,
};

const EMPTY_PRS: AdeRepoPrs = { kind: 'ok', branches: {}, webUrl: '' };

function snapshotFixture(): AdeRepoSnapshot {
  return {
    codeRepoId: REPO.id,
    gitRepoId: REPO.id,
    main: { name: 'main', ref: 'origin/main', tip: 'abc123' },
    remote: 'origin',
    branches: [BRANCH_A, BRANCH_A2, BRANCH_B],
    newWork: [],
    plan: { day: {}, order: [], queuedAfter: {}, unpushed: {} },
    colors: {},
    pairs: [],
    history: [],
    dependencies: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '/tmp/wt',
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

/** The exact template `AdeClaudeDialog.vue` renders, computed the same way the component does
 *  (`composeDialog` over `rebaseAllSpec`) — a Node-side cross-check against the same fixture data
 *  the mocked boot serves, so this assertion never drifts from a hand-copied string. */
function expectedRebaseAllMessage(): string {
  const snap = snapshotFixture();
  const view = useQueue({
    snapshot: snap,
    sessions: [SESSION_A2, SESSION_B],
    activity: new Map(),
    prs: EMPTY_PRS,
    settings: DEFAULT_SETTINGS,
    today: '2026-09-27',
    localDayOf: localIsoOfMs,
  });
  const ctx: DialogCtx = {
    view,
    snapshot: snap,
    sessions: [SESSION_A2, SESSION_B],
    today: '2026-09-27',
    repoRoot: REPO.root,
  };
  const spec = rebaseAllSpec(ctx);
  return composeDialog(
    ctx,
    spec,
    { msg: null, push: false, override: false, branchName: '' },
    new Map(),
  ).message;
}

test('the Claude Code dialog: busy/override, push toggle, edit/reset, and Rebase all send end to end', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.terminalAgentSessions,
        response: {
          sessions: [
            { terminalId: 'term-a2', cwd: '/tmp/wt/a2' },
            { terminalId: 'term-b', cwd: '/tmp/wt/b' },
          ],
        },
      },
      { channel: IPC.adeSessions, response: { sessions: [SESSION_A2, SESSION_B] } },
      {
        channel: IPC.adeRepoSnapshot,
        args: { codeRepoId: REPO.id },
        response: snapshotFixture(),
      },
      { channel: IPC.adeRepoPrs, args: { codeRepoId: REPO.id }, response: EMPTY_PRS },
      {
        channel: IPC.adePrepareLaunch,
        response: {
          terminalId: 'term-a-new',
          sessionId: 'sess-a-new',
          command: 'claude',
          cwd: '/tmp/wt/a2',
        },
      },
      { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
      { channel: IPC.adeSend, response: null },
    ],
  });

  // 9. main line shows `main`, not a refname (§0.5 fixture shape).
  await expect(page.locator('[data-testid="ade-main-name"]')).toHaveText('main');

  // 1. Rebase all visible; the note count matches (2 behind roots: a, b). Click opens the dialog.
  const rebaseAllButton = page.locator('[data-testid="ade-rebase-all"]');
  await expect(page.locator('[data-testid="ade-main-note"]')).toContainText('2 stacks behind');
  await expect(rebaseAllButton).toBeVisible();
  await rebaseAllButton.click();

  const dialog = page.locator('[data-testid="ade-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Rebase all onto main');
  const message = dialog.locator('[data-testid="ade-dialog-message"]');
  await expect(message).toHaveValue(expectedRebaseAllMessage());

  const sendButton = dialog.locator('[data-testid="ade-dialog-send"]');
  const busyAlert = dialog.locator('[data-testid="ade-dialog-busy"]');

  // 2. A2's UserPromptSubmit gives the busy alert with row `feat/a2 · claude cs-a2 · working`. Send
  //    disabled.
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a2', event: 'UserPromptSubmit', sessionId: 'cs-a2' }),
  );
  await expect(busyAlert).toBeVisible();
  await expect(busyAlert).toContainText('feat/a2 · claude cs-a2 · working');
  await expect(sendButton).toBeDisabled();

  // 3. Stop -> alert gone, Send enabled (live). UserPromptSubmit -> blocked again.
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a2', event: 'Stop', sessionId: 'cs-a2' }),
  );
  await expect(busyAlert).toHaveCount(0);
  await expect(sendButton).toBeEnabled();

  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a2', event: 'UserPromptSubmit', sessionId: 'cs-a2' }),
  );
  await expect(busyAlert).toBeVisible();

  // 4. Override... -> "Override on: ..." text, "Undo override", Send reads "Send anyway". Undo
  //    reverts.
  const overrideButton = dialog.locator('[data-testid="ade-dialog-override"]');
  await overrideButton.click();
  await expect(busyAlert).toContainText('Override on:');
  await expect(overrideButton).toHaveText('Undo override');
  await expect(sendButton).toContainText('Send anyway');
  await expect(sendButton).toBeEnabled();

  await overrideButton.click();
  await expect(overrideButton).toHaveText('Override…');
  await expect(sendButton).not.toContainText('Send anyway');
  await expect(sendButton).toBeDisabled();

  // 5. Close and reopen resets the override — still busy (no Stop emitted since step 3's second
  //    UserPromptSubmit), so the busy alert is back with the override off.
  await dialog.locator('[data-testid="ade-dialog-cancel"]').click();
  await expect(dialog).toHaveCount(0);
  await rebaseAllButton.click();
  await expect(dialog).toBeVisible();
  await expect(busyAlert).toBeVisible();
  await expect(overrideButton).toHaveText('Override…');

  // Clear the busy state for the rest of the scenario (send, below, needs it enabled).
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a2', event: 'Stop', sessionId: 'cs-a2' }),
  );
  await expect(busyAlert).toHaveCount(0);

  // 6. Switch on: message line becomes the force-push line.
  await dialog.locator('[data-testid="ade-dialog-push"]').click();
  await expect(message).toHaveValue(
    /Then push each rebased branch with: git push --force-with-lease/,
  );

  // 7. Edit the message: Reset appears. Reset restores the (push-on) template.
  const pushedTemplate = await message.inputValue();
  await message.fill(`${pushedTemplate}\n\nHeads up, one more thing.`);
  const resetButton = dialog.locator('[data-testid="ade-dialog-reset"]');
  await expect(resetButton).toBeVisible();
  await resetButton.click();
  await expect(message).toHaveValue(pushedTemplate);
  await expect(resetButton).toHaveCount(0);

  // Push back off — step 8's own call assertions don't depend on the message text, but this keeps
  // the scenario's own state legible.
  await dialog.locator('[data-testid="ade-dialog-push"]').click();

  // 8. Send with A's target `new session` and B's running target: PrepareLaunch then
  //    `kira:terminal:open` (launchKind claude-code) for A, `Send` for B. Dialog closes. Rebase all
  //    hidden while rebasing; emitted Stops bring it back.
  await sendButton.click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adePrepareLaunch &&
            (e.args as { codeRepoId?: string; branch?: string } | undefined)?.codeRepoId ===
              REPO.id &&
            (e.args as { branch?: string } | undefined)?.branch === 'a',
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { launchKind?: string } | undefined)?.launchKind === 'claude-code',
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.adeSend &&
            (e.args as { sessionId?: string } | undefined)?.sessionId === 'sess-b',
        ),
    )
    .toBe(true);

  await expect(rebaseAllButton).toHaveCount(0);

  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-a-new', event: 'Stop', sessionId: 'sess-a-new' }),
  );
  // B's watch is armed with requireSubmit: true (Send to an already-running session) — a Stop
  // belongs to the already-running turn until this prompt's own UserPromptSubmit fires first.
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-b', event: 'UserPromptSubmit', sessionId: 'cs-b' }),
  );
  await emitWailsEvent(
    page,
    IPC.agentEvent,
    agentEvent({ terminalId: 'term-b', event: 'Stop', sessionId: 'cs-b' }),
  );
  await expect(rebaseAllButton).toBeVisible();
});
