import { expect, type Locator, type Page } from '@playwright/test';
import type { ControlSnapshot } from '../mockRuntime';
import type { ScenarioEnv } from './env';

type Env = ScenarioEnv<
  | 'customScriptsList'
  | 'customScriptsMove'
  | 'customScriptsReorder'
  | 'customScriptsReorderCollections'
>;

export interface Options {
  extraBase: readonly ControlSnapshot[];
  modeTab: (page: Page) => Locator;
}

const NOW = '2026-01-01T00:00:00.000Z';

function scenarioScript(id: string, collectionId: string | null, sortOrder: number) {
  return {
    id,
    kind: 'script',
    params: [],
    smart: null,
    name: `Job ${id}`,
    command: `echo ${id}`,
    workingDir: '/tmp/demo-repo',
    dirMode: 'fixed',
    useAdeDir: false,
    color: 'green',
    collectionId,
    sortOrder,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
const scenarioCollection = (id: string, name: string, sortOrder: number) => ({
  id,
  name,
  sortOrder,
  createdAt: NOW,
  updatedAt: NOW,
});

const SNAPSHOT = {
  collections: [scenarioCollection('col-x', 'Xray', 0), scenarioCollection('col-y', 'Yankee', 1)],
  scripts: [
    scenarioScript('s1', null, 0),
    scenarioScript('s2', null, 1),
    scenarioScript('s3', null, 2),
    scenarioScript('t1', 'col-x', 3),
    scenarioScript('t2', 'col-x', 4),
  ],
};

const scriptIds = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-nav-key^="script:"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-nav-key')));
const groupIds = (page: Page) =>
  page
    .locator('[data-testid="script-group"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
const calls = (control: { log(): { channel: string; args?: unknown }[] }, channel: string) =>
  control
    .log()
    .filter((e) => e.channel === channel)
    .map((e) => e.args);
const row = (page: Page, id: string) => page.locator(`[data-testid="script-${id}"]`);
const header = (page: Page, id: string) =>
  page.locator(`[data-testid="script-group"][data-id="${id}"]`);
const menuItem = (page: Page, id: string) => page.locator(`[data-testid="menu-item-${id}"]`);

type Box = { x: number; y: number; width: number; height: number };

// Press on `from`, cross the drag tolerance and park over `target`. Sortable decides a cross-list
// insert from its own pointer sampling, so the pointer keeps nudging until `landed` holds. The
// caller releases or cancels.
async function dragTo(
  page: Page,
  from: Locator,
  target: Locator,
  at: (box: Box) => { x: number; y: number },
  landed: () => Promise<void>,
): Promise<void> {
  const src = await from.boundingBox();
  const dst = await target.boundingBox();
  if (!src || !dst) throw new Error('row has no box');
  const home = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
  const end = at(dst);
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(home.x, home.y + 10, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 15 });
  let nudge = 0;
  await expect(async () => {
    nudge += 1;
    await page.mouse.move(end.x + (nudge % 4), end.y, { steps: 2 });
    await page.waitForTimeout(80);
    await landed();
  }).toPass({ timeout: 10_000 });
}
const topQuarter = (b: Box) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height * 0.25,
});
const centre = (b: Box) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

