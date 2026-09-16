import { defaultSettings } from '@shared/domain/settings';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { installGitStreamMock } from './support/gitStreamMock';
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

// P82 §12.3: a linked worktree and the row it becomes once switched to.
const WORKTREE_PATH = '/tmp/demo-repo-feature';
const WORKTREE_REPO = {
  id: 'repo-2',
  name: 'demo-repo-feature',
  root: WORKTREE_PATH,
  repoId: WORKTREE_PATH,
  sortOrder: 2,
  createdAt: '2026-01-02T00:00:00.000Z',
};
const WORKTREE_LIST_RESULT = {
  worktrees: [
    {
      path: REPO.repoId,
      head: '0'.repeat(40),
      branch: 'refs/heads/main',
      isBare: false,
      isDetached: false,
      isMain: true,
      isCurrent: true,
      locked: null,
      prunable: null,
      openElsewhere: false,
    },
    {
      path: WORKTREE_PATH,
      head: '1'.repeat(40),
      branch: 'refs/heads/feature',
      isBare: false,
      isDetached: false,
      isMain: false,
      isCurrent: false,
      locked: null,
      prunable: null,
      openElsewhere: false,
    },
  ],
};

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

function modeTab(page: import('@playwright/test').Page, mode: 'studio' | 'api' | 'git') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

// P78 §11.3: autocomplete.spec.ts's own identical helper (and sql-schema.spec.ts's) — Monaco splits
// a line's text across several highlighting spans, so `word` is not reliably its own DOM element;
// a real Range's bounding rect is the only reliable way to get a click point for it. Leaves the
// mouse positioned on the word — the caller drives the actual click/modifier keys from there.
async function hoverWord(
  page: import('@playwright/test').Page,
  view: import('@playwright/test').Locator,
  word: string,
): Promise<void> {
  const point = await view.locator('.view-lines').evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const idx = (node.textContent ?? '').indexOf(w);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + w.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, word);
  if (!point) throw new Error(`hoverWord: "${word}" not found in .view-lines`);
  await page.mouse.move(0, 0);
  await page.mouse.move(point.x, point.y);
}

// P67b §4.4: the repo list lives in the Git module's own panel now, not Studio's — every test
// below that used to find `repoRow` directly on boot (Studio active by default) switches to Git
// first, the same one click a real user makes.
async function openGitModule(page: import('@playwright/test').Page): Promise<void> {
  await modeTab(page, 'git').click();
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
}

test('a repo workspace: pinned graph tab, preview-slot reuse, promotion, and studio isolation', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });

  // P67b §0/§4.4: the repo list is not in Studio's panel at all — it lives in the Git module's
  // own panel now, absorbed out of the old "Connections" section.
  await expect(page.locator('[data-testid="repo-row"]')).toHaveCount(0);
  await openGitModule(page);

  // Import a fixture repository (seeded above) — visible in the Git panel's repo list.
  await expect(repoRow(page)).toBeVisible();

  // Opening it activates its own workspace and the row itself, and adds no top-level tab (§0's
  // correction — exactly three mode tabs, always). A single click (onRowClick's own open-or-
  // activate semantics), not a double click: P84 §8.3's auto-switch-to-Files already fires on
  // this same click, so a genuine second click at the same fixed point (what `.dblclick()` sends)
  // now lands on the Files tab's own relocated view-strip instead of the vanished row — a real
  // double-click's second physical click racing the same instant re-layout, not a test artifact.
  await repoRow(page).click();
  // P84 §8.3: opening the workspace auto-switched the panel to Files — switch back to see the row
  // itself, since this is a migrated spot the plan's own §13.2 line-180 note didn't separately
  // call out (it only tracked the later file-tree interaction, not this earlier row assertion).
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(repoRow(page)).toHaveClass(/active/);
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="mode-tab"]')).toHaveCount(3);

  // The pinned graph tab exists, alone, and has no close button.
  await expect(tab(page)).toHaveCount(1);
  const graphTab = tab(page, 'repo-graph');
  await expect(graphTab).toHaveCount(1);
  await expect(graphTab.locator('[data-testid="tab-close"]')).toHaveCount(0);

  // Single click opens a preview tab (§5.2 rule 1/4) — the strip now shows two tabs: pinned +
  // one preview, italic.
  await page.locator('[data-testid="git-panel-tab-files"]').click();
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
  await expect(page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]')).toHaveCount(
    0,
  );
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

  await openGitModule(page);
  await repoRow(page).click();
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

  await openGitModule(page);
  await repoRow(page).click();
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

  await openGitModule(page);
  await repoRow(page).click();

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
test('a repo workspace: switching the panel to Review mounts the review sidebar', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  // Must land before the repo workspace ever opens (ensureWorkspaceShell mounts the pinned graph
  // tab immediately, which is what first calls Stream('git') — repo/git/transport.ts's
  // gitTransportFor is lazy, unlike bridge/port.ts's own module-scope Stream('engine'), so
  // page.evaluate (not page.addInitScript) is both sufficient and correct here.
  await installGitStreamMock(page, REPO.repoId);

  await openGitModule(page);
  await repoRow(page).click();
  await page.locator('[data-testid="repo-view-review"]').click();

  await expect(page.locator('[data-testid="repo-review-host"]')).toBeVisible();
  // The "no branch chosen yet" picker — ReviewView.vue's own branch selector — with a real branch
  // row from the mocked refs.list, not an empty container.
  const picker = page.locator('[data-testid="review-no-branch"]');
  await expect(picker).toBeVisible();
  await expect(picker.getByText('main', { exact: true })).toBeVisible();
});

