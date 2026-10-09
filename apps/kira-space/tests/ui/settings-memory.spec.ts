import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P221/P233: memory setup (Claude Code status, legacy registration cleanup, semantic model
// download) lives in Settings > Memory, against a mocked bridge.

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

const mcpStatus: ControlSnapshot = {
  channel: IPC.memoryMcpStatus,
  response: {
    executable: '/Applications/Kira Space',
    claudeAvailable: true,
    claudePath: '/usr/local/bin/claude',
    probed: [],
  },
};

test('Claude Code section is status only', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [mcpStatus] });
  await openMemorySettings(page);
  const section = page.locator('[data-testid="memory-mcp-section"]');
  await expect(section).toContainText('does not change your Claude Code configuration');
  await expect(page.locator('[data-testid="memory-mcp-cli"]')).toContainText(
    '/usr/local/bin/claude',
  );
  await expect(section.locator('button')).toHaveCount(0);
  await expect(page.locator('[data-testid="legacy-claude-section"]')).toHaveCount(0);
});

test('legacy registrations are listed and removed only after confirming', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      mcpStatus,
      {
        channel: IPC.memoryClaudeLegacy,
        response: {
          file: '/home/u/.claude.json',
          entries: [{ name: 'kira-memory', summary: '/Applications/Kira Space memory-mcp' }],
        },
      },
      {
        channel: IPC.memoryRemoveClaudeLegacy,
        response: {
          outcome: 'removed',
          removed: ['kira-memory'],
          remaining: [],
          backupPath: '/home/u/.kira-space/claude-config-backups/claude.json.1',
          detail: '',
          commands: [],
        },
      },
    ],
  });
  await openMemorySettings(page);
  await expect(page.locator('[data-testid="legacy-claude-entries"]')).toContainText('kira-memory');
  await page.locator('[data-testid="legacy-claude-remove"]').click();
  await expect(page.locator('[data-testid="legacy-claude-dialog"]')).toContainText(
    '/home/u/.claude.json',
  );
  expect(control.log().some((e) => e.channel === IPC.memoryRemoveClaudeLegacy)).toBe(false);
  await page.locator('[data-testid="legacy-claude-confirm"]').click();
  await expect(page.locator('[data-testid="legacy-claude-outcome"]')).toContainText(
    'claude.json.1',
  );
});

test('legacy cleanup without the CLI shows the commands to run', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      mcpStatus,
      {
        channel: IPC.memoryClaudeLegacy,
        response: {
          file: '/home/u/.claude.json',
          entries: [{ name: 'kira-db', summary: 'http://127.0.0.1:8766/mcp' }],
        },
      },
      {
        channel: IPC.memoryRemoveClaudeLegacy,
        response: {
          outcome: 'notFound',
          removed: [],
          remaining: [],
          backupPath: '',
          detail: '',
          commands: ["claude mcp remove --scope user 'kira-db'"],
        },
      },
    ],
  });
  await openMemorySettings(page);
  await page.locator('[data-testid="legacy-claude-remove"]').click();
  await page.locator('[data-testid="legacy-claude-confirm"]').click();
  await expect(page.locator('[data-testid="legacy-claude-commands"]')).toContainText(
    "claude mcp remove --scope user 'kira-db'",
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
