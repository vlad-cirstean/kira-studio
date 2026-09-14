import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// C5 §15: the cheapest proof of this phase's one real claim a unit test can't reach — a repo
// workspace's own isolated, pinned-plus-preview tab strip, and that studio's own strip never shows
// a repo tab. "Import a fixture repository" here means seeding codeWorkspaceListRepos with one
// already-imported repo (the same shortcut mode-switch.spec.ts's own createAndConnect takes for a
// connection) — the import dialog itself is a thin pass-through CLAUDE.md's own bar gives nothing.

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FILE_LISTING = { paths: ['a.ts', 'b.ts'], status: {}, truncated: false };

// C6 §10/§16: 'c.ts' carries a status glyph, so its row gets an "Open changes" entry — the other
// two rows above stay unchanged, gating the entry off for anything the tree doesn't color.
const FILE_LISTING_WITH_STATUS = {
  paths: ['a.ts', 'b.ts', 'c.ts'],
  status: { 'c.ts': 'M' },
  truncated: false,
};

const DIFF_SNAP: ControlSnapshot = {
  channel: IPC.codeWorkspaceReadDiff,
  args: { id: REPO.id, path: 'c.ts' },
  response: {
    path: 'c.ts',
    language: 'typescript',
    head: { kind: 'found', text: 'export const c = 1;\n', bytes: 20, limitBytes: 8 * 1024 * 1024 },
    worktree: {
      kind: 'found',
      text: 'export const c = 2;\n',
      bytes: 20,
      limitBytes: 8 * 1024 * 1024,
    },
  },
};

function readFileSnap(path: string, text: string): ControlSnapshot {
  return {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path },
    response: {
      kind: 'found',
      text,
      bytes: text.length,
      limitBytes: 8 * 1024 * 1024,
      language: 'typescript',
    },
  };
}

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
  readFileSnap('a.ts', 'export const a = 1;\n'),
  readFileSnap('b.ts', 'export const b = 2;\n'),
];

function repoRow(page: import('@playwright/test').Page) {
  return page.locator(`[data-testid="repo-row"][data-repo-id="${REPO.id}"]`);
}

function treeRow(page: import('@playwright/test').Page, path: string) {
  return page.locator(`[data-testid="repo-tree-row"][data-path="${path}"]`);
}

function tab(page: import('@playwright/test').Page, kind?: string) {
  return kind
    ? page.locator(`[data-testid="tab-strip-row"] [data-testid="tab"][data-tab-kind="${kind}"]`)
    : page.locator('[data-testid="tab-strip-row"] [data-testid="tab"]');
}

test('a repo workspace: pinned graph tab, preview-slot reuse, promotion, and studio isolation', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });

  // Import a fixture repository (seeded above) — visible in the panel's Repositories section.
  await expect(repoRow(page)).toBeVisible();

  // Opening it (double-click, the tree's own select/open split) switches to its own workspace.
  await repoRow(page).dblclick();
  await expect(
    page.locator('[data-testid="workspace-repo-tab"][data-repo-id="repo-1"]'),
  ).toHaveClass(/is-active/);

  // The pinned graph tab exists, alone, and has no close button.
  await expect(tab(page)).toHaveCount(1);
  const graphTab = tab(page, 'repo-graph');
  await expect(graphTab).toHaveCount(1);
  await expect(graphTab.locator('[data-testid="tab-close"]')).toHaveCount(0);

  // Single click opens a preview tab (§5.2 rule 1/4) — the strip now shows two tabs: pinned +
  // one preview, italic.
  await expect(treeRow(page, 'a.ts')).toBeVisible();
  await treeRow(page, 'a.ts').click();
  await expect(tab(page)).toHaveCount(2);
  const previewTab = tab(page, 'repo-file');
  await expect(previewTab).toHaveCount(1);
  await expect(previewTab).toHaveAttribute('data-preview', 'true');

  // A second single click on a *different* file replaces the preview slot's own tab — still two
  // tabs, never three (§5.2 rule 3).
  await treeRow(page, 'b.ts').click();
  await expect(tab(page)).toHaveCount(2);
  await expect(tab(page, 'repo-file')).toHaveCount(1);
  await expect(tab(page, 'repo-file')).toHaveAttribute('data-preview', 'true');
  await expect(tab(page, 'repo-file')).toContainText('b.ts');

  // Double-click promotes the current preview tab to permanent (§5.2's own promotion trigger).
  await treeRow(page, 'b.ts').dblclick();
  await expect(tab(page, 'repo-file')).toHaveAttribute('data-preview', 'false');
  await expect(tab(page)).toHaveCount(2); // still pinned + the one (now permanent) file tab.

  // The Studio strip never shows a repo tab — switching back shows Studio's own (empty) strip.
  await page.locator('[data-testid="mode-tab"][data-mode="studio"]').click();
  await expect(page.locator('[data-testid="tab-strip-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-strip-row"] [data-testid="tab"]')).toHaveCount(0);
});