// P62 §9: deliberately shallow, matching C11's own call for the review sidebar above — tests/ui/
// has no git-stream mock that can answer blame.line, so asserting a real blame answer would need a
// fixture that is its own piece of work, not this row's (§9's own reasoning). What this tier CAN
// assert: the gitRepoIdFor === undefined guard (§4.1) is honest (no crash, no annotation) rather
// than assumed, and toggling the setting leaves the editor mounted and healthy either way.
test('a repo workspace: the blame annotation stays off with no git record, and its setting toggles safely', async ({
  relaunch,
}) => {
  // A repository this window has no git record for — repoId '' (never populated), the same "no
  // git identification" shape a plain-folder import would produce. gitRepoIdFor(codeRepoId) reads
  // this back as falsy, exactly the guard RepoFileView.vue/blameAnnotation.ts checks.
  const NO_GIT_REPO = { ...REPO, id: 'repo-no-git', repoId: '' };
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [NO_GIT_REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: NO_GIT_REPO.id },
        response: FILE_LISTING,
      },
      {
        channel: IPC.codeWorkspaceReadFile,
        args: { id: NO_GIT_REPO.id, path: 'a.ts' },
        response: {
          kind: 'found',
          text: 'export const a = 1;\n',
          bytes: 21,
          limitBytes: 8 * 1024 * 1024,
          language: 'typescript',
        },
      },
      { channel: IPC.settingsSet, response: defaultSettings },
    ],
  });

  await openGitModule(page);
  const noGitRepoRow = page.locator(`[data-testid="repo-row"][data-repo-id="${NO_GIT_REPO.id}"]`);
  await noGitRepoRow.click();
  await expect(treeRow(page, 'a.ts')).toBeVisible();
  await treeRow(page, 'a.ts').click();

  const editor = page.locator('[data-testid="repo-file-editor"]');
  await expect(editor).toBeVisible();
  // §4.1's guard is honest, not merely absent because nothing ever requested a blame line: no
  // annotation renders at all.
  await expect(page.locator('.kira-blame-inline')).toHaveCount(0);

  // Toggling the setting off and back on, then saving, doesn't disturb the still-mounted editor —
  // the live watch (RepoFileView.vue) and the dispose/reattach cycle both run cleanly with no git
  // record behind them.
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
  await page.click('[data-testid="settings-inline-blame"]');
  await page.click('[data-testid="settings-inline-blame"]');
  await page.click('[data-testid="settings-save"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toHaveCount(0);

  await expect(editor).toBeVisible();
  await expect(page.locator('.kira-blame-inline')).toHaveCount(0);
});

