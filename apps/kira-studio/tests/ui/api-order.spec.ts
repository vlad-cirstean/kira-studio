import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { openHttpMode } from './support/apiMode';
import { collectionRow } from './support/apiRows';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { dragRow, settleFrames } from './support/tree';

// P381: collections, folders and requests reorder by drag and by Move up / Move down. The Go half
// is apiflow TestCollectionOrder; contract api-order fixes the call shapes and the ordered tree.

interface Summary {
  id: string;
  name: string;
  sortOrder: number;
  parentId?: string | null;
}
const ordered = contract<{ collections: Summary[]; items: Summary[] }>(
  'api-order',
  'CollectionsService.List#ordered',
);
const byName = <T extends Summary>(list: T[], name: string): T => {
  const hit = list.find((x) => x.name === name);
  if (!hit) throw new Error(`no ${name} in the contract tree`);
  return hit;
};
const A = byName(ordered.collections, 'A').id;
const B = byName(ordered.collections, 'B').id;
const C = byName(ordered.collections, 'C').id;
const R1 = byName(ordered.items, 'r1').id;
const R2 = byName(ordered.items, 'r2').id;
const R3 = byName(ordered.items, 'r3').id;
const F = byName(ordered.items, 'f').id;

// A, B, C with A holding r1, r2, f (r3 inside f): the tree before any reorder.
function listWith(collectionOrder: string[], itemOrder: string[]) {
  const rank = (ids: string[], id: string) => ids.indexOf(id);
  return {
    collections: collectionOrder.map((id, i) => ({
      ...ordered.collections.find((c) => c.id === id),
      sortOrder: i,
    })),
    items: ordered.items.map((it) => ({
      ...it,
      sortOrder: it.parentId ? 0 : rank(itemOrder, it.id),
    })),
  };
}
const BEFORE = listWith([A, B, C], [R1, R2, F]);
const reorderCalls = (control: { log(): { channel: string; args?: unknown }[] }) =>
  control.log().filter((e) => e.channel === IPC.collectionsReorderCollections);
const moveCalls = (control: { log(): { channel: string; args?: unknown }[] }) =>
  control.log().filter((e) => e.channel === IPC.collectionsMoveItems);
const rowIds = (page: Page) =>
  page
    .locator('[data-testid="collection-row"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
const indicator = (page: Page) => page.locator('[data-testid="tree-drop-indicator"]');
const menuItem = (page: Page, id: string) => page.locator(`[data-testid="menu-item-${id}"]`);
const twisty = (row: Locator) => row.locator('[data-testid="tree-twisty"]');

// The app reads the platform chord from the page's user agent.
const primary = (page: Page) =>
  page.evaluate(() =>
    navigator.userAgent.includes('Mac') ? ('Meta' as const) : ('Control' as const),
  );

const control = (list: unknown[], ...more: ControlSnapshot[]): ControlSnapshot[] => [
  ...list.map((response) => ({ channel: IPC.collectionsList, response })),
  ...more,
];

test('drag a collection above another: line on its header, one call, new order', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE, ordered], {
      channel: IPC.collectionsReorderCollections,
      response: null,
    }),
  });
  await openHttpMode(page);
  await expect.poll(() => rowIds(page)).toEqual([A, B, C]);

  await dragRow(page, collectionRow(page, C), collectionRow(page, A), 0.25);
  await expect(indicator(page)).toHaveCount(1);
  await expect(
    collectionRow(page, A).locator('[data-testid="tree-drop-indicator"]'),
  ).toHaveAttribute('data-zone', 'before');
  await page.mouse.up();

  await expect.poll(() => reorderCalls(log)).toHaveLength(1);
  expect(reorderCalls(log)[0].args).toEqual({
    ...contract<object>('api-order', 'args:CollectionsService.ReorderCollections'),
    ids: [C, A, B],
  });
  await expect.poll(() => rowIds(page)).toEqual([C, A, B]);
  await expect(indicator(page)).toHaveCount(0);
});

test('drag a collection onto a row inside an open collection: line under the last row of its block', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE], {
      channel: IPC.collectionsReorderCollections,
      response: null,
    }),
  });
  await openHttpMode(page);
  await twisty(collectionRow(page, A)).click();
  await expect.poll(() => rowIds(page)).toEqual([A, R1, R2, F, B, C]);

  await dragRow(page, collectionRow(page, C), collectionRow(page, R1), 0.5);
  await expect(indicator(page)).toHaveCount(1);
  await expect(
    collectionRow(page, F).locator('[data-testid="tree-drop-indicator"]'),
  ).toHaveAttribute('data-zone', 'after');
  await page.mouse.up();

  await expect.poll(() => reorderCalls(log)).toHaveLength(1);
  expect(reorderCalls(log)[0].args).toMatchObject({ ids: [A, C, B] });
});

