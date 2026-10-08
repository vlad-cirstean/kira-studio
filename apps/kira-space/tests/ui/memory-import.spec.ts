import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// P211: bulk memory import against a mocked bridge — pick, scan confirmation with the estimate,
// Start, then the imports view for a paused job with a done, a failed and a skipped file.

function job(over: Record<string, unknown>) {
  return {
    id: 'J1',
    roots: ['/docs'],
    base: '/docs',
    state: 'awaiting',
    reason: '',
    truncated: false,
    ignoredCount: 2,
    estimate: { files: 3, chunks: 5, tokens: 9000, calls: 8, seconds: 150 },
    progress: { filesDone: 0, filesTotal: 3, chunksDone: 0, chunksTotal: 5 },
    totals: { added: 0, updated: 0, noop: 0, unresolved: 0, failedFiles: 0, skippedFiles: 1 },
    calls: 0,
    costUsd: 0,
    createdAt: '2026-03-01T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

function file(over: Record<string, unknown>) {
  return {
    id: 'f1',
    relPath: 'billing.md',
    kind: 'markdown',
    size: 1200,
    state: 'done',
    reason: '',
    title: 'Billing',
    chunkCount: 2,
    chunksDone: 2,
    factCount: 4,
    added: 3,
    updated: 1,
    noop: 0,
    unresolved: [],
    dropped: [],
    costUsd: 0.01,
    ...over,
  };
}

const PAUSED = job({
  id: 'J2',
  state: 'paused',
  reason: 'Claude usage limit reached. Resume after the limit resets.',
  progress: { filesDone: 1, filesTotal: 3, chunksDone: 2, chunksTotal: 5 },
  totals: { added: 3, updated: 1, noop: 0, unresolved: 0, failedFiles: 1, skippedFiles: 1 },
});

const PAUSED_DETAIL = {
  job: PAUSED,
  files: [
    file({}),
    file({
      id: 'f2',
      relPath: 'releases.md',
      state: 'failed',
      reason: 'Claude returned invalid output.',
      chunksDone: 0,
      added: 0,
      updated: 0,
    }),
    file({ id: 'f3', relPath: 'logo.txt', state: 'skipped', reason: 'empty', chunkCount: 0 }),
  ],
};

const SCANNED = job({});

const BASE: ControlSnapshot[] = [
  {
    channel: IPC.memoryImportChoose,
    args: { kind: 'folder' },
    response: { canceled: false, paths: ['/docs'] },
  },
  {
    channel: IPC.memoryImportCreate,
    args: { paths: ['/docs'] },
    response: job({ state: 'scanning' }),
  },
  { channel: IPC.memoryImportJob, args: { id: 'J1' }, response: { job: SCANNED, files: [] } },
  { channel: IPC.memoryImportStart },
  { channel: IPC.memoryImportJob, args: { id: 'J2' }, response: PAUSED_DETAIL },
  { channel: IPC.memoryImportResume },
  { channel: IPC.memoryImportRetryFile },
];

async function openMemory(page: Page): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="memory"]').click();
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();
}

test('import: pick a folder, confirm the estimate, start', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [...BASE, { channel: IPC.memoryImportJobs, response: [SCANNED] }],
  });
  await openMemory(page);

  await page.locator('[data-testid="memory-import"]').click();
  await page.locator('[data-testid="memory-import-folder"]').click();

  const dialog = page.locator('[data-testid="import-confirm-dialog"]');
  await expect(dialog.locator('[data-testid="import-estimate"]')).toContainText(
    '3 files, 5 chunks',
  );
  await expect(dialog.locator('[data-testid="import-estimate"]')).toContainText('8 Claude calls');

  await dialog.locator('[data-testid="import-confirm-start"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-testid="import-job"]')).toBeVisible();
  expect(control.log().filter((e) => e.channel === IPC.memoryImportStart)).toHaveLength(1);
});

test('import: a paused job shows its reason, per-file results, retry and resume', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [...BASE, { channel: IPC.memoryImportJobs, response: [PAUSED] }],
  });
  await openMemory(page);

  await expect(page.locator('[data-testid="memory-import-status"]')).toHaveAttribute(
    'data-state',
    'paused',
  );
  await page.locator('[data-testid="memory-import-open"]').click();

  await expect(page.locator('[data-testid="import-reason"]')).toContainText('usage limit');
  const files = page.locator('[data-testid="import-files"]');
  await expect(files.locator('[data-testid="import-file-billing.md"]')).toHaveAttribute(
    'data-state',
    'done',
  );
  await expect(files.locator('[data-testid="import-file-releases.md"]')).toHaveAttribute(
    'data-state',
    'failed',
  );
  await expect(files.locator('[data-testid="import-file-logo.txt"]')).toHaveAttribute(
    'data-state',
    'skipped',
  );

  await files.locator('[data-testid="import-file-releases.md"] button').first().click();
  await expect(page.locator('[data-testid="import-file-reason"]')).toContainText('invalid output');

  await files.locator('[data-testid="import-retry-file-releases.md"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.memoryImportRetryFile)?.args)
    .toMatchObject({ fileId: 'f2' });

  await page.locator('[data-testid="import-resume"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.memoryImportResume)?.args)
    .toMatchObject({ id: 'J2' });
});