// P76 §5/§12.2: the status bar's own blame item, plus §2's revision-pinned guard proven the same
// way the test above proves its guard — a resolvable trap, not an absent one. Both `repo.open` and
// `blame.line` answer in each relaunch below; if `blameable` ever again omitted `rev === null`
// (§2's fix), the revision-pinned half would call them too and the item would wrongly appear.
test('a repo workspace: the status bar blame item follows the cursor, and never shows on a revision-pinned tab (P76)', async ({
  relaunch,
}) => {
  const BLAME_RESULT = {
    sha: 'a'.repeat(40),
    author: 'Ada Lovelace',
    authorTimeSeconds: 1_700_000_000,
    summary: 'Fix the frobnicator',
  };

  {
    const { window: page } = await relaunch({ control: CONTROL });
    // See :364's own comment: lazy `gitTransportFor`, so this lands before Stream('git') is ever
    // called as long as it precedes the click that opens the workspace.
    await installGitStreamMock(page, REPO.repoId, {
      'repo.open': undefined,
      'blame.line': BLAME_RESULT,
    });

    await openGitModule(page);
    await repoRow(page).click();
    await treeRow(page, 'a.ts').click();

    const editor = page.locator('[data-testid="repo-file-editor"]');
    await expect(editor).toBeVisible();
    const blameStatus = page.locator('[data-testid="blame-status"]');
    await expect(blameStatus).toHaveCount(0); // nothing resolved until the cursor actually moves

    await editor.locator('.view-lines').click();
    await page.keyboard.press('ArrowDown');

    await expect(blameStatus).toBeVisible();
    await expect(blameStatus).toContainText('Ada Lovelace');
    await expect(blameStatus).toContainText('Fix the frobnicator');
  }

  {
    // A revision-pinned repo-file tab (`rev` set), seeded directly as a restored tab — the real
    // navigation paths to one (a commit's "Go to file", a diff tab's own go-to-file command) both
    // need `graph.stream`/`file.goToTarget`, which this mock deliberately never answers (§10).
    // Marking it `active` here (unlike the restored-tab test above, which leaves its tab inactive
    // to exercise ensureWorkspaceShell's own fallback) means it renders as soon as the workspace
    // itself activates, with no tree click needed.
    const REV = 'b'.repeat(40);
    const { window: page } = await relaunch({
      control: [
        // mockRuntime.ts's own inferredBootMode() maps an active tab's `kind` through
        // TAB_KIND_MODE, whose repo-file/repo-graph entry is the fixed sentinel 'repo' (state/
        // mode.ts's own comment) — not a real AppMode, and not what hydrateMode's own
        // `workspaceState.active = mode` (state/mode.ts:44) expects. An explicit snapshot sidesteps
        // that inference the same way the restored-tab test above's does, for the same reason.
        { channel: IPC.windowsEnsure, response: { mode: 'studio' } },
        { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
        { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
        {
          channel: IPC.tabsList,
          response: [
            {
              id: 'restored-repo-graph',
              kind: 'repo-graph',
              connectionId: null,
              path: '',
              order: 0,
              active: false,
              workspaceId: `repo:${REPO.id}`,
              state: { viewState: null, reviewSession: null },
            },
            {
              id: 'restored-repo-file-rev',
              kind: 'repo-file',
              connectionId: null,
              path: 'a.ts',
              order: 1,
              active: true,
              workspaceId: `repo:${REPO.id}`,
              state: { revealLine: null, markdownReading: false, rev: REV },
            },
          ],
        },
      ],
    });
    await installGitStreamMock(page, REPO.repoId, {
      'repo.open': undefined,
      'blame.line': BLAME_RESULT,
      'file.read': { kind: 'found', content: 'export const a = 1;\n' },
    });

    await openGitModule(page);
    await repoRow(page).click();

    const editor = page.locator('[data-testid="repo-file-editor"]');
    await expect(editor).toBeVisible();
    await expect(page.locator('[data-testid="blame-status"]')).toHaveCount(0);
  }
});

// P67b §4.2/§9: "activating a repo tab from anywhere brings the Git module forward" — the
// concrete boot-time manifestation is main.ts's post-hydrate loop: a window that persisted
// 'studio' as its own module but restored a repo's pinned graph tab with no active tab of its own
// (ensureWorkspaceShell's own gate) calls activateTab -> setActiveTabId -> activateWorkspace,
// which now persists 'git' (setModule) rather than leaving modeState.active untouched the way the
// pre-phase code did (state/tabs.ts's own updated doc comment). This is the same state-layer path
// Quick Open's own "jump to a repo file" goes through — Quick Open itself can only be invoked from
// inside an already-active repo workspace (D6), so this is the boot-time route that actually
// starts from Studio.
test('a repo tab restored from a previous session brings the Git module forward, even though the window persisted Studio', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'studio' } },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
      {
        channel: IPC.tabsList,
        response: [
          {
            id: 'restored-repo-graph',
            kind: 'repo-graph',
            connectionId: null,
            path: '',
            order: 0,
            active: false,
            workspaceId: `repo:${REPO.id}`,
            state: { viewState: null, reviewSession: null },
          },
        ],
      },
    ],
  });

  // The window's own persisted mode was 'studio' — but a live repo tab survived restore with no
  // active tab of its own, so boot brings Git forward instead of honouring the stale persisted
  // mode literally.
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'studio')).not.toHaveClass(/is-active/);
  await expect(tab(page, 'repo-graph')).toHaveCount(1);
});

