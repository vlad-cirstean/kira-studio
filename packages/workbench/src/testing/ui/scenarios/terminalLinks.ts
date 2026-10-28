import { expect, type Page } from '@playwright/test';
import { type ControlSnapshot, emitWailsEvent } from '../mockRuntime';
import type { ScenarioEnv } from './env';

type Env = ScenarioEnv<'linkOpenExternal' | 'terminal' | 'terminalOpen'>;

export interface Options {
  extraBase: readonly ControlSnapshot[];
  /** Opens a new terminal tab and leaves it active. */
  openTerminal: (page: Page) => Promise<void>;
}

// Cmd/Ctrl-click opens a terminal link through LinkService.OpenExternal. Backend half: appflow
// TestTerminalLinkOpen, whose contract terminal-link is the call these specs expect.
// The UI harness runs a macOS user agent, so the primary modifier is Meta.
export function registerTerminalLinkScenarios(env: Env, options: Options): void {
  const { test, contract, ipc: IPC } = env;
  const { url } = contract<{ url: string }>('terminal-link', 'args:LinkService.OpenExternal');

  const BASE: ControlSnapshot[] = [
    ...options.extraBase,
    { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
    { channel: IPC.linkOpenExternal, response: null },
  ];

  async function printLine(page: Page, line: string): Promise<void> {
    await options.openTerminal(page);
    await expect(page.locator('.xterm-rows')).toBeVisible();
    const terminalId = await page
      .locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"][data-active="true"]')
      .getAttribute('data-tab-id');
    expect(terminalId).not.toBeNull();
    await emitWailsEvent(page, IPC.terminal, {
      terminalId,
      data: Buffer.from(line).toString('base64'),
      exited: false,
    });
  }

  const opened = (control: { log(): { channel: string; args?: unknown }[] }) =>
    control.log().filter((e) => e.channel === IPC.linkOpenExternal);
  const hint = (page: Page) => page.locator('[data-testid="terminal-link-hint"]');

  test('contract: plain-text link opens only on Cmd/Ctrl-click, with a hover hint', async ({
    relaunch,
  }) => {
    const { window: page, control } = await relaunch({ control: BASE });
    await printLine(page, `${url}\r\n`);
    const row = page.locator('.xterm-rows > div', { hasText: url });
    await expect(row).toBeVisible();

    await row.hover({ position: { x: 20, y: 6 }, force: true });
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toContainText(url);
    await expect(hint(page)).toContainText('-click to open');

    await row.click({ position: { x: 20, y: 6 }, force: true });
    await row.click({ position: { x: 20, y: 6 }, modifiers: ['Meta'], force: true });
    await expect.poll(() => opened(control)).toHaveLength(1);
    expect(opened(control)[0]?.args).toEqual({ url });
    await page.locator('.xterm-rows').hover({ position: { x: 300, y: 200 }, force: true });
    await expect(hint(page)).toBeHidden();
  });

  test('contract: OSC 8 hyperlink opens its target on Cmd/Ctrl-click', async ({ relaunch }) => {
    const { window: page, control } = await relaunch({ control: BASE });
    await printLine(page, `\x1b]8;;${url}\x07open PR\x1b]8;;\x07\r\n`);
    const row = page.locator('.xterm-rows > div', { hasText: 'open PR' });
    await expect(row).toBeVisible();

    await row.hover({ position: { x: 20, y: 6 }, force: true });
    await expect(hint(page)).toContainText(url);

    await row.click({ position: { x: 20, y: 6 }, modifiers: ['Meta'], force: true });
    await expect.poll(() => opened(control)).toHaveLength(1);
    expect(opened(control)[0]?.args).toEqual({ url });
  });
}
