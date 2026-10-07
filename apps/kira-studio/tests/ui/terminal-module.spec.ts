import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab } from './support/apiMode';
import { IPC } from './support/ipcChannels';

// P91 §17.2: TERMINAL_OPEN_OK's shape uses control.log() polling rather than call-count
// assertions. The mocked DefaultCwd below is '/home/test' — mockRuntime.ts's own boot default
// (IPC.terminalDefaultCwd) — so an unscoped terminal's title falls out of its basename, 'test'
// (tabKinds.ts's terminal kind: `s.label || basename(s.cwd) || 'Terminal'`).
//
// P133 §5.1: the full script-editing coverage (create with all four fields, edit, blur-commit,
// empty/rejected reverts, colour) moved here from the deleted settings-scripts.spec.ts — Settings'
// own Scripts pane is gone, QuickCommandsDialog.vue is now the only place those rules run.

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

  await expect(page.locator('[data-testid="mode-tab"]')).toHaveCount(3);
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

test('one header button opens the dialog with the add form focused; the inline add row is gone', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.customScriptsList, response: [SCRIPT] }],
  });

  await openTerminalModule(page);
  await expect(page.locator('[data-testid="quick-command-add"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="quick-commands-manage"]')).toHaveCount(1);
  await page.locator('[data-testid="quick-commands-manage"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-testid="custom-script-add-name"]')).toBeFocused();
});

test('the empty-state button opens the same dialog', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.customScriptsList, response: [] }],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-command-empty-add"]').click();
  await expect(dialog(page)).toBeVisible();
});

test('a multiline command is saved as written; the panel row shows its first line', async ({
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

  await page.locator('[data-testid="quick-commands-manage"]').click();
  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill('Two lines');
  await dialog(page).locator('[data-testid="custom-script-add-command"]').fill(MULTI);
  await dialog(page).locator('[data-testid="custom-script-add"]').click();
  await expect
    .poll(() => control.log().find((entry) => entry.channel === IPC.customScriptsCreate)?.args)
    .toEqual({
      fields: { name: 'Two lines', command: MULTI, workingDir: '', color: 'none', collection: '' },
    });
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
  await page.locator('[data-testid="quick-commands-manage"]').click();
  await expect(dialog(page).locator('datalist#quick-command-collections option')).toHaveCount(1);
  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill('Lint');
  await dialog(page).locator('[data-testid="custom-script-add-command"]').fill('bun run lint');
  await dialog(page).locator('[data-testid="custom-script-add-collection"]').fill('  Backend ');
  await dialog(page).locator('[data-testid="custom-script-add"]').click();
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

// P133 §5.1 test 1: moved from settings-scripts.spec.ts's tests 1 and 2, merged the way the
// add-form test already merges "Add stays disabled" with a successful add.
test('Manage opens the quick commands dialog; add sends the trimmed fields', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-manage"]').click();
  await expect(dialog(page)).toBeVisible();

  await expect(dialog(page).locator('[data-testid="custom-script-list"]')).toHaveCount(0);
  await expect(dialog(page).getByText('No quick commands yet.')).toBeVisible();

  const addButton = dialog(page).locator('[data-testid="custom-script-add"]');
  await expect(addButton).toBeDisabled();

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill(`  ${SCRIPT.name}  `);
  await expect(addButton).toBeDisabled(); // command still empty

  await dialog(page)
    .locator('[data-testid="custom-script-add-command"]')
    .fill(`  ${SCRIPT.command}  `);
  await dialog(page)
    .locator('[data-testid="custom-script-add-workingdir"]')
    .fill(SCRIPT.workingDir);
  await dialog(page).locator('[data-testid="color-green"]').click();
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
      workingDir: SCRIPT.workingDir,
      color: 'green',
      collection: '',
    },
  });
});

// P133 §5.1 test 2: moved from settings-scripts.spec.ts's test 3.
test('a non-absolute working directory surfaces the backend error on add', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      {
        channel: IPC.customScriptsCreate,
        error: {
          code: 'E_BAD_REQUEST',
          message: 'model: custom script: working directory must be an absolute path',
        },
      },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-manage"]').click();
  await expect(dialog(page)).toBeVisible();

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill(SCRIPT.name);
  await dialog(page).locator('[data-testid="custom-script-add-command"]').fill(SCRIPT.command);
  await dialog(page).locator('[data-testid="custom-script-add-workingdir"]').fill('relative/dir');
  await dialog(page).locator('[data-testid="custom-script-add"]').click();

  await expect(dialog(page).locator('[data-testid="custom-script-error"]')).toHaveText(
    'model: custom script: working directory must be an absolute path',
  );
});

