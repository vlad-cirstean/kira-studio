import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// The File types settings pane. Contract file-handlers; backend half: appflow
// TestFileHandlersSetAndRestore and TestFileHandlersUnsupportedByDefault. The fixture machine has
// json and yaml opened by Example Editor, go by nobody, toml unknown to the system.

const t = (id: string) => `[data-testid="${id}"]`;

interface Row {
  ext: string;
  state: string;
}
interface Status {
  supported: boolean;
  groups: { id: string; extensions: Row[] }[];
}

const status = (key: string) =>
  contract<Status>('file-handlers', `FileHandlersService.Status#${key}`);

function groupOf(s: Status, ext: string) {
  const g = s.groups.find((x) => x.extensions.some((e) => e.ext === ext));
  if (!g) throw new Error(`no group holds ${ext}`);
  return g;
}

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
  await page.locator(t('settings-section-File types')).click();
  return { page, handle };
}

test('contract: the pane shows the live handler of every type', async ({ relaunch }) => {
  const before = status('before');
  const { page } = await openPane(relaunch, [
    { channel: IPC.fileHandlersStatus, response: before },
  ]);
  const group = groupOf(before, 'json').id;
  await page
    .locator(t(`file-types-disclosure-${group}`))
    .getByRole('button')
    .click();
  await expect(page.locator(t('file-types-handler-json'))).toHaveText('Example Editor');
  await expect(page.locator(t(`file-types-switch-${group}`))).not.toBeChecked();
  expect(groupOf(before, 'toml').id).toBe(group);
  await expect(page.locator(t('file-types-handler-toml'))).toHaveText('Not registered');
  await expect(page.locator(t('file-types-ext-toml'))).toBeDisabled();
});

test('contract: a partly switched group reads mixed', async ({ relaunch }) => {
  const off = status('off');
  const { page } = await openPane(relaunch, [{ channel: IPC.fileHandlersStatus, response: off }]);
  const group = groupOf(off, 'yaml');
  const self = group.extensions.filter((e) => e.state === 'self').length;
  const sw = page.locator(t(`file-types-switch-${group.id}`));
  await expect(sw).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.locator(t(`file-types-some-${group.id}`))).toContainText(`${self} of`);
});

test('contract: the switch sends the available types of its group', async ({ relaunch }) => {
  const before = status('before');
  const group = groupOf(before, 'json');
  const { page, handle } = await openPane(relaunch, [
    { channel: IPC.fileHandlersStatus, response: before },
    {
      channel: IPC.fileHandlersSet,
      response: contract('file-handlers', 'FileHandlersService.Set#unrestored'),
    },
  ]);
  await page.locator(t(`file-types-switch-${group.id}`)).click();
  await expect.poll(() => calls(handle, IPC.fileHandlersSet)).toHaveLength(1);
  expect(calls(handle, IPC.fileHandlersSet)[0]?.args).toEqual({
    exts: group.extensions.filter((e) => e.state !== 'unavailable').map((e) => e.ext),
    on: true,
  });
});

test('contract: an unrestored type is named with the Finder way out', async ({ relaunch }) => {
  const on = status('on');
  const group = groupOf(on, 'yaml');
  const { page, handle } = await openPane(relaunch, [
    { channel: IPC.fileHandlersStatus, response: on },
    {
      channel: IPC.fileHandlersSet,
      response: contract('file-handlers', 'FileHandlersService.Set#unrestored'),
    },
  ]);
  await page
    .locator(t(`file-types-disclosure-${group.id}`))
    .getByRole('button')
    .click();
  await page.locator(t('file-types-ext-yaml')).click();
  await expect.poll(() => calls(handle, IPC.fileHandlersSet)).toHaveLength(1);
  expect(calls(handle, IPC.fileHandlersSet)[0]?.args).toEqual({ exts: ['yaml'], on: false });
  const alert = page.locator(t('file-types-unrestored'));
  await expect(alert).toContainText('yaml');
  await expect(alert).toContainText('Change All');
});

test('contract: an unsupported build shows only the alert', async ({ relaunch }) => {
  const { page } = await openPane(relaunch, [
    { channel: IPC.fileHandlersStatus, response: status('unsupported') },
  ]);
  await expect(page.locator(t('file-types-unsupported'))).toBeVisible();
  await expect(page.locator('[data-testid^="file-types-switch-"]')).toHaveCount(0);
});
