import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P221: memory setup (Claude Code registration, semantic model download) lives in
// Settings > Memory, against a mocked bridge.

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

// Contract memory-settings. Backend half: memoryflow TestConnectClaudeCode, TestSemanticNotInstalled
// and TestInstallSemanticModelCancelled.
test('contract: Connect Claude Code shows the registration command', async ({ relaunch }) => {
  const status = contract<{ command: string }>('memory-settings', 'MemoryService.McpStatus');
  const installed = contract<{ outcome: string }>(
    'memory-settings',
    'MemoryService.InstallClaudeCode',
  );
  expect(installed.outcome).toBe('installed');
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.memoryMcpStatus, response: status },
      { channel: IPC.memoryMcpInstall, response: installed },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="memory-mcp-command"]')).toContainText('kira-memory');
  await page.locator('[data-testid="memory-mcp-install"]').click();
  await expect(page.locator('[data-testid="memory-mcp-install-outcome"]')).toContainText(
    'Registered',
  );
});

for (const key of ['not-installed', 'cancelled'] as const) {
  test(`contract: semantic ${key}: download logs the install`, async ({ relaunch }) => {
    const status = contract<{ state: string }>(
      'memory-settings',
      `MemoryService.SemanticStatus#${key}`,
    );
    expect(status.state).toBe('notInstalled');
    const { window: page, control } = await relaunch({
      control: [
        { channel: IPC.memorySemanticStatus, response: status },
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
}

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