// C6 §10/§16: the diff tab's own vocabulary and a real createDiffEditor mount under WebKit — the
// one thing neither typecheck nor a Go test can reach. The diff algorithm itself is Monaco's, so
// this asserts only that "Open changes" opens a second, permanent tab with the diff host rendered.
test('a repo workspace: "Open changes" opens a diff tab', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: FILE_LISTING_WITH_STATUS,
      },
      DIFF_SNAP,
    ],
  });

  await repoRow(page).dblclick();
  await expect(treeRow(page, 'c.ts')).toBeVisible();

  await treeRow(page, 'c.ts').click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-testid="menu-item-open-changes"]').click();

  // A permanent tab (never the preview slot) — the pinned graph tab plus this one, two total.
  await expect(tab(page)).toHaveCount(2);
  const diffTab = tab(page, 'repo-diff');
  await expect(diffTab).toHaveCount(1);
  await expect(diffTab).toHaveAttribute('data-preview', 'false');
  await expect(diffTab).toContainText('c.ts (Working Tree)');
  await expect(page.locator('[data-testid="repo-diff-editor"]')).toBeVisible();

  // A row with no status glyph gets no "Open changes" entry at all (§8.4's own gate).
  await page.keyboard.press('Escape');
  await treeRow(page, 'a.ts').click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open-changes"]')).toHaveCount(0);
});

// C7 §10: the one UI case a Go test or typecheck can't reach — the CHANNEL.codeSearch
// subscription, the out-of-order merge-by-path (D11), and the result-click-to-preview-tab path
// (D12). Everything upstream of the event stream (the scanner itself, the coalescer) has its own
// coverage (search_test.go, the Go package's own layering); this only exercises what those can't.
test('a repo workspace: search streams results out of order and opens a match', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
      readFileSnap('a.ts', 'export const a = 1;\n'),
      { channel: IPC.codeWorkspaceStartSearch, response: { searchId: 'search-1' } },
    ],
  });

  await repoRow(page).dblclick();
  await page.locator('[data-testid="repo-view-search"]').click();

  const queryInput = page.locator('[data-testid="repo-search-query"]');
  await queryInput.fill('const');
  await queryInput.press('Enter');

  // 'b.ts' arrives first — enumeration order, not path order — but the store's own binary insert
  // (D11) must still land it after 'a.ts' once both are in.
  await emitWailsEvent(page, IPC.codeSearch, {
    searchId: 'search-1',
    seq: 0,
    files: [
      {
        path: 'b.ts',
        matches: [
          {
            line: 1,
            column: 8,
            endColumn: 13,
            preview: 'export const b = 2;',
            previewMatchStart: 7,
            previewMatchEnd: 12,
            truncatedStart: false,
            truncatedEnd: false,
          },
        ],
        truncated: false,
      },
    ],
    done: false,
  });
  await expect(page.locator('[data-testid="repo-search-file-row"]')).toHaveCount(1);

  await emitWailsEvent(page, IPC.codeSearch, {
    searchId: 'search-1',
    seq: 1,
    files: [
      {
        path: 'a.ts',
        matches: [
          {
            line: 1,
            column: 8,
            endColumn: 13,
            preview: 'export const a = 1;',
            previewMatchStart: 7,
            previewMatchEnd: 12,
            truncatedStart: false,
            truncatedEnd: false,
          },
        ],
        truncated: false,
      },
    ],
    done: true,
    stats: { filesScanned: 2, filesMatched: 2, filesSkipped: 0, matches: 2, truncated: false },
  });

  const fileRows = page.locator('[data-testid="repo-search-file-row"]');
  await expect(fileRows).toHaveCount(2);
  await expect(fileRows.nth(0)).toHaveAttribute('data-path', 'a.ts');
  await expect(fileRows.nth(1)).toHaveAttribute('data-path', 'b.ts');

  await expect(page.locator('[data-testid="repo-search-status"]')).toContainText(
    '2 results in 2 files',
  );

  // A single click on a match row opens a preview tab (§7.3's own onSelect/onOpen split).
  await page.locator('[data-testid="repo-search-match-row"][data-path="a.ts"]').click();
  const previewTab = tab(page, 'repo-file');
  await expect(previewTab).toHaveCount(1);
  await expect(previewTab).toHaveAttribute('data-preview', 'true');
  await expect(previewTab).toContainText('a.ts');
});

