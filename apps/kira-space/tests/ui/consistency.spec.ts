import type { Page } from '@playwright/test';
import { defaultLayout } from '@shared/domain/layout';
import { expect, test } from './fixtures';
import { adeFixture, adeV2Control, emitLog, FIXED_NOW, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P266 Stream B: the Space consistency pass. Backend halves: adeflow TestStaleWorkflowSaveReportsCatalogText,
// migrate_ade_panel_width_test.go, appflow layout_test.go.

interface BoardFx {
  tasks: { id: string; est: string }[];
}

const t = (id: string) => `[data-testid="${id}"]`;

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  hidden: false,
};

const HIDDEN_REPO = { ...REPO, id: 'repo-hidden', name: 'hidden-repo', hidden: true };

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

async function openDiff(page: Page): Promise<void> {
  await page.locator(`${t('repo-row')}[data-repo-id="${REPO.id}"]`).click();
  await page.locator(t('git-panel-tab-files')).click();
  await page.locator('[data-testid="repo-tree-row"][data-path="c.ts"]').click({ button: 'right' });
  await page.locator(t('menu-item-open-changes')).click();
  await expect(page.locator(t('repo-diff-editor'))).toBeVisible();
}

test('the menu command palette event opens the palette with the Space commands', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await emitWailsEvent(page, IPC.commandPalette, undefined);
  await expect(page.locator(t('command-palette-input'))).toBeVisible();
  const items = page.locator(t('command-palette-item'));
  await expect(items.filter({ hasText: 'Open settings' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Show or hide repositories' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Go to next tab' })).toHaveCount(1);
});

test('the menu find event focuses the open diff find widget', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      {
        channel: IPC.codeWorkspaceListFiles,
        args: { id: REPO.id },
        response: { paths: ['c.ts'], status: { 'c.ts': 'M' }, truncated: false },
      },
      DIFF_SNAP,
    ],
  });
  await openDiff(page);
  await expect(page.locator('.monaco-diff-editor .monaco-editor').first()).toBeVisible();
  await expect(async () => {
    await emitWailsEvent(page, IPC.viewFind, undefined);
    await expect(page.locator('.monaco-editor .find-widget.visible').first()).toBeVisible({
      timeout: 500,
    });
  }).toPass();
});

test('Memory mode has no tab strip', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.windowsEnsure, response: { mode: 'memory' } }],
  });
  await expect(page.locator(t('memory-panel'))).toBeVisible();
  await expect(page.locator(t('tab-strip'))).toHaveCount(0);
});

test('the ADE panel width comes back from the stored layout', async ({ relaunch }) => {
  const layout = { ...defaultLayout, panel: { ...defaultLayout.panel, ade: { width: 520 } } };
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.layoutGetAll, response: layout },
  ]);
  await page.locator(`${t('ade-card')}[data-task-id="T_bill"] ${t('ade-card-head')}`).click();
  await expect(page.locator(t('ade-panel-resize-handle'))).toHaveAttribute('aria-valuenow', '520');
});

test('Appearance shows the font family field', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator(t('settings-section-Appearance')).click();
  await expect(page.locator(t('settings-font-family'))).toBeVisible();
  await expect(page.locator(t('font-preview'))).toBeVisible();
});

test('the Git front door and the ADE no-repos view render module-start', async ({ relaunch }) => {
  const git = await relaunch({
    control: [{ channel: IPC.windowsEnsure, response: { mode: 'git' } }],
  });
  await expect(git.window.locator(`${t('git-start')}[data-slot="module-start"]`)).toBeVisible();
  const ade = await relaunch({
    control: adeV2Control([
      { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
      { channel: IPC.codeWorkspaceListRepos, response: [] },
    ]),
  });
  await expect(ade.window.locator(`${t('ade-view')} [data-slot="module-start"]`)).toBeVisible();
});

test('the Git panel empty state has no button', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.codeWorkspaceListRepos, response: [HIDDEN_REPO] }],
  });
  const empty = page.locator(t('repos-all-hidden'));
  await expect(empty).toHaveAttribute('data-slot', 'empty-state');
  await expect(empty.locator('button')).toHaveCount(0);
});

test('the estimate unit is a secondary tabs control', async ({ relaunch }) => {
  const board = adeFixture<BoardFx>('board');
  const target = board.tasks.find((x) => x.id === 'T_notif');
  if (target) target.est = '';
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await page.locator(`${t('ade-card')}[data-task-id="T_notif"] ${t('ade-card-head')}`).click();
  await expect(
    page.locator(t('ade-panel')).locator('[data-slot="secondary-tabs"]', {
      has: page.locator(t('ade-estimate-unit-d')),
    }),
  ).toBeVisible();
});

test('a 5000-line run log renders a window of rows and follows the tail', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(`${t('ade-card')}[data-task-id="T_bill"] ${t('ade-card-head')}`).click();
  const line = page
    .locator(`${t('ade-stage-block')}[data-stage-id="impl"]`)
    .locator(`${t('ade-run-line')}[data-branch-id="b_bill"]`);
  await line.locator(t('ade-run-log-toggle')).click();
  const log = page.locator(t('ade-run-log'));
  await expect(log).toBeVisible();
  await emitLog(
    page,
    'run',
    'r_T_bill_impl_b_bill',
    Array.from({ length: 5000 }, (_, i) => ({
      seq: 1000 + i,
      at: 1790067600000 + i,
      stream: 'event',
      text: `line ${i}`,
    })),
  );
  await expect(log).toContainText('line 4999');
  expect(await log.locator(t('ade-run-log-line')).count()).toBeLessThanOrEqual(80);
});

test('a stale workflow save shows the same text the backend answers with', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskSaveWorkflow,
      error: { code: 'E_CONFLICT', message: 'The workflow changed. Refresh and retry.' },
    },
  ]);
  await page.locator(t('ade-tab-workflows')).click();
  await page.locator(t('ade-workflows')).waitFor();
  await page.locator(t('ade-wf-form-name')).fill('Renamed');
  await page.locator(t('ade-wf-save')).click();
  await expect(page.locator(t('ade-wf-save-error'))).toContainText(
    'The workflow changed. Refresh and retry.',
  );
});

test('a repo colour swatch tooltip names the colour', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: adeV2Control([{ channel: IPC.windowsEnsure, response: { mode: 'git' } }]),
  });
  await page.locator(t('manage-repos')).click();
  await page.locator(t('repos-dialog')).waitFor();
  await page.locator(`${t('repo-color')} ${t('color-blue')}`).hover({ force: true });
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Blue');
});

test('day band labels use the locale weekday names', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const tomorrow = new Date(FIXED_NOW + 24 * 60 * 60 * 1000);
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(
    tomorrow,
  );
  await expect(
    page.locator(`${t('ade-day-band')}[data-ade-day="1"] ${t('ade-band-label')}`),
  ).toContainText(`${weekday} ${tomorrow.getUTCDate()}`);
});
