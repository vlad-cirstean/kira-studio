import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// The CLI tools settings pane. Contract space-cli-tools; backend half: appflow TestCliTools.

const t = (id: string) => `[data-testid="${id}"]`;
const tools = (key: string) => contract('space-cli-tools', `IssueTrackerService.Tools#${key}`);

async function openPane(
  relaunch: (o: { control: ControlSnapshot[] }) => Promise<{
    window: Page;
    control: { log(): { channel: string; args?: unknown }[] };
  }>,
  control: ControlSnapshot[],
) {
  const { window: page, control: handle } = await relaunch({ control });
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator(t('settings-dialog')).waitFor();
  await page.locator(t('settings-section-CLI tools')).click();
  return { page, handle };
}

test('contract: both tools show their live state and setup commands', async ({ relaunch }) => {
  const { page, handle } = await openPane(relaunch, [
    { channel: IPC.cliTools, response: tools('not-installed') },
  ]);
  await expect(page.locator(t('cli-tool-status-github'))).toHaveText('Ready');
  await expect(page.locator(t('cli-tool-status-jira'))).toHaveText('Not installed');
  await expect(page.locator(t('cli-tool-reason-jira'))).toContainText('acli is not installed');
  const steps = page.locator(t('cli-tool-steps-jira'));
  await expect(steps).toContainText('brew tap atlassian/homebrew-acli && brew install acli');
  await expect(steps).toContainText('acli jira auth login --web');
  await expect(page.locator(t('cli-tool-steps-github'))).toContainText('gh auth login');
  await expect(page.locator(t('cli-tool-details-github'))).toContainText('octocat');
  expect(calls(handle, IPC.cliTools)[0]?.args).toEqual({ refresh: false });
});

test('contract: a signed-out tracker reads Not signed in', async ({ relaunch }) => {
  const { page } = await openPane(relaunch, [
    { channel: IPC.cliTools, response: tools('signed-out') },
  ]);
  await expect(page.locator(t('cli-tool-status-jira'))).toHaveText('Not signed in');
  await expect(page.locator(t('cli-tool-reason-jira'))).toContainText('acli jira auth login');
});

test('contract: Check again asks for a fresh probe', async ({ relaunch }) => {
  const { page, handle } = await openPane(relaunch, [
    { channel: IPC.cliTools, response: tools('not-installed') },
  ]);
  await expect(page.locator(t('cli-tool-status-jira'))).toHaveText('Not installed');
  await page.locator(t('cli-tools-refresh')).click();
  await expect.poll(() => calls(handle, IPC.cliTools).length).toBeGreaterThan(1);
  expect(calls(handle, IPC.cliTools).at(-1)?.args).toEqual({ refresh: true });
});

test('contract: the docs button opens the CLI documentation', async ({ relaunch }) => {
  const { page, handle } = await openPane(relaunch, [
    { channel: IPC.cliTools, response: tools('ready') },
  ]);
  await page.locator(t('cli-tool-docs-jira')).click();
  await expect.poll(() => calls(handle, IPC.linkOpenExternal)).toHaveLength(1);
  expect(JSON.stringify(calls(handle, IPC.linkOpenExternal)[0]?.args)).toContain(
    'developer.atlassian.com',
  );
});