// C9 §7: the one UI case a Go test or typecheck can't reach — the CHANNEL.quickOpen subscription,
// the D6 workspace gate, genuinely fuzzy (non-contiguous) matching, the basename-vs-path ranking
// rule, and the Enter/⇧Enter preview-vs-permanent open. The scoreFn arithmetic and item build
// themselves are unit-test-exempt (§7's own bar) — this only exercises what those can't.
test('a repo workspace: quick open fuzzy-finds and opens a file', async ({ relaunch }) => {
  const QO_PATHS = ['alpha.ts', 'state/repoTabs.ts', 'repo/tabs/other.ts', 'repo/tabs/extra.ts'];
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: { paths: QO_PATHS, status: {}, truncated: false },
      },
      readFileSnap('alpha.ts', 'export const alpha = 1;\n'),
    ],
  });

  const quickOpen = () => page.locator('[data-testid="quick-open"]');
  const items = () => page.locator('[data-testid="quick-open-item"]');
  const input = page.locator('[data-testid="quick-open-input"]');

  // D6: ⌘P while Studio is active (no repo workspace) opens nothing.
  await emitWailsEvent(page, IPC.quickOpen, null);
  await expect(quickOpen()).toHaveCount(0);

  await repoRow(page).dblclick();

  // Renders with every fixture file, unfiltered, on open (D8 loads the tree itself).
  await emitWailsEvent(page, IPC.quickOpen, null);
  await expect(quickOpen()).toBeVisible();
  await expect(items()).toHaveCount(QO_PATHS.length);

  // A non-contiguous subsequence query matches — the one behavioural claim of D2 worth pinning:
  // genuinely fuzzy, not the substring filter C9 declined (CommandPalette.vue's own). 'rte' is
  // never a literal substring of 'repo/tabs/extra.ts' (r, then t from 'tabs', then e from 'extra').
  await input.fill('rte');
  await expect(items()).toHaveCount(1);
  await expect(items().first()).toHaveAttribute('data-path', 'repo/tabs/extra.ts');

  // A basename match outranks a path-only match for the same query (§3.2 rule 1): 'repotabs' is
  // a literal prefix of 'repoTabs.ts' but only a scattered subsequence of 'repo/tabs/other.ts'.
  await input.fill('repotabs');
  await expect(items().first()).toHaveAttribute('data-path', 'state/repoTabs.ts');

  // Enter opens a preview tab; re-opening and pressing ⇧Enter promotes it to permanent (D7 — the
  // palette's own keyboard equivalent of the tree/search views' single-click/double-click split).
  await input.fill('alpha');
  await expect(items()).toHaveCount(1);
  await input.press('Enter');
  await expect(quickOpen()).toHaveCount(0);
  const fileTab = tab(page, 'repo-file');
  await expect(fileTab).toHaveAttribute('data-preview', 'true');

  await emitWailsEvent(page, IPC.quickOpen, null);
  await input.fill('alpha');
  await input.press('Shift+Enter');
  await expect(quickOpen()).toHaveCount(0);
  await expect(fileTab).toHaveAttribute('data-preview', 'false');
});

