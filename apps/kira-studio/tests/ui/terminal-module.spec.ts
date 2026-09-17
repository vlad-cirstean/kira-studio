import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P91 §17.2: modelled on repo-workspace.spec.ts's terminal cases (TERMINAL_OPEN_OK's shape,
// control.log() polling rather than call-count assertions) and settings-scripts.spec.ts for the
// script fixtures. The mocked DefaultCwd below is '/home/test' — mockRuntime.ts's own boot
// default (IPC.terminalDefaultCwd) — so an unscoped terminal's title falls out of its basename,
// 'test' (tabKinds.ts's terminal kind: `s.label || basename(s.cwd) || 'Terminal'`).

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SCRIPT = {
  id: 'script-1',
  name: 'Dev server',
  command: 'npm run dev',
  workingDir: '/tmp/demo-repo/frontend',
  color: 'green',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// terminalId is a client-generated UUID (repo-workspace.spec.ts's own note, :1034) — no `args`
// here, relying on mockRuntime.ts's single-snapshot shortcut so any terminalOpen call resolves.
const TERMINAL_OPEN_OK: ControlSnapshot = {
  channel: IPC.terminalOpen,
  response: { shell: '/bin/zsh' },
};

function modeTab(page: import('@playwright/test').Page, mode: string) {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

function tab(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]');
}

async function openTerminalModule(page: import('@playwright/test').Page): Promise<void> {
  await modeTab(page, 'terminal').click();
  await expect(modeTab(page, 'terminal')).toHaveClass(/is-active/);
}

test('the module exists and opens', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });

  await expect(page.locator('[data-testid="mode-tab"]')).toHaveCount(4);
  await openTerminalModule(page);

  await expect(page.locator('[data-testid="terminal-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-command-empty-add"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-start"]')).toBeVisible();
});

test('an unscoped terminal opens from the tab strip at the resolved home directory', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: [TERMINAL_OPEN_OK] });

  await openTerminalModule(page);
  await page.locator('[data-testid="tab-strip-new"]').click();
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  // Terminal only — no repos configured in this test (§8.3: no Claude Code, no scripts here).
  await expect(menu.locator('[data-testid^="menu-item-"]')).toHaveCount(1);
  await menu.locator('[data-testid="menu-item-new-terminal"]').click();

  const terminalTab = tab(page);
  await expect(terminalTab).toHaveCount(1);
  // mockRuntime.ts's boot default for terminalDefaultCwd is '/home/test' — basename 'test'.
  await expect(terminalTab).toContainText('test');

  await expect(page.locator('.xterm-rows')).toBeVisible();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { cwd?: string; command?: string } | undefined)?.cwd === '/home/test' &&
            (e.args as { cwd?: string; command?: string } | undefined)?.command === '',
        ),
    )
    .toBe(true);

  // Staying in the Terminal module's own workspace the whole time — no side-trip into Git.
  await expect(modeTab(page, 'terminal')).toHaveClass(/is-active/);
});

test('a repo-scoped terminal opens at that repo root without leaving the Terminal module', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [TERMINAL_OPEN_OK, { channel: IPC.codeWorkspaceListRepos, response: [REPO] }],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="tab-strip-new"]').click();
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  // Terminal, then a separator, then one entry per known repo — REPO.id is already 'repo-1', so
  // the rendered testid is `menu-item-repo-repo-1`, not `menu-item-repo-1` (§17.2's own warning).
  const repoItem = menu.locator(`[data-testid="menu-item-repo-${REPO.id}"]`);
  await expect(repoItem).toBeVisible();
  await repoItem.click();

  const terminalTab = tab(page);
  await expect(terminalTab).toHaveCount(1);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { cwd?: string } | undefined)?.cwd === REPO.root,
        ),
    )
    .toBe(true);

  // §6's own regression to prevent: openRepoTerminalTab's openRepoWorkspace side effect must not
  // fire here — the active module stays Terminal, not Git/the repo workspace.
  await expect(modeTab(page, 'terminal')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'git')).not.toHaveClass(/is-active/);
});

test('one store, two surfaces: a quick command renders in the Terminal panel and a repo workspace’s own + menu', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [SCRIPT] },
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
    ],
  });

  await openTerminalModule(page);
  await expect(page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`)).toBeVisible();

  await modeTab(page, 'git').click();
  await page.locator(`[data-testid="repo-row"][data-repo-id="${REPO.id}"]`).click();
  await page.locator('[data-testid="tab-strip-new"]').click();
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  // TabStrip.vue's script row id is `script-${script.id}` — SCRIPT.id is already 'script-1', so
  // the rendered testid is `menu-item-script-script-1`.
  await expect(menu.locator(`[data-testid="menu-item-script-${SCRIPT.id}"]`)).toBeVisible();
});

test('running a quick command opens a terminal titled with its name, at its own working dir', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [TERMINAL_OPEN_OK, { channel: IPC.customScriptsList, response: [SCRIPT] }],
  });

  await openTerminalModule(page);
  await page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`).click();

  const terminalTab = tab(page);
  await expect(terminalTab).toHaveCount(1);
  await expect(terminalTab).toContainText(SCRIPT.name);

  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { cwd?: string; command?: string } | undefined)?.cwd === SCRIPT.workingDir &&
            (e.args as { cwd?: string; command?: string } | undefined)?.command === SCRIPT.command,
        ),
    )
    .toBe(true);
});

test('adding a quick command calls customScriptsCreate with the trimmed fields, and Add stays disabled while either field is empty', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-command-add"]').click();

  const addButton = page.locator('[data-testid="quick-command-add-confirm"]');
  await expect(addButton).toBeDisabled();

  await page.locator('[data-testid="quick-command-add-name"]').fill(`  ${SCRIPT.name}  `);
  await expect(addButton).toBeDisabled(); // command still empty

  await page.locator('[data-testid="quick-command-add-command"]').fill(`  ${SCRIPT.command}  `);
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.customScriptsCreate))
    .toBe(true);
  const call = control.log().find((entry) => entry.channel === IPC.customScriptsCreate);
  expect(call?.args).toEqual({
    fields: {
      name: SCRIPT.name,
      command: SCRIPT.command,
      workingDir: '',
      color: 'none',
    },
  });
});