test('a mixed selection, an active search and Escape start no collection reorder', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE], {
      channel: IPC.collectionsReorderCollections,
      response: null,
    }),
  });
  await openHttpMode(page);
  await twisty(collectionRow(page, A)).click();

  await collectionRow(page, C).click();
  await collectionRow(page, R1).click({ modifiers: [await primary(page)] });
  await dragRow(page, collectionRow(page, C), collectionRow(page, A), 0.25);
  await expect(indicator(page)).toHaveCount(0);
  await page.mouse.up();

  await collectionRow(page, C).click();
  await dragRow(page, collectionRow(page, C), collectionRow(page, A), 0.25);
  await expect(indicator(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(indicator(page)).toHaveCount(0);
  await page.mouse.up();

  await page.click('[data-testid="toggle-search"]');
  await page.fill('[data-testid="tree-search"]', 'r');
  await expect(collectionRow(page, R1)).toBeVisible();
  await collectionRow(page, A).click();
  await dragRow(page, collectionRow(page, A), collectionRow(page, R2), 0.75);
  await expect(indicator(page)).toHaveCount(0);
  await page.mouse.up();
  await settleFrames(page);

  expect(reorderCalls(log)).toHaveLength(0);
  expect(moveCalls(log)).toHaveLength(0);
});

test('collection menu: Move up is disabled on the first, Alt+ArrowDown moves and keeps focus', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE, listWith([B, A, C], [R1, R2, F])], {
      channel: IPC.collectionsReorderCollections,
      response: null,
    }),
  });
  await openHttpMode(page);

  await collectionRow(page, A).click({ button: 'right' });
  await expect(menuItem(page, 'move-up')).toHaveAttribute('data-disabled', '');
  await expect(menuItem(page, 'move-down')).not.toHaveAttribute('data-disabled', '');
  await expect(menuItem(page, 'move-down-shortcut')).toHaveText(/Alt|⌥/);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  await collectionRow(page, A).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => rowIds(page)).toEqual([B, A, C]);
  expect(reorderCalls(log)).toHaveLength(1);
  expect(reorderCalls(log)[0].args).toMatchObject({ ids: [B, A, C] });
  await expect(collectionRow(page, A)).toBeFocused();
});

test('request menu: Move up and Move down step inside the parent; Alt+Arrow never leaves a folder', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE], {
      channel: IPC.collectionsMoveItems,
      response: null,
    }),
  });
  await openHttpMode(page);
  await twisty(collectionRow(page, A)).click();
  await twisty(collectionRow(page, F)).click();
  await expect.poll(() => rowIds(page)).toEqual([A, R1, R2, F, R3, B, C]);

  await collectionRow(page, R2).click({ button: 'right' });
  await expect(menuItem(page, 'move-up')).not.toHaveAttribute('data-disabled', '');
  await menuItem(page, 'move-up').click();
  await expect.poll(() => moveCalls(log)).toHaveLength(1);
  expect(moveCalls(log)[0].args).toEqual({
    ...contract<object>('api-order', 'args:CollectionsService.MoveItems#up'),
    itemIds: [R2],
    collectionId: A,
    parentId: null,
    beforeId: R1,
  });

  await collectionRow(page, F).click({ button: 'right' });
  await expect(menuItem(page, 'move-down')).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');

  await collectionRow(page, R2).click({ button: 'right' });
  await menuItem(page, 'move-down').click();
  await expect.poll(() => moveCalls(log)).toHaveLength(2);
  expect(moveCalls(log)[1].args).toEqual({
    ...contract<object>('api-order', 'args:CollectionsService.MoveItems#down'),
    itemIds: [R2],
    collectionId: A,
    parentId: null,
    beforeId: null,
  });

  await collectionRow(page, R3).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowDown');
  await settleFrames(page);
  expect(moveCalls(log)).toHaveLength(2);
});

test('a rejected reorder shows the error and leaves the persisted order', async ({ relaunch }) => {
  const { window: page, control: log } = await relaunch({
    control: control([BEFORE, BEFORE], {
      channel: IPC.collectionsReorderCollections,
      error: {
        code: 'E_BAD_REQUEST',
        message: 'That collection order isn’t valid.',
      },
    }),
  });
  await openHttpMode(page);

  await dragRow(page, collectionRow(page, C), collectionRow(page, A), 0.25);
  await page.mouse.up();
  await expect.poll(() => reorderCalls(log)).toHaveLength(1);
  await expect(page.locator('[data-testid="collections-error"]')).toBeVisible();
  await expect.poll(() => rowIds(page)).toEqual([A, B, C]);
});
