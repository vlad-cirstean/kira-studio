import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P67c §8: the one UI case a Go test or typecheck can't reach for item 4 — a real markdown-it
// render inside a real WKWebView, the v-show-not-v-if editor-survival contract (D11), and the
// click-neutering security requirement (D13). markdown-it's own parsing is unit-test-exempt (§5.6
// — one library call against a fixed options object); this only exercises what that can't.

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const MARKDOWN_TEXT = [
  '# Title',
  '',
  'Some intro text with a [same-page link](#section-two) and an',
  '[external link](https://example.com/page).',
  '',
  '<script>alert(1)</script>',
  '',
  '- one',
  '- two',
  '- three',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  ...Array.from(
    { length: 80 },
    (_, i) => `Paragraph line ${i + 1} of filler text to force scroll.`,
  ),
  '',
  '## Section two',
  '',
  'The target of the same-page link above.',
].join('\n');

function readFileSnap(path: string, text: string, language = 'typescript'): ControlSnapshot {
  return {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path },
    response: { kind: 'found', text, bytes: text.length, limitBytes: 8 * 1024 * 1024, language },
  };
}

async function openGitModule(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="git"]').click();
  await expect(page.locator('[data-testid="mode-tab"][data-mode="git"]')).toHaveClass(/is-active/);
}

function treeRow(page: import('@playwright/test').Page, path: string) {
  return page.locator(`[data-testid="repo-tree-row"][data-path="${path}"]`);
}

test('a repo workspace: a markdown file opens on Source with a Reading toggle, and toggling never disposes the editor', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: { paths: ['README.md'], status: {}, truncated: false },
      },
      readFileSnap('README.md', MARKDOWN_TEXT, 'markdown'),
    ],
  });

  await openGitModule(page);
  await page.locator('[data-testid="repo-row"]').dblclick();
  await treeRow(page, 'README.md').click();

  // Opens on Source, toolbar present, editor visible.
  const editor = page.locator('[data-testid="repo-file-editor"]');
  const markdown = page.locator('[data-testid="repo-file-markdown"]');
  await expect(page.locator('[data-testid="repo-file-view-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="repo-file-view-source"]')).toHaveClass(/on/);
  await expect(editor).toBeVisible();
  await expect(markdown).toHaveCount(0);

  // Scroll the editor's own viewport on a long file (real scroll, not a fixture-independent
  // stand-in) before toggling — this is the observable proxy for "the widget was never disposed":
  // v-if would recreate the editor at scrollTop 0, v-show (D11) keeps the same instance and its
  // scroll state. Monaco virtualizes its content with `.lines-content`'s own inline `top` offset,
  // not a native `scrollTop` on `.editor-scrollable` (confirmed by direct inspection), so that's
  // the property this asserts against.
  const linesContent = editor.locator('.lines-content');
  await editor.locator('.view-lines').click();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('PageDown');
  }
  await expect.poll(() => linesContent.evaluate((el) => el.style.top)).not.toBe('0px');
  const scrollTopBeforeToggle = await linesContent.evaluate((el) => el.style.top);

  // Click Reading — a real <h1>/<ul> renders, the Monaco container is hidden but still in the DOM.
  await page.locator('[data-testid="repo-file-view-reading"]').click();
  await expect(markdown).toBeVisible();
  await expect(markdown.locator('h1')).toHaveText('Title');
  await expect(markdown.locator('ul li')).toHaveCount(3);
  await expect(editor).toBeAttached();
  await expect(editor).toBeHidden();

  // P73 §7/§8: a fenced code block's font-size matches Monaco's own exactly — the root cause this
  // phase fixed (the block used to inherit :deep(code)'s one-step-smaller --kira-t-sm).
  const [preFontSize, viewLineFontSize] = await Promise.all([
    markdown.locator('pre code').evaluate((el) => getComputedStyle(el).fontSize),
    editor
      .locator('.view-line')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  ]);
  expect(preFontSize).toBe(viewLineFontSize);

  // Toggle back — the editor is visible again and its scroll position survived.
  await page.locator('[data-testid="repo-file-view-source"]').click();
  await expect(editor).toBeVisible();
  await expect(markdown).toHaveCount(0);
  await expect(linesContent.evaluate((el) => el.style.top)).resolves.toBe(scrollTopBeforeToggle);
});

test('a repo workspace: the markdown reading view escapes raw HTML and never navigates on a link click', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: { paths: ['README.md'], status: {}, truncated: false },
      },
      readFileSnap('README.md', MARKDOWN_TEXT, 'markdown'),
    ],
  });

  await openGitModule(page);
  await page.locator('[data-testid="repo-row"]').dblclick();
  await treeRow(page, 'README.md').click();
  await page.locator('[data-testid="repo-file-view-reading"]').click();

  const markdown = page.locator('[data-testid="repo-file-markdown"]');
  await expect(markdown).toBeVisible();

  // D13/§5.1: `html: false` escaped the literal <script> tag — it renders as inert text, never a
  // real element, and definitely never executes (no dialog fires from the fixture's alert(1)).
  await expect(markdown.locator('script')).toHaveCount(0);
  await expect(markdown).toContainText('<script>alert(1)</script>');

  // An external link: clicking it never navigates the app (no back button in this webview), and
  // its target is surfaced through the title attribute instead of being followed.
  const externalLink = markdown.getByRole('link', { name: 'external link' });
  await expect(externalLink).toHaveAttribute('title', 'https://example.com/page');
  const urlBefore = page.url();
  await externalLink.click();
  await expect(page.locator('[data-testid="repo-file-markdown"]')).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  // A same-page `#anchor` link scrolls to its heading instead of being swallowed outright.
  const sectionHeading = markdown.locator('h2', { hasText: 'Section two' });
  const before = await sectionHeading.evaluate((el) => el.getBoundingClientRect().top);
  await markdown.getByRole('link', { name: 'same-page link' }).click();
  await expect
    .poll(() => sectionHeading.evaluate((el) => el.getBoundingClientRect().top))
    .not.toBe(before);
  expect(page.url()).toBe(urlBefore);
});

test('a repo workspace: a non-markdown file gets no reading toggle at all', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: { paths: ['a.ts'], status: {}, truncated: false },
      },
      readFileSnap('a.ts', 'export const a = 1;\n'),
    ],
  });

  await openGitModule(page);
  await page.locator('[data-testid="repo-row"]').dblclick();
  await treeRow(page, 'a.ts').click();

  await expect(page.locator('[data-testid="repo-file-editor"]')).toBeVisible();
  await expect(page.locator('[data-testid="repo-file-view-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="repo-file-markdown"]')).toHaveCount(0);
});
