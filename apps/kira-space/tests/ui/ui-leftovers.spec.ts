import type { Page } from '@playwright/test';
import { emitPrompts, routed } from '@workbench/testing/ui/prompts';
import { expect, test } from './fixtures';
import { FIXED_NOW, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P267 Stream B: unified primitives and behaviours in the ADE, the Repos panel and the status bar.

const t = (id: string) => `[data-testid="${id}"]`;

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

test('All sessions filter is the shared segmented secondary tabs', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-tab-needs')).click();
  await page.locator(t('ade-needs-all')).click();
  const tabs = page
    .locator('[data-slot="secondary-tabs"]')
    .filter({ has: page.locator(t('ade-all-running')) });
  await expect(tabs).toBeVisible();
  await expect(tabs.locator(t('ade-all-stopped'))).toBeVisible();
});

test('the notes toolbar toggles expose aria-pressed', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page
    .locator('[data-testid="ade-card"][data-task-id="T_notif"] [data-testid="ade-card-head"]')
    .click();
  await page.locator(t('ade-panel-tab-notes')).click();
  await page.locator(`${t('ade-notes-tab')} .ProseMirror`).click();
  const bold = page.locator(t('ade-notes-toolbar-btn')).first();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
});

interface SavedWorkflow {
  workflow: { stages: { id: string; steps: { id: string }[] }[] };
}

async function openWorkflows(relaunch: Parameters<typeof openPlan>[0]) {
  const app = await openPlan(relaunch);
  await app.window.locator(t('ade-tab-workflows')).click();
  await app.window.locator(t('ade-workflows')).waitFor();
  return app;
}

test('workflow graph: Delete removes the selected step, but edits text inside a field', async ({
  relaunch,
}) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const step = page.locator(`${t('ade-wf-node')}[data-step-id="plan"]`);
  await step.click();

  await page.locator(t('ade-wf-step-tools')).fill('Read, Grep');
  await page.locator(t('ade-wf-step-tools')).press('Delete');
  await expect(page.locator(t('confirm-dialog-confirm'))).toHaveCount(0);
  await expect(step).toBeVisible();

  await step.click();
  await step.press('Delete');
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect(step).toHaveCount(0);
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const saved = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as SavedWorkflow;
  expect(saved.workflow.stages.flatMap((s) => s.steps.map((x) => x.id))).not.toContain('plan');
});

test('the review code event opens the review; a window keydown does not', async ({ relaunch }) => {
  const OPEN: ControlSnapshot = { channel: IPC.adeTaskOpenReviewWindow, response: true };
  const { window: page, control } = await openPlan(relaunch, [OPEN]);
  await page
    .locator('[data-testid="ade-card"][data-task-id="T_deps"] [data-testid="ade-card-head"]')
    .click();
  await page.keyboard.press('Control+Shift+R');
  await page.keyboard.press('Meta+Shift+R');
  expect(calls(control, IPC.adeTaskOpenReviewWindow)).toHaveLength(0);

  await emitWailsEvent(page, IPC.reviewCode, null);
  await expect.poll(() => calls(control, IPC.adeTaskOpenReviewWindow)).toHaveLength(1);
});

test('the Claude usage status item is one control-sm row high', async ({ relaunch }) => {
  const HOUR = 3_600_000;
  const snap = {
    state: 'ok',
    source: 'session',
    fiveHour: { usedPercent: 23, resetsAt: FIXED_NOW + 2 * HOUR },
    sevenDay: { usedPercent: 41, resetsAt: FIXED_NOW + 50 * HOUR },
    updatedAt: FIXED_NOW - 5 * 60_000,
    detail: '',
  };
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.claudeUsageGet, response: snap },
  ]);
  const box = await page.locator(t('claude-usage-status')).boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(22);
});

test('an outside click keeps a dirty git credential dialog open', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [{ channel: IPC.gitCredentialProvide, response: true }],
  });
  const prompt = {
    requestId: 'req-1',
    source: 'ADE board',
    repoLabel: 'demo-repo',
    prompt: "Password for 'https://example.com':",
    masked: true,
  };
  await emitWailsEvent(window, IPC.gitCredential, [prompt]);
  await emitPrompts(window, [routed('git-credential', 'req-1')]);
  const dialog = window.locator(t('git-credential-dialog'));
  await expect(dialog).toBeVisible();

  await window.mouse.click(2, 2);
  await expect(dialog).toBeVisible();

  await window.fill(t('git-credential-input'), 'hunter2');
  await window.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
});

// Repos panel fixtures, as list-keyboard.spec.ts.
const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const README = [
  '# Top',
  '',
  '[jump](#bottom)',
  '',
  ...Array.from({ length: 80 }, (_, i) => `Paragraph ${i}\n`),
  '## Bottom',
  '',
  'The end.',
  '',
].join('\n');

function readFile(path: string, text: string, language: string): ControlSnapshot {
  return {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path },
    response: {
      kind: 'found',
      text,
      bytes: text.length,
      limitBytes: 8 * 1024 * 1024,
      language,
    },
  };
}

const REPO_CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  {
    channel: IPC.codeWorkspaceListFiles,
    args: { id: REPO.id },
    response: { paths: ['README.md', 'dir/b.ts'], status: {}, truncated: false },
  },
  readFile('README.md', README, 'markdown'),
  readFile('dir/b.ts', 'export const b = 1;\n', 'typescript'),
];

async function openFiles(page: Page): Promise<void> {
  await page.locator('[data-testid="repo-row"][data-repo-id="repo-1"]').click();
  await page.locator(t('git-panel-tab-files')).click();
}

test('F2 on a repo row starts the inline rename', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: REPO_CONTROL });
  const row = page.locator('[data-testid="repo-row"][data-repo-id="repo-1"]');
  await row.focus();
  await page.keyboard.press('F2');
  const input = page.locator(t('repo-rename-input'));
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});

test('file tree folder expansion survives a reload', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: REPO_CONTROL });
  await openFiles(page);
  const row = (path: string) => page.locator(`[data-testid="repo-tree-row"][data-path="${path}"]`);
  await row('dir').click();
  if (!(await row('dir/b.ts').isVisible())) await page.keyboard.press('ArrowRight');
  await expect(row('dir/b.ts')).toBeVisible();
  await page.waitForTimeout(500);

  await page.reload();
  await openFiles(page);
  await expect(row('dir/b.ts')).toBeVisible();
});

test('a markdown heading link scrolls its target to the pane top', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: REPO_CONTROL });
  await openFiles(page);
  await page.locator('[data-testid="repo-tree-row"][data-path="README.md"]').click();
  await page.locator(t('repo-file-view-reading')).click();
  const pane = page.locator(t('repo-file-markdown'));
  await expect(pane).toBeVisible();
  const heading = pane.locator('#bottom');
  await pane.locator('a[href="#bottom"]').click();
  await expect
    .poll(async () => {
      const top = (await pane.boundingBox())?.y ?? 0;
      const at = (await heading.boundingBox())?.y ?? Number.POSITIVE_INFINITY;
      return Math.abs(at - top);
    })
    .toBeLessThan(48);
});