// Backend half: termflow TestScriptOrder (Move with beforeId, Reorder, ReorderCollections); its
// contract fixes the call shapes.
export function registerOrderScenarios(env: Env, options: Options): void {
  const { test, contract, ipc: IPC } = env;

  const LIST: ControlSnapshot = {
    channel: IPC.customScriptsList,
    response: SNAPSHOT,
  };
  const BASE = [...options.extraBase, LIST];
  const moveArgs = (id: string, collectionId: string | null, beforeId: string | null) => ({
    ...contract<object>('script-order', 'args:CustomScriptsService.Move#before'),
    id,
    collectionId,
    beforeId,
  });

  async function openPanel(page: Page): Promise<void> {
    await options.modeTab(page).click();
    await expect(page.locator('[data-testid="automations-panel"]')).toBeVisible();
  }

  test('drag an ungrouped script into a collection at the drop position', async ({ relaunch }) => {
    const { window: page, control } = await relaunch({
      control: [...BASE, { channel: IPC.customScriptsMove }],
    });
    await openPanel(page);

    await dragTo(page, row(page, 's2'), row(page, 't1'), topQuarter, async () =>
      expect(await scriptIds(page, '[data-group-entry]:first-child')).toContain('script:s2'),
    );
    // The drop lands where the placeholder sits: before the script that follows it.
    const ids = await scriptIds(page, '[data-group-entry]:first-child');
    const next = ids[ids.indexOf('script:s2') + 1]?.replace('script:', '') ?? null;
    await page.mouse.up();

    await expect
      .poll(() => calls(control, IPC.customScriptsMove))
      .toEqual([moveArgs('s2', 'col-x', next)]);
  });

  test('drag a script into an empty expanded collection appends', async ({ relaunch }) => {
    const { window: page, control } = await relaunch({
      control: [...BASE, { channel: IPC.customScriptsMove }],
    });
    await openPanel(page);

    const slot = header(page, 'col-y').locator('xpath=following-sibling::*[1]');
    await dragTo(page, row(page, 's1'), slot, centre, async () =>
      expect(await scriptIds(page, '[data-group-entry]:last-child')).toEqual(['script:s1']),
    );
    await page.mouse.up();

    await expect
      .poll(() => calls(control, IPC.customScriptsMove))
      .toEqual([moveArgs('s1', 'col-y', null)]);
  });

  test('Escape during a cross-set drag moves nothing and the lists keep their order', async ({
    relaunch,
  }) => {
    const { window: page, control } = await relaunch({ control: BASE });
    await openPanel(page);

    await dragTo(page, row(page, 's2'), row(page, 't1'), topQuarter, async () =>
      expect(await scriptIds(page, '[data-group-entry]:first-child')).toContain('script:s2'),
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(100);

    expect(calls(control, IPC.customScriptsMove)).toHaveLength(0);
    expect(await scriptIds(page, '[data-testid="script-list"] > div:first-child')).toEqual([
      'script:s1',
      'script:s2',
      'script:s3',
    ]);
    expect(await scriptIds(page, '[data-group-entry]:first-child')).toEqual([
      'script:t1',
      'script:t2',
    ]);
  });

  test('menu Move up and Move down reorder a script and a collection, disabled at the ends', async ({
    relaunch,
  }) => {
    const { window: page, control } = await relaunch({
      control: [
        ...BASE,
        {
          channel: IPC.customScriptsReorder,
          args: { collectionId: null, ids: ['s2', 's1', 's3'] },
        },
        {
          channel: IPC.customScriptsReorderCollections,
          args: { ids: ['col-y', 'col-x'] },
        },
      ],
    });
    await openPanel(page);

    await row(page, 's1').click({ button: 'right' });
    await expect(menuItem(page, 'move-up')).toHaveAttribute('data-disabled', '');
    await expect(menuItem(page, 'move-down')).not.toHaveAttribute('data-disabled', '');
    await menuItem(page, 'move-down').click();
    await expect
      .poll(() => calls(control, IPC.customScriptsReorder))
      .toEqual([
        {
          ...contract<object>('script-order', 'args:CustomScriptsService.Reorder#ungrouped'),
          collectionId: null,
          ids: ['s2', 's1', 's3'],
        },
      ]);

    await row(page, 's3').click({ button: 'right' });
    await expect(menuItem(page, 'move-down')).toHaveAttribute('data-disabled', '');
    await page.keyboard.press('Escape');

    await header(page, 'col-y').click({ button: 'right' });
    await expect(menuItem(page, 'move-down')).toHaveAttribute('data-disabled', '');
    await page.keyboard.press('Escape');

    await header(page, 'col-x').click({ button: 'right' });
    await expect(menuItem(page, 'move-up')).toHaveAttribute('data-disabled', '');
    await menuItem(page, 'move-down').click();
    await expect
      .poll(() => calls(control, IPC.customScriptsReorderCollections))
      .toEqual([
        {
          ...contract<object>('script-order', 'args:CustomScriptsService.ReorderCollections'),
          ids: ['col-y', 'col-x'],
        },
      ]);
    await expect.poll(() => groupIds(page)).toEqual(['col-y', 'col-x']);
  });

  test('an active search disables drag between sets and the menu moves', async ({ relaunch }) => {
    const { window: page, control } = await relaunch({ control: BASE });
    await openPanel(page);

    await page.click('[data-testid="toggle-search"]');
    await page.fill('[data-testid="tree-search"]', 'echo');
    await expect(row(page, 't2')).toBeVisible();
    const src = await row(page, 's2').boundingBox();
    const dst = await row(page, 't1').boundingBox();
    if (!src || !dst) throw new Error('row has no box');
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height * 0.25, {
      steps: 20,
    });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(calls(control, IPC.customScriptsMove)).toHaveLength(0);

    await row(page, 's2').click({ button: 'right' });
    await expect(menuItem(page, 'move-up')).toHaveAttribute('data-disabled', '');
    await expect(menuItem(page, 'move-down')).toHaveAttribute('data-disabled', '');
  });
}
