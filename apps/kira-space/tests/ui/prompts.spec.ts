import type { RoutedPrompt } from '@shared/domain/prompts';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { emitPrompts, routed } from './support/prompts';

// P246: the window shows the popup the Go router targeted at it, one at a time. The Go half is
// flows/promptflow; here the router's pushes are mocked.

const credential = (requestId: string) => ({
  requestId,
  source: 'ADE board',
  repoLabel: 'demo-repo',
  prompt: "Password for 'https://example.com':",
  masked: true,
});

// The router's credential entry (flows/gitflow TestCredentialRoutes, contract git-credential-route),
// with the request id of this spec and the window it targets named by this suite's key.
function credentialEntry(over: Partial<RoutedPrompt> = {}): RoutedPrompt {
  const entry = contract<RoutedPrompt>('git-credential-route', 'PromptsService.List#credential');
  return { ...entry, id: 'git-credential:req-1', ref: 'req-1', target: 'main', ...over };
}

const UPDATE = {
  channel: IPC.updateStatus,
  response: {
    updateAvailable: true,
    currentVersion: '1.2.0',
    latestVersion: '1.3.0',
    installLogPath: '/tmp/kira-space-update.log',
  },
} as const;

test('contract: a git credential shows only in the window the router targets', async ({ kira }) => {
  const { window } = kira;
  const dialog = window.locator('[data-testid="git-credential-dialog"]');
  await emitWailsEvent(window, IPC.gitCredential, [credential('req-1')]);

  await emitPrompts(window, [credentialEntry({ target: 'other-window' })]);
  await expect(dialog).toHaveCount(0);
  await emitPrompts(window, [credentialEntry()]);
  await expect(dialog).toBeVisible();
  await emitPrompts(window, []);
  await expect(dialog).toHaveCount(0);
});

test('Escape hides a prompt in this window; a reveal push brings it back', async ({ kira }) => {
  const { window, control } = kira;
  const dialog = window.locator('[data-testid="git-credential-dialog"]');
  await emitWailsEvent(window, IPC.gitCredential, [credential('req-1')]);
  await emitPrompts(window, [routed('git-credential', 'req-1')]);
  await expect(dialog).toBeVisible();

  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(control.log().some((e) => e.channel === IPC.gitCredentialProvide)).toBe(false);

  await emitWailsEvent(window, IPC.promptsReveal, { id: 'git-credential:req-1' });
  await expect(dialog).toBeVisible();
});

test('contract: the oldest prompt shows first with a count; a reveal push shows another', async ({
  relaunch,
}) => {
  const { window } = await relaunch({ control: [UPDATE] });
  const credentialDialog = window.locator('[data-testid="git-credential-dialog"]');
  const updateDialog = window.locator('[data-testid="update-dialog"]');
  await emitWailsEvent(window, IPC.gitCredential, [credential('req-1')]);
  await emitPrompts(window, [
    credentialEntry({ createdAt: 1 }),
    routed('update', '1.3.0', { createdAt: 2 }),
  ]);

  await expect(credentialDialog).toBeVisible();
  await expect(window.locator('[data-testid="git-credential-more"]')).toHaveText('1 more waiting');
  await expect(updateDialog).toHaveCount(0);

  await emitWailsEvent(window, IPC.promptsReveal, { id: 'update:1.3.0' });
  await expect(updateDialog).toBeVisible();
  await expect(credentialDialog).toHaveCount(0);
});

test('Send test notification calls the bound method', async ({ kira }) => {
  const { window, control } = kira;
  await emitWailsEvent(window, IPC.openSettings, undefined);
  await window.locator('[data-testid="settings-section-Advanced"]').click();
  await expect(window.locator('[data-testid="settings-notify-prompts"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await window.locator('[data-testid="settings-notify-prompts-test"]').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.promptsSendTest)).toBe(true);
});