// P67b §4.2/§9: workspaceState.lastRepoKey — leaving Git for another module and coming back lands
// on the same repository, the same "return to where you were" behaviour the old per-repo title-bar
// tabs gave for free.
test('leaving Git for Api and returning lands back on the same repository', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });

  await openGitModule(page);
  await repoRow(page).click();
  await expect(tab(page, 'repo-graph')).toHaveCount(1);

  await modeTab(page, 'api').click();
  await expect(modeTab(page, 'api')).toHaveClass(/is-active/);

  await modeTab(page, 'git').click();
  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  // P84 §8.3: a repo workspace being active auto-switches the panel to Files — switch back to see
  // the repo row itself.
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(repoRow(page)).toHaveClass(/active/);
  await expect(tab(page, 'repo-graph')).toHaveCount(1);
});

// P67b §4.2/§9: closing the active repo workspace from its row menu falls back to the Git
// module's own empty state (GitStart.vue), not to Studio — a repo workspace closing is a
// Git-module event.
test("closing the active repo workspace from its row menu falls back to the Git module's empty state, not Studio", async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });

  await openGitModule(page);
  await repoRow(page).click();
  await expect(tab(page, 'repo-graph')).toHaveCount(1);

  // P82: the row's hover × is gone — closing is the row menu's job now.
  await expect(page.locator('[data-testid="workspace-repo-close"]')).toHaveCount(0);

  // P84 §8.3: the panel auto-switched to Files when the workspace opened — switch back to reach
  // the repo row's own context menu.
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await repoRow(page).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.locator('[data-testid="menu-item-close"]').click();

  await expect(modeTab(page, 'git')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'studio')).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="git-start"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).not.toContainText('Connections');
});

