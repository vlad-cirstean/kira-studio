import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab } from './support/apiMode';
import { IPC } from './support/ipcChannels';

// P91 §17.2: TERMINAL_OPEN_OK's shape uses control.log() polling rather than call-count
// assertions. The mocked DefaultCwd below is '/home/test' — mockRuntime.ts's own boot default
// (IPC.terminalDefaultCwd) — so an unscoped terminal's title falls out of its basename, 'test'
// (tabKinds.ts's terminal kind: `s.label || basename(s.cwd) || 'Terminal'`).
//
// QuickCommandsDialog.vue adds or edits one command; the panel header `+` is the only add control,
// a row's context menu "Edit…" the only edit entry.

const SCRIPT = {
  id: 'script-1',
  name: 'Dev server',
  command: 'npm run dev',
  workingDir: '/tmp/demo-repo/frontend',
  color: 'green',
  collection: '',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// terminalId is a client-generated UUID — no `args` here, relying on mockRuntime.ts's
// single-snapshot shortcut so any terminalOpen call resolves.
const TERMINAL_OPEN_OK: ControlSnapshot = {
  channel: IPC.terminalOpen,
  response: { shell: '/bin/zsh' },
};

function tab(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]');
}

function dialog(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="quick-commands-dialog"]');
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
  await expect(page.locator('[data-testid="quick-commands-add"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-command-empty-add"]')).toHaveCount(0);
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

  // Staying in the Terminal module's own workspace the whole time.
  await expect(modeTab(page, 'terminal')).toHaveClass(/is-active/);
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

test('the header + is the only add control and opens the dialog with the name focused', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.customScriptsList, response: [SCRIPT] }],
  });

  await openTerminalModule(page);
  await expect(page.locator('[data-testid="quick-command-empty-add"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="quick-commands-add"]')).toHaveCount(1);
  await page.locator('[data-testid="quick-commands-add"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-testid="custom-script-name"]')).toBeFocused();
});