// C11 §11/S16 — deliberately shallow (the plan's own words): the deep review behaviour (a real
// branch comparison, marking, comments) needs a real repository and is the manual recipe's job
// (docs/v1.5/plans/C11-code-review-native.md §15 step 7), not a UI spec. This asserts only that
// switching the panel to Review actually mounts the real @kira/git-ui ReviewView.vue bundle over
// the native git stream and renders something real (its own branch picker) rather than an empty
// container — the one thing neither typecheck nor a Go test can reach for this phase, the same
// role the diff-tab/search/quick-open specs above already play for C6/C7/C9.
//
// repo/git/transport.ts speaks the native git JSON-RPC protocol (@kira/git-ipc's rpc.ts) over a
// Wails Stream — an entirely different wire (and mocking mechanism, `window._wails.streamFactory`)
// than mockRuntime.ts's `control.*` Call endpoint or mockStream.ts's own FlatBuffers bulk-data
// protocol, and one this repo has no existing mock for (C10 never added a UI test for its own
// graph mount for the identical reason). installGitStreamMock below is a minimal, purpose-built
// stand-in — real enough to answer the three requests this shallow path actually needs
// (app.init, repo.list, refs.list) and silent (never crashing, just never resolving) for every
// other method, which is exactly what a real bootstrap() tolerates: review.session.load and
// review.resolveBase are awaited but never block the branch picker from rendering.
async function installGitStreamMock(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((gitRepoId: string) => {
    const w =
      (window as unknown as { _wails?: { streamFactory?: (name: string) => unknown } })._wails ??
      {};
    (window as unknown as { _wails: typeof w })._wails = w;
    const existingFactory = w.streamFactory;

    interface MockSocket {
      binaryType: string;
      onopen: ((ev: unknown) => void) | null;
      onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
      onclose: ((ev: unknown) => void) | null;
      onerror: ((ev: unknown) => void) | null;
      readyState: number;
      send(data: string): void;
      close(): void;
    }

    function deliver(socket: MockSocket, envelope: unknown): void {
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      setTimeout(() => socket.onmessage?.({ data: bytes.buffer }), 0);
    }

    function createGitMockSocket(): MockSocket {
      const socket: MockSocket = {
        binaryType: 'arraybuffer',
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        readyState: 0,
        send(data: string) {
          let envelope: { version: number; body?: { t?: string; id?: number; method?: string } };
          try {
            envelope = JSON.parse(data);
          } catch {
            return;
          }
          const frame = envelope.body;
          if (frame?.t !== 'req' || frame.id === undefined) return;
          // @kira/git-ipc's rpc.ts frame union: {t:'res', id, ok:true, result}.
          const resultByMethod: Record<string, unknown> = {
            'app.init': {
              contractVersion: envelope.version,
              serverVersion: 'ui-test',
              git: { kind: 'ok', path: '/usr/bin/git', version: '2.40.0' },
            },
            'repo.list': { candidates: [], activeRepoId: gitRepoId },
            'refs.list': {
              branches: [
                {
                  refname: 'refs/heads/main',
                  kind: 'branch',
                  shortName: 'main',
                  objectId: '0'.repeat(40),
                  peeledObjectId: undefined,
                  upstream: undefined,
                  track: undefined,
                  committerDate: 0,
                  isHead: true,
                  checkedOutIn: undefined,
                  annotation: undefined,
                },
              ],
              remoteBranches: [],
              tags: [],
              head: { kind: 'branch', name: 'main' },
            },
          };
          const method = frame.method;
          if (method === undefined || !(method in resultByMethod)) return; // hang forever
          deliver(socket, {
            version: envelope.version,
            body: { t: 'res', id: frame.id, ok: true, result: resultByMethod[method] },
          });
        },
        close() {
          socket.readyState = 3;
        },
      };
      setTimeout(() => {
        socket.readyState = 1;
        socket.onopen?.({});
      }, 0);
      return socket;
    }

    w.streamFactory = (name: string) =>
      name === 'git' ? createGitMockSocket() : existingFactory?.(name);
  }, REPO.repoId);
}

test('a repo workspace: switching the panel to Review mounts the review sidebar', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  // Must land before the repo workspace ever opens (ensureWorkspaceShell mounts the pinned graph
  // tab immediately, which is what first calls Stream('git') — repo/git/transport.ts's
  // gitTransportFor is lazy, unlike bridge/port.ts's own module-scope Stream('engine'), so
  // page.evaluate (not page.addInitScript) is both sufficient and correct here.
  await installGitStreamMock(page);

  await repoRow(page).dblclick();
  await page.locator('[data-testid="repo-view-review"]').click();

  await expect(page.locator('[data-testid="repo-review-host"]')).toBeVisible();
  // The "no branch chosen yet" picker — ReviewView.vue's own branch selector — with a real branch
  // row from the mocked refs.list, not an empty container.
  const picker = page.locator('[data-testid="review-no-branch"]');
  await expect(picker).toBeVisible();
  await expect(picker.getByText('main', { exact: true })).toBeVisible();
});