// P82 §12.3: expanding a row lists its worktrees without opening it (the twisty's own
// @click.stop, §8.1), and clicking a linked worktree switches to it — importing it as its own
// code_repos row first, since this app has none for that root yet — the same premise
// WorktreeList.vue's own switch rests on, not a second worktree-switching path (§5).
test('a repo workspace: expanding a row lists its worktrees, and switching to one opens its own workspace', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      ...CONTROL,
      {
        channel: IPC.codeWorkspaceImportRepo,
        args: { path: WORKTREE_PATH },
        response: WORKTREE_REPO,
      },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: WORKTREE_REPO.id },
        response: FILE_LISTING,
      },
    ],
  });

  // Installed before the expanding click — repo/git/transport.ts's gitTransportFor is lazy, so
  // Stream('git') is first called only once the row actually expands (repo-workspace.spec.ts:485's
  // own comment gives the identical reason).
  await installGitStreamMock(page, REPO.repoId, {
    'repo.open': undefined,
    'worktree.list': WORKTREE_LIST_RESULT,
  });

  await openGitModule(page);
  await repoRow(page).locator('[data-testid="repo-row-expand"]').click();

  // Expanding must not open the workspace — the assertion that guards the twisty's own @click.stop.
  await expect(tab(page, 'repo-graph')).toHaveCount(0);

  const worktreeRows = page.locator('[data-testid="repo-worktree-row"]');
  await expect(worktreeRows).toHaveCount(2);
  const linkedRow = page.locator(
    `[data-testid="repo-worktree-row"][data-worktree-path="${WORKTREE_PATH}"]`,
  );
  await expect(linkedRow).toContainText('feature');

  await linkedRow.click();

  // The switch actually happened, not just that a call was made.
  expect(
    control
      .log()
      .some(
        (e) =>
          e.channel === IPC.codeWorkspaceImportRepo &&
          JSON.stringify(e.args) === JSON.stringify({ path: WORKTREE_PATH }),
      ),
  ).toBe(true);

  // P84: the opened worktree renders nowhere at the top level — only nested under its parent's
  // twisty. Without §4.5's click-time hint this would be racy-then-green (the row appears for one
  // round trip before the batched RepoWorktreeLinks answer removes it); toHaveCount(0) catches that.
  const flatDuplicateRow = page.locator(
    `[data-testid="repo-row"][data-repo-id="${WORKTREE_REPO.id}"]`,
  );
  await expect(flatDuplicateRow).toHaveCount(0);

  // P84 §8.3: switching opened the workspace, which flipped the panel to Files — switch back to
  // see the nested row's own active marking.
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(linkedRow).toHaveClass(/active/);
  await expect(tab(page, 'repo-graph')).toHaveCount(1);

  // Collapsing again drops the worktree list.
  await repoRow(page).locator('[data-testid="repo-row-expand"]').click();
  await expect(page.locator('[data-testid="repo-worktrees"]')).toHaveCount(0);
});

// P84 §13.4: the hydration path — a worktree imported in an *earlier* session has both rows already
// in codeWorkspaceListRepos on boot, with no click to supply §4.5's hint. This is what proves the
// batched RepoWorktreeLinks call itself is wired: §13.3's own test would pass even if it were never
// called, since the click-time hint alone is enough there.
test('a worktree imported in an earlier session lists only under its parent', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO, WORKTREE_REPO] },
      {
        channel: IPC.codeWorkspaceRepoWorktreeLinks,
        response: [
          { id: REPO.id, parentId: '' },
          { id: WORKTREE_REPO.id, parentId: REPO.id },
        ],
      },
    ],
  });

  await installGitStreamMock(page, REPO.repoId, {
    'repo.open': undefined,
    'worktree.list': WORKTREE_LIST_RESULT,
  });

  await openGitModule(page);

  // Exactly one top-level row — the anchor. The worktree's own row never renders flat.
  await expect(page.locator('[data-testid="repo-row"]')).toHaveCount(1);
  await expect(repoRow(page)).toHaveCount(1);

  await repoRow(page).locator('[data-testid="repo-row-expand"]').click();
  const worktreeRows = page.locator('[data-testid="repo-worktree-row"]');
  await expect(worktreeRows).toHaveCount(2);
  // Main worktree first (worktrees.ts:44-52's own sort).
  await expect(worktreeRows.first()).toContainText('main');

  // §6.2's reachability guarantee: the nested row still offers Rename/Close/Remove, the thing that
  // makes hiding its flat duplicate safe.
  const linkedRow = page.locator(
    `[data-testid="repo-worktree-row"][data-worktree-path="${WORKTREE_PATH}"]`,
  );
  await linkedRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-remove"]')).toBeVisible();
});

