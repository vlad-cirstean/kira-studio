import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { emitPrompts, routed } from './support/prompts';

// P178: the ADE board's git credential prompt reaches Kira Space through
// the Go relay; the native dialog shows it, answers it, and closes when the relay withdraws it.

const prompt = {
  requestId: 'req-1',
  source: 'ADE board',
  repoLabel: 'demo-repo',
  prompt: "Password for 'https://example.com':",
  masked: true,
};

test('relay prompt shows its label and text; submit calls GitCredentialService.Provide', async ({
  relaunch,
}) => {
  const { window, control } = await relaunch({
    control: [{ channel: IPC.gitCredentialProvide, response: true }],
  });
  const dialog = window.locator('[data-testid="git-credential-dialog"]');
  await expect(dialog).toHaveCount(0);

  await emitWailsEvent(window, IPC.gitCredential, [prompt]);
  await emitPrompts(window, [routed('git-credential', 'req-1')]);
  await expect(dialog).toBeVisible();
  await expect(window.locator('[data-testid="git-credential-repo"]')).toHaveText(
    'ADE board · demo-repo',
  );
  await expect(window.locator('[data-testid="git-credential-prompt"]')).toHaveText(prompt.prompt);

  await window.fill('[data-testid="git-credential-input"]', 'hunter2');
  await window.click('[data-testid="git-credential-submit"]');

  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.gitCredentialProvide)?.args)
    .toEqual({ requestId: 'req-1', secret: 'hunter2' });
  await expect(dialog).toHaveCount(0);
});

test('an empty relay snapshot closes a stale dialog', async ({ kira }) => {
  const { window } = kira;
  const dialog = window.locator('[data-testid="git-credential-dialog"]');

  await emitWailsEvent(window, IPC.gitCredential, [prompt]);
  await emitPrompts(window, [routed('git-credential', 'req-1')]);
  await expect(dialog).toBeVisible();

  await emitWailsEvent(window, IPC.gitCredential, []);
  await emitPrompts(window, []);
  await expect(dialog).toHaveCount(0);
});
