import type { Locator, Page } from '@playwright/test';
import { installDockerMocks } from '../../../../packages/docker-ui/src/testing/ui/dockerMock';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab, openHttpModeAndNewRequest } from './support/apiMode';
import { PG_CONN } from './support/copyScenarios';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { openSettings } from './support/settings';
import { connectionRow } from './support/tree';

// P266 Stream A: UI half of the consistency audit. The Go half is
// internal/flows/appflow/errors_test.go; texts below are the catalog's literals.

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge';
const NOW = '2026-01-01T00:00:00.000Z';

const DOCKER_OK = {
  state: 'ok',
  endpoint: {
    context: 'default',
    host: 'unix:///var/run/docker.sock',
    source: 'default',
    secure: true,
    remote: false,
  },
  engine: {
    version: '29.0.0',
    apiVersion: '1.52',
    os: 'linux',
    arch: 'amd64',
    operatingSystem: 'Debian',
    kernelVersion: '6.1',
    cpus: 8,
    memTotal: 16 * 1024 ** 3,
    containers: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    images: 1,
  },
};

type Relaunch = Parameters<Parameters<typeof test>[2]>[0]['relaunch'];

async function openDockerWith(
  relaunch: Relaunch,
  handlers: Record<string, (args: unknown) => unknown>,
  control: readonly ControlSnapshot[] = [],
): Promise<Page> {
  const { window: page } = await relaunch({ control });
  await installDockerMocks(page, {
    bridgePkg: BRIDGE_PKG,
    handlers: { Status: () => DOCKER_OK, ...handlers },
  });
  await modeTab(page, 'docker').click();
  await expect(page.locator('[data-testid="docker-panel"]')).toBeVisible();
  return page;
}

const dockerError = (code: string, message: string) => () => ({ error: { code, message } });

test('QueryState: E_NOT_FOUND offers no Retry, E_INTERNAL does', async ({ relaunch }) => {
  const notFound = await openDockerWith(relaunch, {
    Containers: dockerError('E_NOT_FOUND', 'gone'),
  });
  const panel = notFound.locator('[data-testid="docker-panel"]');
  await expect(panel.locator('[data-testid="query-error"]')).toBeVisible();
  await expect(panel.locator('[data-testid="query-retry"]')).toHaveCount(0);
});

test('QueryState: E_INTERNAL offers Retry', async ({ relaunch }) => {
  const page = await openDockerWith(relaunch, {
    Containers: dockerError('E_INTERNAL', 'database is locked'),
  });
  const panel = page.locator('[data-testid="docker-panel"]');
  await expect(panel.locator('[data-testid="query-error"]')).toContainText('database is locked');
  await expect(panel.locator('[data-testid="query-retry"]')).toHaveText('Retry');
});

test('QueryState: E_CONTRACT renders the fixed Kira sentence around the detail', async ({
  relaunch,
}) => {
  const page = await openDockerWith(relaunch, {
    Containers: dockerError('E_CONTRACT', 'id is required'),
  });
  await expect(
    page.locator('[data-testid="docker-panel"] [data-testid="query-error"]'),
  ).toContainText('Something went wrong inside Kira (id is required).');
});

test('QueryState: the loading spinner stays hidden at 100 ms and shows within 1 s', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: [] });
  const docker = await installDockerMocks(page, {
    bridgePkg: BRIDGE_PKG,
    handlers: { Status: () => DOCKER_OK, Containers: () => new Promise<never>(() => undefined) },
  });
  // A paused fake clock: only `runFor` moves page time, so a loaded host cannot skew the delay.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await modeTab(page, 'docker').click();

  const loading = page.locator('[data-testid="docker-panel"] [data-testid="query-loading"]');
  let elapsed = 0;
  await expect
    .poll(async () => {
      await page.clock.runFor(10);
      elapsed += 10;
      return docker.calls('Containers').length;
    })
    .toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(100);
  // The placeholder mounts invisible and shows after SPINNER_DELAY (300 ms).
  await expect(loading).toBeHidden();
  await page.clock.runFor(1000);
  await expect(loading).toBeVisible();
});

test('reduced motion: dialogs skip animation, the loading Spinner keeps animate-spin', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: [] });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings(page);

  const ms = await page.locator('[data-testid="settings-dialog"]').evaluate((el) => {
    const raw = getComputedStyle(el).animationDuration.split(',')[0].trim();
    return raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
  });
  expect(ms).toBeLessThanOrEqual(0.01);
  await page.keyboard.press('Escape');

  await installDockerMocks(page, {
    bridgePkg: BRIDGE_PKG,
    handlers: { Status: () => DOCKER_OK, Containers: () => new Promise<never>(() => undefined) },
  });
  await modeTab(page, 'docker').click();
  await expect(
    page.locator(
      '[data-testid="docker-panel"] [data-testid="query-loading"] .codicon.animate-spin',
    ),
  ).toBeVisible();
});