// P67b §6/§9: a .ts row and a .go row carry different per-language icon styles (ported from the
// diff tree's own setiIconFor rule, repo/fileIcon.ts), and a directory row still carries a real
// codicon (folder/folder-opened) — §6.2/OQ-3: no directory-icon rule was ported, since the diff
// tree has none.
test('a repo workspace: file-tree rows carry per-language icons, directories keep their codicon', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: {
          paths: ['main.go', 'app.ts', 'src/util.ts'],
          status: {},
          truncated: false,
        },
      },
      readFileSnap('main.go', 'package main\n'),
    ],
  });

  await openGitModule(page);
  await repoRow(page).click();

  const goIcon = treeRow(page, 'main.go').locator('.node-icon');
  const tsIcon = treeRow(page, 'app.ts').locator('.node-icon');
  await expect(goIcon).toBeVisible();
  await expect(tsIcon).toBeVisible();

  const [goStyle, tsStyle] = await Promise.all([
    goIcon.getAttribute('style'),
    tsIcon.getAttribute('style'),
  ]);
  expect(goStyle).toContain('mask-image');
  expect(tsStyle).toContain('mask-image');
  expect(goStyle).not.toBe(tsStyle);

  // The directory row synthesized from 'src/util.ts' keeps a real codicon glyph — not a mask icon.
  const dirRow = treeRow(page, 'src');
  await expect(dirRow.locator('.codicon-folder, .codicon-folder-opened')).toHaveCount(1);
  await expect(dirRow.locator('.node-icon[style*="mask-image"]')).toHaveCount(0);

  // P73 §2: opening main.go carries the same seti icon on its tab as on its tree row.
  await treeRow(page, 'main.go').click();
  const tabFileIcon = tab(page, 'repo-file').locator('.tab-file-icon');
  await expect(tabFileIcon).toBeVisible();
  expect(goStyle).not.toBeNull();
  await expect(tabFileIcon).toHaveAttribute('style', goStyle as string);
});

// P78 §1.3/§11.3: the one thing neither a Go test nor a unit test can reach — a real
// GotoDefinitionAtPositionEditorContribution against a real Monaco editor. This is also the
// regression guard for §1.3's own defect: without views/repo/textModels.ts's kira-repo-aware
// ITextModelService, `.goto-definition-link` never renders for a cross-file target (the preview
// resolve rejects with "Model not found") even though the click still navigates — so an assertion
// that only clicked and checked the resulting tab would stay green through that bug.
test('a repo workspace: modifier-click renders the definition-link affordance and navigates cross-file', async ({
  relaunch,
}) => {
  const DEFINITION: ControlSnapshot = {
    channel: IPC.codeWorkspaceDefinitions,
    response: {
      status: 'ready',
      name: 'value',
      targets: [
        {
          path: 'b.ts',
          language: 'typescript',
          kind: 'const',
          name: 'value',
          container: '',
          rule: 'sameFile',
          confidence: 'scoped',
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 19,
        },
      ],
    },
  };

  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
      readFileSnap('a.ts', 'export const value = 1;\nvalue();\n'),
      readFileSnap('b.ts', 'export const value = 2;\n'),
      DEFINITION,
    ],
  });

  await openGitModule(page);
  await repoRow(page).click();
  await treeRow(page, 'a.ts').click();

  const editor = page.locator('[data-testid="repo-file-editor"]');
  await expect(editor).toBeVisible();

  // P78 §1.1: this tier's WebKit reports a Macintosh UA (same as the packaged app's WKWebView), so
  // Monaco's own ClickLinkGesture picks `metaKey` as its trigger, never `ctrlKey` — a `Control`
  // press here would pass vacuously, proving nothing about the real defect (§1.1's own measurement).
  await page.keyboard.down('Meta');
  await hoverWord(page, editor, 'value');
  // §1.3: the underline only renders once the (mocked) cross-file target resolves through the new
  // preview-model service — this is the fact a plain click-then-assert-tab test would miss entirely.
  await expect(editor.locator('.goto-definition-link')).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Meta');

  await expect(tab(page, 'repo-file')).toContainText('b.ts');
});

// P78 §7.2/§7.3/§8.3/§11.3: the peek widget's own DOM (Shift+F12's default keybinding, respecting
// this app's `gotoLocation.multipleReferences: 'peek'`) plus the status-bar readout navigation.ts
// publishes alongside it — neither reachable from a Go test or a unit test.
test('a repo workspace: Shift+F12 peeks references and publishes the status-bar readout', async ({
  relaunch,
}) => {
  const REFERENCES: ControlSnapshot = {
    channel: IPC.codeWorkspaceReferences,
    response: {
      status: 'ready',
      name: 'value',
      sites: [
        {
          path: 'a.ts',
          language: 'typescript',
          kind: 'const',
          name: 'value',
          enclosing: '',
          confidence: 'exact',
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 19,
        },
        {
          path: 'a.ts',
          language: 'typescript',
          kind: 'call',
          name: 'value',
          enclosing: '',
          confidence: 'scoped',
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 6,
        },
        {
          path: 'b.ts',
          language: 'typescript',
          kind: 'call',
          name: 'value',
          enclosing: '',
          confidence: 'repoWide',
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 6,
        },
      ],
      total: 3,
      truncated: false,
      unattributed: 2,
    },
  };

  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
      readFileSnap('a.ts', 'export const value = 1;\nvalue();\n'),
      readFileSnap('b.ts', 'value();\n'),
      REFERENCES,
    ],
  });

  await openGitModule(page);
  await repoRow(page).click();
  await treeRow(page, 'a.ts').click();

  const editor = page.locator('[data-testid="repo-file-editor"]');
  await expect(editor).toBeVisible();

  // No modifier this time — just places the cursor on the identifier for Shift+F12 to read.
  await hoverWord(page, editor, 'value');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press('Shift+F12');

  await expect(page.locator('.reference-zone-widget')).toBeVisible();
  const navStatus = page.locator('[data-testid="nav-status"]');
  await expect(navStatus).toContainText('3 references');
  await expect(navStatus).toContainText('2 unattributed');
});