// P133 §5.1 test 3. Both customScriptsUpdate snapshots are matched by their exact args (the mock
// answers one of several same-channel snapshots by (channel, args) — installControlMocks's own
// findSnap), since the two calls below carry genuinely different fields.
test('Edit… opens the dialog focused on that row; blur commits; colour applies immediately', async ({
  relaunch,
}) => {
  const editedName = `${SCRIPT.name} edited`;
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [SCRIPT] },
      {
        channel: IPC.customScriptsUpdate,
        args: {
          id: SCRIPT.id,
          fields: {
            name: editedName,
            command: SCRIPT.command,
            workingDir: SCRIPT.workingDir,
            color: SCRIPT.color,
            collection: '',
          },
        },
        response: { ...SCRIPT, name: editedName },
      },
      {
        channel: IPC.customScriptsUpdate,
        args: {
          id: SCRIPT.id,
          fields: {
            name: SCRIPT.name,
            command: SCRIPT.command,
            workingDir: SCRIPT.workingDir,
            color: 'blue',
            collection: '',
          },
        },
        response: { ...SCRIPT, color: 'blue' },
      },
    ],
  });

  await openTerminalModule(page);
  await page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-edit"]').click();
  await expect(dialog(page)).toBeVisible();

  const row = dialog(page).locator(`[data-testid="custom-script-${SCRIPT.id}"]`);
  const nameInput = row.locator('[data-testid="custom-script-name"]');
  await expect(nameInput).toBeFocused();

  await nameInput.fill(`  ${editedName}  `);
  await nameInput.blur();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.customScriptsUpdate).length)
    .toBe(1);
  const updateCalls = () => control.log().filter((e) => e.channel === IPC.customScriptsUpdate);
  expect(updateCalls()[0]?.args).toEqual({
    id: SCRIPT.id,
    fields: {
      name: editedName,
      command: SCRIPT.command,
      workingDir: SCRIPT.workingDir,
      color: SCRIPT.color,
      collection: '',
    },
  });

  // The mock never broadcasts customScriptsChanged, so the record `onScriptColorChange` reads
  // from still carries SCRIPT's own original name — not the just-typed edit.
  await row.locator('[data-testid="color-blue"]').click();
  await expect.poll(() => updateCalls().length).toBe(2);
  expect(updateCalls()[1]?.args).toEqual({
    id: SCRIPT.id,
    fields: {
      name: SCRIPT.name,
      command: SCRIPT.command,
      workingDir: SCRIPT.workingDir,
      color: 'blue',
      collection: '',
    },
  });
});

// P133 §5.1 test 4. The single customScriptsUpdate snapshot only ever matches the rejected
// workingDir edit below -- the empty-command blur never calls update at all (client-side revert).
test('an empty field reverts on blur; a rejected edit reverts and shows the error', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [SCRIPT] },
      {
        channel: IPC.customScriptsUpdate,
        args: {
          id: SCRIPT.id,
          fields: {
            name: SCRIPT.name,
            command: SCRIPT.command,
            workingDir: 'relative/dir',
            color: SCRIPT.color,
          },
        },
        error: {
          code: 'E_BAD_REQUEST',
          message: 'model: custom script: working directory must be an absolute path',
        },
      },
    ],
  });

  await openTerminalModule(page);
  await page.locator('[data-testid="quick-commands-manage"]').click();
  await expect(dialog(page)).toBeVisible();

  const row = dialog(page).locator(`[data-testid="custom-script-${SCRIPT.id}"]`);
  const commandInput = row.locator('[data-testid="custom-script-command"]');
  await commandInput.fill('');
  await commandInput.blur();
  await expect(commandInput).toHaveValue(SCRIPT.command);
  expect(control.log().some((e) => e.channel === IPC.customScriptsUpdate)).toBe(false);

  const workingDirInput = row.locator('[data-testid="custom-script-workingdir"]');
  await workingDirInput.fill('relative/dir');
  await workingDirInput.blur();
  await expect(workingDirInput).toHaveValue(SCRIPT.workingDir);
  await expect(dialog(page).locator('[data-testid="custom-script-error"]')).toHaveText(
    'model: custom script: working directory must be an absolute path',
  );
});
