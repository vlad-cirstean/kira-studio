import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { installGitStreamMock } from './support/gitStreamMock';
import { IPC } from './support/ipcChannels';

// P67b §2/§3/§9: the two reported bugs, as regressions. Both need the real @kira/git-ui mount
// (RepoGraphView.vue/RepoReviewView.vue) actually reaching a live bridge — installGitStreamMock's
// own doc comment explains why its socket double starts CONNECTING and only opens on a later
// macrotask, and why send() now throws on a CONNECTING socket: without both properties, either bug
// would pass here even with the pre-fix code (a vacuous regression test, the plan's own warning).

const REPO = {
  id: 'repo-lifecycle-1',
  name: 'lifecycle-repo',
  root: '/tmp/lifecycle-repo',
  repoId: '/tmp/lifecycle-repo',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FILE_LISTING = { paths: ['a.ts'], status: {}, truncated: false };

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
  {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path: 'a.ts' },
    response: {
      kind: 'found',
      text: 'export const a = 1;\n',
      bytes: 21,
      limitBytes: 8 * 1024 * 1024,
      language: 'typescript',
    },
  },
];

function repoRow(page: import('@playwright/test').Page) {
  return page.locator(`[data-testid="repo-row"][data-repo-id="${REPO.id}"]`);
}

function treeRow(page: import('@playwright/test').Page, path: string) {
  return page.locator(`[data-testid="repo-tree-row"][data-path="${path}"]`);
}

// P72 §7: the pinned graph tab now renders in `tab-strip-pinned`, a sibling of `tab-strip-row`
// rather than a descendant of it — `tab-strip-wrapper` is the common ancestor of both.
function tab(page: import('@playwright/test').Page, kind?: string) {
  return kind
    ? page.locator(`[data-testid="tab-strip-wrapper"] [data-testid="tab"][data-tab-kind="${kind}"]`)
    : page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]');
}

async function openGitModule(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="git"]').click();
  await expect(page.locator('[data-testid="mode-tab"][data-mode="git"]')).toHaveClass(/is-active/);
}

// `repo-graph-host`/`repo-review-host` are this app's OWN mount-point <div>s (RepoGraphView.vue/
// RepoReviewView.vue) — always present the instant the tab/segment renders, regardless of whether
// the git-ui bundle mounted inside them ever finishes bootstrapping. `connection-state` is
// @kira/git-ui's own BridgeClient.connectionState, exposed as text (App.vue/ReviewView.vue both
// carry it) — 'connecting' forever (never 'connected', never 'error') is exactly what a hung
// request over a silently-dropped-send dead socket looks like, so this is the assertion that
// actually proves the bootstrap succeeded rather than merely that a container div exists. Scoped
// to its own host: Review stays mounted via v-show once activated (§8.4), so both a graph tab and
// an activated Review segment can carry their own `connection-state` span at the same time.
function connectionStateIn(page: import('@playwright/test').Page, hostTestId: string) {
  return page.locator(`[data-testid="${hostTestId}"] [data-testid="connection-state"]`);
}

// Bug 2 (§3): a cold mount reached the graph only after a manual Retry, because the git stream
// channel sent app.init before the socket's own open ack — deterministic on a fresh repo open, not
// flaky (§3's own root-cause section). The fix gates post() on the open ack instead of sending
// synchronously (streamChannel.ts). This is the FIRST-EVER open of a repo workspace on a fresh
// page — the one case bug 2 reproduced in.
test('bug 2 regression: a cold repo open reaches the graph with no boot-retry click', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  // Must land before the repo workspace ever opens — gitTransportFor is lazy, first triggered by
  // RepoGraphView.vue's own mount, which the repo-row click below causes.
  await installGitStreamMock(page, REPO.repoId);

  await openGitModule(page);
  await repoRow(page).click();

  await expect(page.locator('[data-testid="repo-graph-host"]')).toBeVisible();
  await expect(connectionStateIn(page, 'repo-graph-host')).toHaveText('connected');
  await expect(page.locator('[data-testid="boot-error"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="boot-retry"]')).toHaveCount(0);
});

// Bug 1 (§2): opening a file (or anything that unmounts RepoGraphView.vue, e.g. a tab switch —
// P72 §3 made a plain tab switch a KeepAlive deactivation instead, but closing the tab or an LRU
// eviction past KEEP_ALIVE_MAX still unmounts it the same way) tore down the ONE shared Transport
// every mount in the repo workspace shared — gitTransportFor's own cache handed back the same
// now-dead object, so returning to the pinned graph tab (or switching the panel to Review, sharing
// that same transport) hit a boot error instead of remounting live. The fix (repo/git/transport.ts's
// per-mount lease, §2.1) makes each mount's own dispose() release only its own subscriptions, never
// the shared socket.
test('bug 1 regression: opening a file and returning to the graph tab keeps the graph (and Review) alive', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await installGitStreamMock(page, REPO.repoId);

  await openGitModule(page);
  await repoRow(page).click();
  await expect(page.locator('[data-testid="repo-graph-host"]')).toBeVisible();
  await expect(connectionStateIn(page, 'repo-graph-host')).toHaveText('connected');

  // Open a file from the tree — P72 §3: RepoGraphView.vue is now KeepAlive-included
  // (MainView.vue), so this deactivates it rather than unmounting it; a deactivated component's
  // DOM moves to Vue's internal storage container, outside the live document tree, so it's still
  // unreachable here exactly as a genuine unmount would be (verified empirically, not assumed:
  // a standalone Chromium + WebKit repro confirmed `document.querySelector`/a Playwright locator
  // both return zero matches for a deactivated component's host element).
  await treeRow(page, 'a.ts').click();
  await expect(page.locator('[data-testid="repo-file-editor"]')).toBeVisible();
  await expect(page.locator('[data-testid="repo-graph-host"]')).toHaveCount(0);

  // Return to the pinned graph tab — the bug: a dead, shared transport meant this mount's own
  // bootstrap() hung forever (a request sent over a closed socket never resolves), so
  // connection-state never reaches 'connected' and no boot error fires either — the container div
  // alone (repo-graph-host) is visible either way, which is why the real assertion is the
  // connection state reaching 'connected', not merely the host existing.
  await tab(page, 'repo-graph').click();
  await expect(page.locator('[data-testid="repo-graph-host"]')).toBeVisible();
  await expect(connectionStateIn(page, 'repo-graph-host')).toHaveText('connected');
  await expect(page.locator('[data-testid="boot-error"]')).toHaveCount(0);

  // The Review segment shares the same underlying client (a separate lease, §2.1) — it must mount
  // live too, not inherit whatever the graph tab's own mount/unmount did to the transport.
  await page.locator('[data-testid="repo-view-review"]').click();
  await expect(page.locator('[data-testid="repo-review-host"]')).toBeVisible();
  await expect(connectionStateIn(page, 'repo-review-host')).toHaveText('connected');
  await expect(page.locator('[data-testid="boot-error"]')).toHaveCount(0);
});
