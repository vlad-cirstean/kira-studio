import type { Page } from '@playwright/test';
import { installDockerMocks } from '../../../../packages/docker-ui/src/testing/ui/dockerMock';
import { expect, test } from './fixtures';
import { modeTab } from './support/apiMode';
import { contract } from './support/contract';

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge';

const ENDPOINT = {
  context: 'default',
  host: 'unix:///var/run/docker.sock',
  source: 'default',
  secure: true,
  remote: false,
};

const OK_STATUS = {
  state: 'ok',
  endpoint: ENDPOINT,
  engine: {
    version: '29.0.0',
    apiVersion: '1.52',
    os: 'linux',
    arch: 'amd64',
    operatingSystem: 'Debian',
    kernelVersion: '6.1',
    cpus: 8,
    memTotal: 16 * 1024 ** 3,
    containers: 4,
    running: 3,
    paused: 0,
    stopped: 1,
    images: 2,
  },
};

function container(id: string, name: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    image: 'alpine:3.20',
    imageId: 'sha256:img1',
    state,
    status: state === 'running' ? 'Up 2 minutes' : 'Exited (0) 1 hour ago',
    created: 1_700_000_000,
    ports: [],
    composeProject: '',
    composeService: '',
    origin: '',
    originName: '',
    networks: ['bridge'],
    ...extra,
  };
}

function seedContainers() {
  return [
    container('c-web', 'shop-web-1', 'running', {
      composeProject: 'shop',
      composeService: 'web',
      origin: 'compose',
      originName: 'shop',
    }),
    container('c-db', 'shop-db-1', 'running', {
      composeProject: 'shop',
      composeService: 'db',
      origin: 'compose',
      originName: 'shop',
    }),
    container('c-solo', 'solo', 'running'),
    container('c-old', 'old-job', 'exited'),
  ];
}

const IMAGES = [
  {
    id: 'sha256:img1',
    tags: ['alpine:3.20'],
    size: 8_000_000,
    created: 1_700_000_000,
    containers: 2,
    dangling: false,
    registryUrl: 'https://hub.docker.com/_/alpine',
  },
  {
    id: 'sha256:img2',
    tags: ['local/app:dev'],
    size: 1_000_000,
    created: 1_700_000_000,
    containers: 0,
    dangling: false,
    registryUrl: '',
  },
];
const VOLUMES = [
  {
    name: 'pgdata',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/pgdata',
    scope: 'local',
    created: '',
    labels: {},
    usedBy: ['c-db'],
  },
];
const NETWORKS = [
  {
    id: 'net1',
    name: 'shop_default',
    driver: 'bridge',
    scope: 'local',
    internal: false,
    subnets: ['172.18.0.0/16'],
    containers: 2,
    builtin: false,
    usedBy: ['c-web', 'c-db'],
  },
];

function detail(c: ReturnType<typeof container>) {
  return {
    container: c,
    command: ['sh'],
    entrypoint: [],
    env: ['SECRET=hunter2'],
    workingDir: '/',
    user: '',
    restartPolicy: 'no',
    health: '',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '0001-01-01T00:00:00Z',
    exitCode: 0,
    tty: false,
    mounts: [],
    labels: {},
    networkAttachments: [],
    raw: '{"Id":"x"}',
    registryUrl: c.image === 'alpine:3.20' ? 'https://hub.docker.com/_/alpine' : '',
  };
}

async function setup(
  relaunch: Parameters<Parameters<typeof test>[2]>[0]['relaunch'],
  opts: { status?: unknown; handlers?: Record<string, (args: unknown) => unknown> } = {},
) {
  const { window: page, control } = await relaunch({ control: [] });
  const state = { status: opts.status ?? OK_STATUS, containers: seedContainers() };
  const docker = await installDockerMocks(page, {
    bridgePkg: BRIDGE_PKG,
    handlers: {
      Status: () => state.status,
      Containers: () => state.containers,
      Images: () => IMAGES,
      Volumes: () => VOLUMES,
      Networks: () => NETWORKS,
      InspectContainer: (a) => {
        const c = state.containers.find((x) => x.id === (a as { id: string }).id);
        return c ? detail(c) : { error: { code: 'E_NOT_FOUND', message: 'no such container' } };
      },
      Inspect: () => ({ raw: '{"Id":"x"}' }),
      Stop: (a) => {
        const c = state.containers.find((x) => x.id === (a as { id: string }).id);
        if (c) c.state = 'exited';
      },
      ExecOpen: () => contract('docker-exec', 'DockerService.ExecOpen'),
      ...opts.handlers,
    },
  });
  return { page, docker, state, control };
}

async function openDocker(page: Page): Promise<void> {
  await modeTab(page, 'docker').click();
  await expect(page.locator('[data-testid="docker-panel"]')).toBeVisible();
}

test('container list: arrows, Home/End, Left/Right on a compose group, Enter opens, Shift+F10 menu returns focus', async ({
  relaunch,
}) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  const group = page.locator('[data-testid="docker-group"]');
  const rows = page.locator('[data-testid="docker-row"]');
  await group.focus();
  await expect(group).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(rows).toHaveCount(4);

  await page.keyboard.press('ArrowDown');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(group).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="docker-container-detail"]')).toBeVisible();

  const solo = page.locator('[data-testid="docker-row"][data-name="solo"]');
  await solo.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(solo).toBeFocused();
});

test('image, network and volume lists: arrows and Home/End move focus, Enter selects', async ({
  relaunch,
}) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  for (const [tab, list, count] of [
    ['images', 'docker-image-list', 2],
    ['networks', 'docker-network-list', 1],
    ['volumes', 'docker-volume-list', 1],
  ] as const) {
    await page.locator(`[data-testid="docker-section-${tab}"]`).click();
    const rows = page.locator(`[data-testid="${list}"] [data-testid="docker-row"]`);
    await expect(rows).toHaveCount(count);
    await rows.first().focus();
    if (count > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await page.keyboard.press('Home');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('End');
      await expect(rows.last()).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(rows.last()).toHaveAttribute('aria-selected', 'true');
  }
});