// terminalId is a client-generated UUID (state/tabs.ts's own crypto.randomUUID()) — unpredictable
// ahead of time, so this carries no `args` at all and relies on mockRuntime.ts's own single-
// snapshot shortcut ("a channel called with the same args every time … answers regardless of the
// exact args it was called with"). Without a real answer here, the mocked call 422s and
// openTerminalSession's own catch marks the session 'failed' — terminalCountAtPath excludes that
// status, so the indicator test below would flip invisible again once the call resolves.
const TERMINAL_OPEN_OK: ControlSnapshot = {
  channel: IPC.terminalOpen,
  response: { shell: '/bin/zsh' },
};

// P83 §17.2/§17.3: the embedded terminal's own wiring — real shell I/O is out of scope for this
// tier (§17.3's own stated boundary; internal/terminal/session_test.go covers that). This is a
// wiring test, not a call-count test: it proves subscribe -> decode -> term.write -> DOM by
// rendering a synthesized `kira:terminal:data` chunk inside the real xterm.js DOM it mounts.
test("the tab strip's + opens a terminal tab at the active worktree", async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: [...CONTROL, TERMINAL_OPEN_OK] });

  await openGitModule(page);
  await repoRow(page).click();

  await page.locator('[data-testid="tab-strip-new"]').click();
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid^="menu-item-"]')).toHaveCount(1);

  await menu.locator('[data-testid="menu-item-new-terminal"]').click();

  const terminalTab = tab(page, 'terminal');
  await expect(terminalTab).toHaveCount(1);
  const terminalId = await terminalTab.getAttribute('data-tab-id');
  expect(terminalId).not.toBeNull();

  // .xterm-rows appearing proves the dynamic import of terminalRenderer.ts settled and xterm
  // mounted; the terminalOpen call itself is fire-and-forget from RepoTerminalView.vue's own
  // mount(), so a plain synchronous check can race its still-in-flight mocked round trip —
  // expect.poll rather than a fixed wait.
  await expect(page.locator('.xterm-rows')).toBeVisible();

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { cwd?: string } | undefined)?.cwd === REPO.root,
        ),
    )
    .toBe(true);

  await emitWailsEvent(page, IPC.terminal, {
    terminalId,
    data: Buffer.from('hello\r\n').toString('base64'),
    exited: false,
  });
  await expect(page.locator('.xterm-rows')).toContainText('hello');
});