test('a multiline script is saved as written with Cmd/Ctrl+Enter; the panel row shows its first line', async ({
  relaunch,
}) => {
  const MULTI = 'echo one\necho two';
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [{ ...SCRIPT, command: MULTI }] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });

  await openTerminalModule(page);
  const row = page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`);
  await expect(row).toContainText('echo one…');
  await expect(row).not.toContainText('echo two');
  await expect(row).toHaveAttribute('title', MULTI);

  await page.locator('[data-testid="quick-commands-add"]').click();
  await dialog(page).locator('[data-testid="custom-script-name"]').fill('Two lines');
  const script = dialog(page).locator('[data-testid="custom-script-command"]');
  await script.focus();
  await page.keyboard.type('echo one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('echo two');
  const box = await script.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(150);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(() => control.log().find((entry) => entry.channel === IPC.customScriptsCreate)?.args)
    .toEqual({
      fields: { name: 'Two lines', command: MULTI, workingDir: '', color: 'none', collection: '' },
    });
  await expect(dialog(page)).toHaveCount(0);
});

test('quick commands group under collapsible collections; titles align left', async ({
  relaunch,
}) => {
  const scripts = [
    { ...SCRIPT, id: 's-free', name: 'Loose', collection: '' },
    { ...SCRIPT, id: 's-a1', name: 'Build', collection: 'Backend' },
    { ...SCRIPT, id: 's-a2', name: 'Test', collection: 'Backend' },
    { ...SCRIPT, id: 's-b1', name: 'Serve', collection: 'Web' },
  ];
  const { window: page } = await relaunch({
    control: [{ channel: IPC.customScriptsList, response: scripts }],
  });

  await openTerminalModule(page);
  const list = page.locator('[data-testid="quick-command-list"]');
  await expect(page.locator('[data-testid="quick-command-group-Backend"]')).toContainText('2');
  await expect(page.locator('[data-testid="quick-command-group-Web"]')).toContainText('1');
  await expect(list.locator('[data-testid^="quick-command-"][type="button"]')).toHaveCount(4);

  const title = page.locator('[data-testid="quick-command-s-free"]');
  await expect(title).toHaveCSS('text-align', 'left');

  await page
    .locator('[data-testid="quick-command-group-Backend"] button:has-text("Backend")')
    .click();
  await expect(page.locator('[data-testid="quick-command-s-a1"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="quick-command-s-b1"]')).toBeVisible();
  await page
    .locator('[data-testid="quick-command-group-Backend"] button:has-text("Backend")')
    .click();
  await expect(page.locator('[data-testid="quick-command-s-a1"]')).toBeVisible();

  await page.locator('[data-testid="toggle-search"]').click();
  await page.locator('[data-testid="tree-search"]').fill('serve');
  await expect(page.locator('[data-testid="quick-command-group-Backend"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="quick-command-s-b1"]')).toBeVisible();
});

test('the dialog adds a quick command into a collection', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [{ ...SCRIPT, collection: 'Backend' }] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-add"]').click();
  await expect(dialog(page).locator('datalist#quick-command-collections option')).toHaveCount(1);
  await dialog(page).locator('[data-testid="custom-script-name"]').fill('Lint');
  await dialog(page).locator('[data-testid="custom-script-command"]').fill('bun run lint');
  await dialog(page).locator('[data-testid="custom-script-collection"]').fill('  Backend ');
  await dialog(page).locator('[data-testid="custom-script-save"]').click();
  await expect
    .poll(() => control.log().find((entry) => entry.channel === IPC.customScriptsCreate)?.args)
    .toEqual({
      fields: {
        name: 'Lint',
        command: 'bun run lint',
        workingDir: '',
        color: 'none',
        collection: 'Backend',
      },
    });
});

test('Add stays disabled until name and script are filled; it sends the trimmed fields', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-add"]').click();
  await expect(dialog(page)).toBeVisible();

  const save = dialog(page).locator('[data-testid="custom-script-save"]');
  await expect(save).toBeDisabled();

  await dialog(page).locator('[data-testid="custom-script-name"]').fill(`  ${SCRIPT.name}  `);
  await expect(save).toBeDisabled();

  await dialog(page).locator('[data-testid="custom-script-command"]').fill(`  ${SCRIPT.command}  `);
  await dialog(page).locator('[data-testid="custom-script-workingdir"]').fill(SCRIPT.workingDir);
  await dialog(page).locator('[data-testid="color-green"]').click();
  await expect(save).toBeEnabled();
  await save.click();

  await expect
    .poll(() => control.log().find((entry) => entry.channel === IPC.customScriptsCreate)?.args)
    .toEqual({
      fields: {
        name: SCRIPT.name,
        command: SCRIPT.command,
        workingDir: SCRIPT.workingDir,
        color: 'green',
        collection: '',
      },
    });
});

test('a rejected working directory keeps the dialog open and shows the backend error', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      {
        channel: IPC.customScriptsCreate,
        error: {
          code: 'E_BAD_REQUEST',
          message: 'quickcommands: working directory must be an absolute path',
        },
      },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-add"]').click();
  await dialog(page).locator('[data-testid="custom-script-name"]').fill(SCRIPT.name);
  await dialog(page).locator('[data-testid="custom-script-command"]').fill(SCRIPT.command);
  await dialog(page).locator('[data-testid="custom-script-workingdir"]').fill('relative/dir');
  await dialog(page).locator('[data-testid="custom-script-save"]').click();

  await expect(dialog(page).locator('[data-testid="custom-script-error"]')).toHaveText(
    'quickcommands: working directory must be an absolute path',
  );
  await expect(dialog(page)).toBeVisible();
});

test('Edit… opens the dialog filled in; Save sends every edited field in one update', async ({
  relaunch,
}) => {
  const editedName = `${SCRIPT.name} edited`;
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [SCRIPT] },
      { channel: IPC.customScriptsUpdate, response: { ...SCRIPT, name: editedName } },
    ],
  });

  await openTerminalModule(page);
  await page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-edit"]').click();
  await expect(dialog(page)).toBeVisible();

  const name = dialog(page).locator('[data-testid="custom-script-name"]');
  await expect(name).toHaveValue(SCRIPT.name);
  await expect(dialog(page).locator('[data-testid="custom-script-command"]')).toHaveValue(
    SCRIPT.command,
  );
  await expect(dialog(page).locator('[data-testid="custom-script-workingdir"]')).toHaveValue(
    SCRIPT.workingDir,
  );

  await name.fill(`  ${editedName}  `);
  await dialog(page).locator('[data-testid="color-blue"]').click();
  await dialog(page).locator('[data-testid="custom-script-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.customScriptsUpdate)?.args)
    .toEqual({
      id: SCRIPT.id,
      fields: {
        name: editedName,
        command: SCRIPT.command,
        workingDir: SCRIPT.workingDir,
        color: 'blue',
        collection: '',
      },
    });
});
