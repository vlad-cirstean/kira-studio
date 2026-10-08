import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P221: memory setup (Claude Code registration, semantic and speech model downloads) lives in
// Settings > Memory, against a mocked bridge.

const MB = 1024 * 1024;

function dictation(state: string, over: Record<string, unknown> = {}): ControlSnapshot {
  return {
    channel: IPC.dictationStatus,
    response: { state, message: '', done: 0, total: 0, ...over },
  };
}

function semantic(state: string, over: Record<string, unknown> = {}): ControlSnapshot {
  return {
    channel: IPC.memorySemanticStatus,
    response: { state, message: '', model: '', done: 0, total: 0, ...over },
  };
}

async function openMemorySettings(page: Page): Promise<void> {
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Memory"]').click();
}

test('Connect Claude Code shows the registration command', async ({ relaunch }) => {
  const command =
    "claude mcp remove --scope user 'kira-memory' 2>/dev/null; claude mcp add-json --scope user 'kira-memory' '{}'";
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.memoryMcpStatus,
        response: {
          command,
          executable: '/Applications/Kira Space',
          claudeAvailable: true,
          probed: [],
        },
      },
      {
        channel: IPC.memoryMcpInstall,
        response: { outcome: 'installed', detail: '', probed: [] },
      },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="memory-mcp-command"]')).toContainText('kira-memory');
  await page.locator('[data-testid="memory-mcp-install"]').click();
  await expect(page.locator('[data-testid="memory-mcp-install-outcome"]')).toContainText(
    'Registered',
  );
});

test('semantic not installed: download logs the install', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      semantic('notInstalled'),
      { channel: IPC.memorySemanticInstall, response: undefined },
    ],
  });
  await openMemorySettings(page);
  const download = page.locator('[data-testid="memory-semantic-download"]');
  await expect(download).toContainText('35 MB');
  await download.click();
  await expect
    .poll(() => control.log().some((e) => e.channel === IPC.memorySemanticInstall))
    .toBe(true);
});

test('semantic unavailable: shows the reason and a retry', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      semantic('unavailable', { message: 'model corrupt' }),
      { channel: IPC.memorySemanticRetry, response: undefined },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="memory-semantic-error"]')).toContainText(
    'model corrupt',
  );
  await page.locator('[data-testid="memory-semantic-retry"]').click();
  await expect
    .poll(() => control.log().some((e) => e.channel === IPC.memorySemanticRetry))
    .toBe(true);
});

test('dictation not installed: prompt names the size; a failed download offers retry', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      dictation('notInstalled'),
      {
        channel: IPC.dictationInstall,
        error: { code: 'checksum', message: 'model: checksum mismatch' },
      },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="dictation-section"]')).toContainText('182 MB');
  await page.locator('[data-testid="dictation-download"]').click();
  await expect(page.locator('[data-testid="dictation-error"]')).toContainText('checksum');
  await expect(page.locator('[data-testid="dictation-download"]')).toHaveText('Retry download');
});

test('dictation downloading shows progress and a cancel button', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [dictation('downloading', { done: 95 * MB, total: 182 * MB })],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="dictation-progress-label"]')).toContainText(
    '95 / 182 MB',
  );
  await expect(page.locator('[data-testid="dictation-cancel-download"]')).toBeVisible();
});

test('dictation unavailable shows the reason and a retry', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      dictation('unavailable', { message: 'worker exited' }),
      { channel: IPC.dictationRetry, response: undefined },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="dictation-unavailable"]')).toContainText(
    'worker exited',
  );
  await page.locator('[data-testid="dictation-retry"]').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.dictationRetry)).toBe(true);
});
