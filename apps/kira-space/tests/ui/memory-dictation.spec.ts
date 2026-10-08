import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installDictationStreamMock } from './support/dictationStreamMock';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P216: memory dictation against a mocked bridge and a mocked `dictation` stream — the mic button
// states, live text, caret insertion, stop, error lines. No microphone or model involved.

const MB = 1024 * 1024;

function status(state: string, over: Record<string, unknown> = {}): ControlSnapshot {
  return {
    channel: IPC.dictationStatus,
    response: { state, message: '', done: 0, total: 0, ...over },
  };
}

const BASE: ControlSnapshot[] = [{ channel: IPC.memoryRecent, response: [] }];

function modeTab(page: Page) {
  return page.locator('[data-testid="mode-tab"][data-mode="memory"]');
}

async function openMemory(page: Page): Promise<void> {
  await modeTab(page).click();
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();
}

async function openAdd(page: Page) {
  await page.locator('[data-testid="memory-add"]').click();
  const dialog = page.locator('[data-testid="add-memory-dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('status off hides the mic button', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [...BASE, status('off')] });
  await openMemory(page);
  const dialog = await openAdd(page);
  await expect(dialog.locator('[data-testid="add-memory-text"]')).toBeVisible();
  await expect(page.locator('[data-testid^="dictation-mic-"]')).toHaveCount(0);
});

test('not installed: prompt names the size; a failed download offers retry', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      ...BASE,
      status('notInstalled'),
      {
        channel: IPC.dictationInstall,
        error: { code: 'checksum', message: 'model: checksum mismatch' },
      },
    ],
  });
  await openMemory(page);
  await openAdd(page);
  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect(page.locator('[data-testid="dictation-popover"]')).toContainText('182 MB');
  await page.locator('[data-testid="dictation-download"]').click();
  await expect(page.locator('[data-testid="dictation-error"]')).toContainText('checksum');
  await expect(page.locator('[data-testid="dictation-download"]')).toHaveText('Retry download');
});

test('downloading shows progress and a cancel button', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [...BASE, status('downloading', { done: 95 * MB, total: 182 * MB })],
  });
  await openMemory(page);
  await openAdd(page);
  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect(page.locator('[data-testid="dictation-progress-label"]')).toContainText(
    '95 / 182 MB',
  );
  await expect(page.locator('[data-testid="dictation-cancel-download"]')).toBeVisible();
});

test('unavailable shows the reason and a retry', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      ...BASE,
      status('unavailable', { message: 'worker exited' }),
      { channel: IPC.dictationRetry, response: undefined },
    ],
  });
  await openMemory(page);
  await openAdd(page);
  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect(page.locator('[data-testid="dictation-unavailable"]')).toContainText(
    'worker exited',
  );
  await page.locator('[data-testid="dictation-retry"]').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.dictationRetry)).toBe(true);
});

test('listening: live text fills the textarea; Add is never auto-clicked', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: [...BASE, status('ready')] });
  const stream = await installDictationStreamMock(page);
  await openMemory(page);
  const dialog = await openAdd(page);
  const text = dialog.locator('[data-testid="add-memory-text"]');
  const submit = dialog.locator('[data-testid="add-memory-submit"]');
  await expect(submit).toBeDisabled();

  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect.poll(() => stream.opened()).toBe(1);
  await stream.emit({ type: 'state', state: 'listening', level: 0.3 });
  await expect(page.locator('[data-testid="dictation-status-add-memory"]')).toHaveText('Listening');
  await expect(page.locator('[data-testid="dictation-pulse"]')).toBeVisible();

  await stream.emit({ type: 'text', text: 'the billing api', committed: 0 });
  await expect(text).toHaveValue('the billing api');
  await stream.emit({ type: 'text', text: 'the billing api uses port 9090', committed: 3 });
  await expect(text).toHaveValue('the billing api uses port 9090');
  await expect(submit).toBeEnabled();
  expect(control.log().filter((e) => e.channel === IPC.memoryStore)).toHaveLength(0);
});

test('text lands at the caret between existing text; stop sends the stop frame', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: [...BASE, status('ready')] });
  const stream = await installDictationStreamMock(page);
  await openMemory(page);
  const dialog = await openAdd(page);
  const text = dialog.locator('[data-testid="add-memory-text"]');
  await text.fill('Start End');
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));

  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect.poll(() => stream.opened()).toBe(1);
  await stream.emit({ type: 'state', state: 'listening', level: 0 });
  await stream.emit({ type: 'text', text: 'middle', committed: 0 });
  await expect(text).toHaveValue('Start middle End');

  await page.locator('[data-testid="dictation-mic-add-memory"]').click();
  await expect.poll(() => stream.sent()).toContainEqual({ type: 'stop' });
  await stream.emit({ type: 'final', text: 'middle part' });
  await stream.closeFromServer();
  await expect(text).toHaveValue('Start middle part End');
  await expect(page.locator('[data-testid="dictation-status-add-memory"]')).toHaveText('');
  expect(control.log().filter((e) => e.channel === IPC.memoryStore)).toHaveLength(0);
});

test('busy and mic errors show in the status line', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [...BASE, status('ready')] });
  const stream = await installDictationStreamMock(page);
  await openMemory(page);
  await openAdd(page);
  const line = page.locator('[data-testid="dictation-status-add-memory"]');
  const mic = page.locator('[data-testid="dictation-mic-add-memory"]');

  await mic.click();
  await expect.poll(() => stream.opened()).toBe(1);
  await stream.emit({ type: 'error', code: 'busy', message: 'busy', text: '' });
  await expect(line).toContainText('already running');
  await stream.closeFromServer();

  await mic.click();
  await expect.poll(() => stream.opened()).toBe(2);
  await stream.emit({
    type: 'error',
    code: 'mic',
    message: 'Microphone access is denied.',
    text: '',
  });
  await expect(line).toContainText('Microphone access is denied.');
});

test('search box gets live text and the results refetch with the dictated query', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [...BASE, status('ready'), { channel: IPC.memorySearch, response: [] }],
  });
  const stream = await installDictationStreamMock(page);
  await openMemory(page);
  await page.locator('[data-testid="dictation-mic-memory-search"]').click();
  await expect.poll(() => stream.opened()).toBe(1);
  await stream.emit({ type: 'state', state: 'listening', level: 0 });
  await stream.emit({ type: 'text', text: 'billing port', committed: 0 });
  await expect(page.locator('[data-testid="memory-search"]')).toHaveValue('billing port');
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.memorySearch &&
            (e.args as { query?: string } | undefined)?.query === 'billing port',
        ),
    )
    .toBe(true);
});

test('a dictation event refreshes the status', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [...BASE, status('ready')] });
  await openMemory(page);
  await emitWailsEvent(page, IPC.memoryDictation, null);
  await expect(page.locator('[data-testid="dictation-mic-memory-search"]')).toBeVisible();
});
