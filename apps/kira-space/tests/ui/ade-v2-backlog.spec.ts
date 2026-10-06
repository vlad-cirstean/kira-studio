import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// The Backlog tab: capture, priority order, inline edit, detail panel, promote and delete.

interface Item {
  id: string;
  text: string;
  [key: string]: unknown;
}

const items = () => adeFixture<{ items: Item[] }>('backlog').items;
const rows = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="ade-backlog-row"]');

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

async function openBacklog(
  relaunch: Parameters<typeof openPlan>[0],
  extra: readonly ControlSnapshot[] = [],
) {
  const app = await openPlan(relaunch, extra);
  await app.window.locator('[data-testid="ade-tab-backlog"]').click();
  await app.window.locator('[data-testid="ade-backlog"]').waitFor();
  return app;
}

test('the tab precedes Plan and counts the items', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await expect(page.locator('[data-testid="ade-backlog-count"]')).toHaveText('4');
  const order = await page.locator('[role="tab"]').allInnerTexts();
  expect(order.findIndex((t) => t.startsWith('Backlog'))).toBeLessThan(
    order.findIndex((t) => t.startsWith('Plan')),
  );
});

test('lists items with quiet link facts and selects the first', async ({ relaunch }) => {
  const { window: page } = await openBacklog(relaunch);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).first()).toHaveAttribute('data-selected', 'true');
  await expect(rows(page).first().locator('[data-testid="ade-backlog-facts"]')).toHaveText(
    'PAY-140',
  );
  await expect(rows(page).nth(1).locator('[data-testid="ade-backlog-facts"]')).toHaveText(
    'issue web-app#882',
  );
  await expect(page.locator('[data-testid="ade-backlog-title"]')).toContainText('Rate limit');
});

test('Enter in the capture input adds an item', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch, [
    { channel: IPC.adeTaskAddBacklogItem, response: items()[0] },
  ]);
  const input = page.locator('[data-testid="ade-backlog-add"]');
  await input.fill('Ship the changelog');
  await input.press('Enter');
  await expect.poll(() => calls(control, IPC.adeTaskAddBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskAddBacklogItem)[0]?.args).toEqual({
    text: 'Ship the changelog',
  });
  await expect(input).toHaveValue('');
});

test('arrows move an item one place and reorder at once', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch);
  await rows(page).nth(1).locator('[data-testid="ade-backlog-up"]').click();
  await expect.poll(() => calls(control, IPC.adeTaskMoveBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskMoveBacklogItem)[0]?.args).toEqual({ id: 'i2', toIndex: 0 });
  await expect(rows(page).first()).toHaveAttribute('data-item-id', 'i2');
  await rows(page).first().locator('[data-testid="ade-backlog-down"]').click();
  await expect.poll(() => calls(control, IPC.adeTaskMoveBacklogItem)).toHaveLength(2);
  expect(calls(control, IPC.adeTaskMoveBacklogItem)[1]?.args).toEqual({ id: 'i2', toIndex: 1 });
});

test('inline edit saves the text on Enter', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch);
  const text = rows(page).nth(2).locator('[data-testid="ade-backlog-text"]');
  await text.fill('Ask Dana about onboarding copy');
  await text.press('Enter');
  await expect.poll(() => calls(control, IPC.adeTaskUpdateBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateBacklogItem)[0]?.args).toEqual({
    id: 'i3',
    patch: {
      text: 'Ask Dana about onboarding copy',
      jira: null,
      clearJira: false,
      githubUrl: null,
      notes: null,
    },
  });
});

test('the panel edits links and notes of the selected item', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch);
  await rows(page).nth(2).click();
  await page.locator('[data-testid="ade-backlog-jira-input"]').fill('PAY-200');
  await page.locator('[data-testid="ade-backlog-jira-save"]').click();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateBacklogItem)[0]?.args).toMatchObject({
    id: 'i3',
    patch: { jira: { key: 'PAY-200', url: '' } },
  });
  await page.locator('[data-testid="ade-backlog-panel"] .ProseMirror').click();
  await page.keyboard.type('call on Friday', { delay: 20 });
  await expect.poll(() => calls(control, IPC.adeTaskUpdateBacklogItem)).toHaveLength(2);
  expect(JSON.stringify(calls(control, IPC.adeTaskUpdateBacklogItem)[1]?.args)).toContain(
    'call on Friday',
  );
});

test('Plan as task promotes, opens the Plan and selects the task', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch, [
    {
      channel: IPC.adeTaskPromoteBacklogItem,
      response: { ...adeFixture<object>('task'), id: 'T_deps' },
    },
  ]);
  await page.locator('[data-testid="ade-backlog-panel-promote"]').click();
  await expect.poll(() => calls(control, IPC.adeTaskPromoteBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskPromoteBacklogItem)[0]?.args).toEqual({ id: 'i1' });
  await expect(page.locator('[data-testid="ade-plan"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-panel"]')).toBeVisible();
});

test('delete asks to confirm before removing', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch);
  const dialog = page.locator('[data-testid="confirm-dialog"]');
  const del = rows(page).nth(3).locator('[data-testid="ade-backlog-delete"]');
  await del.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-testid="confirm-dialog-message"]')).toContainText(items()[3]?.text ?? '');
  expect(calls(control, IPC.adeTaskDeleteBacklogItem)).toHaveLength(0);
  await page.locator('[data-testid="confirm-dialog-cancel"]').click();
  await expect(dialog).toBeHidden();
  expect(calls(control, IPC.adeTaskDeleteBacklogItem)).toHaveLength(0);

  await del.click();
  await page.locator('[data-testid="confirm-dialog-confirm"]').click();
  await expect.poll(() => calls(control, IPC.adeTaskDeleteBacklogItem)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskDeleteBacklogItem)[0]?.args).toEqual({ id: 'i4' });
});

test('panel delete opens the same confirm', async ({ relaunch }) => {
  const { window: page, control } = await openBacklog(relaunch);
  await page.locator('[data-testid="ade-backlog-panel-delete"]').click();
  await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
  await page.locator('[data-testid="confirm-dialog-cancel"]').click();
  expect(calls(control, IPC.adeTaskDeleteBacklogItem)).toHaveLength(0);
});

test('an empty backlog says so and the panel asks to select', async ({ relaunch }) => {
  const { window: page } = await openBacklog(relaunch, [
    { channel: IPC.adeTaskBacklog, response: { items: [] } },
  ]);
  await expect(page.getByText('Backlog is empty.')).toBeVisible();
  await expect(page.getByText('Select an item to add links and notes.')).toBeVisible();
});
