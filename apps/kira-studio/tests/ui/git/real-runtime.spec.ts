import { expect, test } from '../fixtures';

// D5's first test tier: the real Wails runtime bundle, real generated bindings, real bound-call
// FQN dispatch, and — new for this stream — the real "git" frame codec (transport.ts's
// MessageChannelLike over Stream('git'), driven against tests/ui/support/mockGitStream.ts's
// scripted responses rather than a real Go backend). This is what proves the *host* works, as
// distinct from harness.spec.ts's proof that the *package boundary* is real.

function modeTab(page: import('@playwright/test').Page, mode: 'studio' | 'http' | 'git') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

const GIT_OK_INIT = {
  method: 'app.init',
  response: {
    host: 'kira-studio',
    contractVersion: 3,
    settings: {
      'git.path': '',
      'git.graph.pageSize': 5000,
      'git.graph.scope': 'all',
      'git.log.level': 'info',
    },
    git: { kind: 'ok', path: '/opt/homebrew/bin/git', version: '2.42.0' },
  },
};

test('switching to Git mode shows the start screen, and opening a tab mounts git-ui over the real stream', async ({
  relaunch,
}) => {
  const { window: page, gitStream } = await relaunch({
    gitStream: {
      requests: [
        GIT_OK_INIT,
        { method: 'repo.list', response: { candidates: [], activeRepoId: null } },
      ],
    },
  });

  await modeTab(page, 'git').click();
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="git-start"]')).toBeVisible();

  await page.click('[data-testid="open-repository-start"]');
  await expect(page.locator('[data-testid="git-graph-view"]')).toBeVisible();
  // git-ui's own real component tree, mounted through the real stream — the same
  // no-repository-panel harness.spec.ts asserts against a hand-written Transport, here reached
  // through transport.ts's real MessageChannelLike and the real Wails runtime bundle instead.
  await expect(page.locator('[data-testid="no-repository-panel"]')).toBeVisible();

  const requests = await gitStream.requests();
  expect(requests.some((r) => r.method === 'app.init')).toBe(true);
});

test('a git status other than ok renders the blocking panel through the real stream', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    gitStream: {
      requests: [
        {
          method: 'app.init',
          response: {
            host: 'kira-studio',
            contractVersion: 3,
            settings: {
              'git.path': '',
              'git.graph.pageSize': 5000,
              'git.graph.scope': 'all',
              'git.log.level': 'info',
            },
            git: { kind: 'notFound', probed: ['/usr/bin/git'] },
          },
        },
      ],
    },
  });

  await modeTab(page, 'git').click();
  await page.click('[data-testid="open-repository-start"]');
  const panel = page.locator('[data-testid="git-blocked-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Git was not found');
});

test("an event frame over the real stream reaches the mounted app (transport.ts's on() path)", async ({
  relaunch,
}) => {
  // Proves the client-side event channel end to end over the real runtime — the sibling proof to
  // gitstream_internal_test.go's own Go-side Emit test (§7's "an event crossing" exit criterion).
  // repo.changed with no active repo open is a harmless no-op for RepoState (it only reacts when
  // the event's repoId matches an active repo) — this only needs the frame to arrive without
  // throwing or breaking the mount, which a thrown decode error would surface as a console error
  // Playwright would otherwise let pass silently.
  const consoleErrors: string[] = [];
  const { window: page } = await relaunch({
    gitStream: {
      requests: [
        GIT_OK_INIT,
        { method: 'repo.list', response: { candidates: [], activeRepoId: null } },
      ],
      events: [
        {
          method: 'repo.changed',
          payload: { repoId: 'nonexistent', kind: 'refsChanged' },
          delayMs: 50,
        },
      ],
    },
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await modeTab(page, 'git').click();
  await page.click('[data-testid="open-repository-start"]');
  await expect(page.locator('[data-testid="no-repository-panel"]')).toBeVisible();
  await page.waitForTimeout(200); // past the scripted event's delayMs.

  expect(consoleErrors).toEqual([]);
});