// P83 §10.2/§11.2: a worktree row's own context menu (out of scope for P82 — nothing needed one
// until a terminal could be opened at a worktree that isn't the active workspace) plus the
// indicator's own row-specificity: it must key off the terminal's cwd, not merely "a terminal is
// open somewhere in this repository".
test("a worktree row's menu opens a terminal there, and both rows show the indicator", async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: [...CONTROL, TERMINAL_OPEN_OK] });

  // Installed before the expanding click — gitTransportFor is lazy (repo-workspace.spec.ts's own
  // comment on the identical setup above).
  await installGitStreamMock(page, REPO.repoId, {
    'repo.open': undefined,
    'worktree.list': WORKTREE_LIST_RESULT,
  });

  await openGitModule(page);
  await repoRow(page).locator('[data-testid="repo-row-expand"]').click();

  const worktreeRows = page.locator('[data-testid="repo-worktree-row"]');
  await expect(worktreeRows).toHaveCount(2);
  const linkedRow = page.locator(
    `[data-testid="repo-worktree-row"][data-worktree-path="${WORKTREE_PATH}"]`,
  );
  const mainRow = page.locator(
    `[data-testid="repo-worktree-row"][data-worktree-path="${REPO.repoId}"]`,
  );

  await linkedRow.click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-testid="menu-item-open-terminal"]').click();

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { cwd?: string } | undefined)?.cwd === WORKTREE_PATH,
        ),
    )
    .toBe(true);

  // openRepoTerminalTab opens repo.id's own workspace as a side effect (it calls
  // openRepoWorkspace), so P84 §8.3's auto-switch already flipped the panel to Files — switch
  // back to see the worktree rows again (the same migration §13.2 applies at :652/:673; this
  // test's own "never opens a workspace" note in the P84 plan missed this call chain).
  await page.locator('[data-testid="git-panel-tab-repos"]').click();

  // Both row kinds share the same indicator markup (data-testid="repo-terminal-indicator",
  // GitPanel.vue) — this proves it lands only on the row whose own path matches the terminal's
  // cwd, on neither the sibling worktree row nor the collapsed repo row above them.
  await expect(linkedRow.locator('[data-testid="repo-terminal-indicator"]')).toHaveCount(1);
  await expect(mainRow.locator('[data-testid="repo-terminal-indicator"]')).toHaveCount(0);
  await expect(repoRow(page).locator('[data-testid="repo-terminal-indicator"]')).toHaveCount(0);
});

// P83 §12/§13: a repo row's checked-out branch (RepoHeads, batched) and §13.2's sort, proven
// together — the mock deliberately answers worktree.list linked-first, so a first-row assertion
// that only ever matched the server's own order would pass vacuously here.
test('every repo row shows its checked-out branch, main worktree first', async ({ relaunch }) => {
  const REPO2 = {
    id: 'repo-2',
    name: 'demo-repo-2',
    root: '/tmp/demo-repo-2',
    repoId: '/tmp/demo-repo-2',
    sortOrder: 2,
    createdAt: '2026-01-03T00:00:00.000Z',
  };
  const REPO2_SHA = `abc1234${'0'.repeat(33)}`;

  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO, REPO2] },
      {
        channel: IPC.codeWorkspaceRepoHeads,
        args: { ids: null },
        response: [
          { id: REPO.id, head: { kind: 'branch', name: 'main' } },
          { id: REPO2.id, head: { kind: 'detached', sha: REPO2_SHA } },
        ],
      },
    ],
  });

  // worktree.list answers linked-first, deliberately — §13.2's sort must reorder it, not merely
  // pass through the server's own order.
  await installGitStreamMock(page, REPO.repoId, {
    'repo.open': undefined,
    'worktree.list': {
      worktrees: [
        {
          path: WORKTREE_PATH,
          head: '1'.repeat(40),
          branch: 'refs/heads/feature',
          isBare: false,
          isDetached: false,
          isMain: false,
          isCurrent: false,
          locked: null,
          prunable: null,
          openElsewhere: false,
        },
        {
          path: REPO.repoId,
          head: '0'.repeat(40),
          branch: 'refs/heads/main',
          isBare: false,
          isDetached: false,
          isMain: true,
          isCurrent: true,
          locked: null,
          prunable: null,
          openElsewhere: false,
        },
      ],
    },
  });

  await openGitModule(page);

  await expect(repoRow(page).locator('.repo-head')).toHaveText('main');
  const repo2Row = page.locator(`[data-testid="repo-row"][data-repo-id="${REPO2.id}"]`);
  await expect(repo2Row.locator('.repo-head')).toHaveText('detached @ abc1234');

  await repoRow(page).locator('[data-testid="repo-row-expand"]').click();
  const worktreeRows = page.locator('[data-testid="repo-worktree-row"]');
  await expect(worktreeRows).toHaveCount(2);
  await expect(worktreeRows.first()).toHaveAttribute('data-worktree-path', REPO.repoId);
  await expect(worktreeRows.first().locator('.worktree-badge')).toHaveText('main');
});
