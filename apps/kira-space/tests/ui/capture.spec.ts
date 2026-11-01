import { expect } from '@playwright/test';
import {
  calls,
  captureControl,
  changeRequestItem,
  emptyItem,
  issueItem,
  laterResult,
  t,
  captureTest as test,
  textItem,
} from './support/capture';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// UI half of captureflow/capture_test.go: the Go flows write tests/contract/capture.json (one item
// per kind, the Later result); this spec renders them in the popup.

const OPENED = {
  channel: IPC.captureConfirm,
  response: { action: 'openChangeRequest', key: 'hostview-1' },
};
const DISMISS = { channel: IPC.captureDismiss, response: null };

test('a change request preselects the PR action and Enter confirms it', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: captureControl(changeRequestItem, [OPENED]),
  });
  await expect(page.locator(t('capture-label'))).toHaveText('PR #7 acme/api');
  await expect(page.locator(t('capture-text'))).toHaveText(changeRequestItem.text);
  await expect(page.locator(t('capture-action-openChangeRequest'))).toBeChecked();
  await expect(page.locator(t('capture-title'))).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(control, IPC.captureConfirm)).toHaveLength(1);
  expect(calls(control, IPC.captureConfirm)[0]?.args).toMatchObject({
    itemId: changeRequestItem.id,
    action: 'openChangeRequest',
  });
});

test('an issue offers the issue view first', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: captureControl(issueItem) });
  await expect(page.locator(t('capture-label'))).toHaveText(issueItem.label);
  await expect(page.locator(t('capture-action-openIssue'))).toBeChecked();
  await expect(page.locator(t('capture-action-later'))).not.toBeChecked();
});

test('text offers only Later, with the title editable', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: captureControl(textItem, [{ channel: IPC.captureConfirm, response: laterResult }]),
  });
  await expect(page.locator(t('capture-label'))).toHaveCount(0);
  await expect(page.locator(t('capture-action-later'))).toBeChecked();
  const title = page.locator(t('capture-title'));
  await expect(title).toHaveValue(textItem.title);
  await title.fill('Edited title');
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(control, IPC.captureConfirm)).toHaveLength(1);
  expect(calls(control, IPC.captureConfirm)[0]?.args).toMatchObject({
    action: 'later',
    title: 'Edited title',
  });
});

test('choosing Later on a link reveals the title field', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: captureControl(changeRequestItem, [
      { channel: IPC.captureConfirm, response: laterResult },
    ]),
  });
  await page.locator(t('capture-action-later')).click();
  await expect(page.locator(t('capture-title'))).toHaveValue(changeRequestItem.title);
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(control, IPC.captureConfirm)).toHaveLength(1);
  expect(calls(control, IPC.captureConfirm)[0]?.args).toMatchObject({ action: 'later' });
});

test('Escape dismisses', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: captureControl(textItem, [DISMISS]),
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => calls(control, IPC.captureDismiss)).toHaveLength(1);
});

test('an empty clipboard shows the empty state and Enter dismisses', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: captureControl(emptyItem, [DISMISS]),
  });
  await expect(page.locator(t('capture-empty'))).toBeVisible();
  await expect(page.locator(t('capture-actions'))).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(control, IPC.captureDismiss)).toHaveLength(1);
  expect(calls(control, IPC.captureConfirm)).toHaveLength(0);
});

test('a pushed item replaces the content', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: captureControl(textItem) });
  await emitWailsEvent(page, IPC.captureItem, changeRequestItem);
  await expect(page.locator(t('capture-label'))).toHaveText('PR #7 acme/api');
  await expect(page.locator(t('capture-action-openChangeRequest'))).toBeChecked();
});

test('a failed confirm keeps the popup open and shows the error', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: captureControl(textItem, [
      {
        channel: IPC.captureConfirm,
        error: {
          code: 'E_INTERNAL',
          message: 'The task was added, but its details were not saved.',
        },
      },
    ]),
  });
  await page.keyboard.press('Enter');
  await expect(page.locator(t('capture-error'))).toContainText('details were not saved');
  await expect(page.locator(t('capture-window'))).toBeVisible();
});