test('LinkService.OpenExternal rejection is announced in the live region', async ({ relaunch }) => {
  const image = {
    id: 'sha256:img1',
    tags: ['alpine:3.20'],
    size: 8_000_000,
    created: 1_700_000_000,
    containers: 0,
    dangling: false,
  };
  const page = await openDockerWith(
    relaunch,
    {
      Containers: () => [],
      Images: () => [image],
      ImageRegistry: () => ({ url: 'https://hub.docker.com/_/alpine' }),
      Volumes: () => [],
      Networks: () => [],
    },
    [{ channel: IPC.linkOpenExternal, error: { code: 'E_INTERNAL', message: 'no handler' } }],
  );
  await page.locator('[data-testid="docker-section-images"]').click();
  const row = page.locator('[data-testid="docker-row"]', { hasText: 'alpine:3.20' });
  await row.click();
  await page.locator('[data-testid="docker-resource-registry"]').click();

  await expect(page.locator('[data-testid="app-live-region"]')).toHaveText(
    'Couldn’t open the link',
  );
});

test('first-run and api-start render the module front door', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await expect(page.locator('[data-testid="first-run"][data-slot="module-start"]')).toBeVisible();

  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="api-start"][data-slot="module-start"]')).toBeVisible();
});

test('side-panel empties are EmptyState with no button', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  const connections = page.locator('[data-testid="project-panel"] [data-slot="empty-state"]');
  await expect(connections).toBeVisible();
  await expect(connections.locator('button')).toHaveCount(0);

  await modeTab(page, 'api').click();
  const collections = page.locator('[data-testid="collections-empty"][data-slot="empty-state"]');
  await expect(collections).toBeVisible();
  await expect(collections.locator('button')).toHaveCount(0);
});

const TREE = {
  collections: [{ id: 'col-1', name: 'Orders API', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
  items: [],
};
const ENV = { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true };
const VARIABLE = {
  id: 'var-host',
  scope: 'collection',
  ownerId: 'col-1',
  name: 'host',
  value: 'api.example.com',
  isSecret: false,
  sortOrder: 0,
};

const icon = (el: Locator, name: string) => expect(el.locator(`.codicon-${name}`)).toBeVisible();

test('delete is trash in the connection and collection menus; remove is close on a variable row', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [PG_CONN] },
      { channel: IPC.collectionsList, response: TREE },
      {
        channel: IPC.variablesList,
        args: { scope: 'collection', ownerId: 'col-1' },
        response: [VARIABLE],
      },
    ],
  });

  await (await connectionRow(page, PG_CONN.name)).click({ button: 'right' });
  await icon(page.locator('[data-testid="menu-item-delete"]'), 'trash');
  await page.hover('[data-testid="menu-item-color"]');
  await expect(page.locator('[data-testid="menu-item-color-blue"]')).toContainText('Blue');
  await page.keyboard.press('Escape');

  await modeTab(page, 'api').click();
  const collection = page.locator('[data-testid="collection-row"][data-id="col-1"]');
  await collection.click({ button: 'right' });
  await icon(page.locator('[data-testid="menu-item-delete"]'), 'trash');
  await page.click('[data-testid="menu-item-variables"]');
  await icon(page.locator('[data-testid="variable-remove"]').first(), 'close');
});

test('delete is trash on an environment row', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.collectionsList, response: TREE },
      { channel: IPC.variablesListEnvironments, response: [ENV] },
    ],
  });
  await modeTab(page, 'api').click();
  await page.click('[data-testid="api-environments"]');
  await expect(page.locator('[data-testid="environments-dialog"]')).toBeVisible();
  await icon(page.locator('[data-testid="environment-remove"]'), 'trash');
});

test('Duplicate tab shows the files icon', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });
  await openHttpModeAndNewRequest(page);
  await page.locator('[data-testid="tab"]').first().click({ button: 'right' });
  await icon(page.locator('[data-testid="menu-item-duplicate-tab"]'), 'files');
});

test('a refused SQLite test shows the backend catalog text in the connection dialog', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [] },
      {
        channel: IPC.connectionsTest,
        response: { ok: false, error: 'The database file must be an absolute path.' },
      },
    ],
  });
  await emitWailsEvent(page, IPC.newConnection, null);
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-sqlite"]');
  await page.fill('[data-testid="connection-name"]', 'relative');
  await page.fill('[data-testid="connection-database"]', 'data/app.db');
  await page.click('[data-testid="connection-test"]');

  await expect(page.locator('[data-testid="connection-test-result"]')).toHaveText(
    'The database file must be an absolute path.',
  );
});

test('renamed menu events still open their UI', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await emitWailsEvent(page, IPC.newConnection, null);
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-cancel"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  await emitWailsEvent(page, IPC.openSettings, null);
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
});
