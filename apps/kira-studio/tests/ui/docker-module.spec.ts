import type { Page } from '@playwright/test';
import { installDockerMocks } from '../../../../packages/docker-ui/src/testing/ui/dockerMock';
import { expect, test } from './fixtures';
import { modeTab } from './support/apiMode';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

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

const DOWN_STATUS = {
  state: 'unavailable',
  reason: 'daemon-down',
  message: 'connection refused',
  endpoint: ENDPOINT,
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
      ExecOpen: () => ({ shell: 'sh' }),
      ...opts.handlers,
    },
  });
  return { page, docker, state, control };
}

async function openDocker(page: Page): Promise<void> {
  await modeTab(page, 'docker').click();
  await expect(page.locator('[data-testid="docker-panel"]')).toBeVisible();
}

async function openContainer(page: Page, name: string, tab?: string): Promise<void> {
  await page.locator(`[data-testid="docker-row"][data-name="${name}"]`).click();
  await expect(page.locator('[data-testid="docker-container-detail"]')).toBeVisible();
  if (tab) await page.locator(`[data-testid="docker-tab-${tab}"]`).click();
}

test('daemon down shows the unavailable state; Retry refetches and renders the lists', async ({
  relaunch,
}) => {
  const { page, docker, state } = await setup(relaunch, { status: DOWN_STATUS });
  await openDocker(page);

  await expect(page.locator('[data-testid="docker-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-testid="docker-unavailable-title"]')).toContainText(
    "isn't running",
  );

  state.status = OK_STATUS;
  await page.locator('[data-testid="docker-retry"]').click();

  await expect(page.locator('[data-testid="docker-container-list"]')).toBeVisible();
  expect(
    docker.calls('Status').some((c) => (c.args as { refresh?: boolean }).refresh === true),
  ).toBe(true);
});

test('containers group by Compose project; show-stopped and search filter the list', async ({
  relaunch,
}) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  const rows = page.locator('[data-testid="docker-row"]');
  await expect(page.locator('[data-testid="docker-group"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="docker-group"]')).toContainText('shop');
  await expect(rows).toHaveCount(4);

  await page.locator('[data-testid="docker-show-stopped"]').click();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-testid="docker-row"][data-name="old-job"]')).toHaveCount(0);

  await page.locator('[data-testid="toggle-search"]').click();
  await page.locator('[data-testid="tree-search"]').fill('db');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-name', 'shop-db-1');
});

test('Stop calls the bound method and the row updates after a changed event', async ({
  relaunch,
}) => {
  const { page, docker } = await setup(relaunch);
  await openDocker(page);

  const row = page.locator('[data-testid="docker-row"][data-name="solo"]');
  await expect(row).toHaveAttribute('data-state', 'running');
  await row.hover();
  await row.locator('[data-testid="docker-row-stop"]').click();

  await expect.poll(() => docker.calls('Stop').length).toBe(1);
  expect(docker.calls('Stop')[0].args).toEqual({ id: 'c-solo' });

  await emitWailsEvent(page, 'kira:docker:changed', { kinds: ['container'] });
  await expect(row).toHaveAttribute('data-state', 'exited');
});

test('stats events reach the overview, not the side list; leaving the mode unsubscribes and unwatches', async ({
  relaunch,
}) => {
  const { page, docker } = await setup(relaunch);
  await openDocker(page);

  await expect.poll(() => docker.calls('StatsSubscribe').length).toBeGreaterThan(0);
  await emitWailsEvent(page, 'kira:docker:stats', {
    samples: [
      {
        id: 'c-solo',
        cpuPercent: 12.5,
        memUsage: 1_048_576,
        memLimit: 8_388_608,
        memPercent: 12.5,
        netRx: 0,
        netTx: 0,
        blockRead: 0,
        blockWrite: 0,
        pids: 1,
        at: 1,
      },
    ],
  });
  await expect(page.locator('[data-testid="docker-engine-cpu"]')).toContainText('12.5%');
  for (const id of ['docker-row-cpu', 'docker-row-mem', 'docker-usage-bar']) {
    await expect(
      page.locator(`[data-testid="docker-container-list"] [data-testid="${id}"]`),
    ).toHaveCount(0);
  }

  await modeTab(page, 'studio').click();
  await expect.poll(() => docker.calls('StatsUnsubscribe').length).toBeGreaterThan(0);
  await expect.poll(() => docker.calls('Unwatch').length).toBeGreaterThan(0);
});

test('logs: stream args, appended lines, filter, stderr styling, timestamps reopen', async ({
  relaunch,
}) => {
  const { page, docker } = await setup(relaunch);
  await openDocker(page);
  await openContainer(page, 'solo', 'logs');

  await expect.poll(() => docker.calls('LogsOpen').length).toBe(1);
  const first = docker.calls('LogsOpen')[0].args as {
    streamId: string;
    containerId: string;
    tail: number;
    timestamps: boolean;
    follow: boolean;
  };
  expect(first).toMatchObject({
    containerId: 'c-solo',
    tail: 1000,
    timestamps: false,
    follow: true,
  });

  await emitWailsEvent(page, 'kira:docker:logs', {
    streamId: first.streamId,
    lines: [
      { stream: 'stdout', text: 'hello world' },
      { stream: 'stderr', text: 'boom failure' },
    ],
    ended: false,
  });
  const lines = page.locator('[data-testid="docker-log-line"]');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1)).toHaveAttribute('data-stream', 'stderr');
  await expect(lines.nth(1)).toHaveClass(/text-error/);

  await page.locator('[data-testid="docker-logs-filter"]').fill('boom');
  await expect(lines).toHaveCount(1);
  await expect(page.locator('[data-testid="docker-logs-count"]')).toHaveText('1');

  await page.locator('[data-testid="docker-logs-timestamps"]').click();
  await expect.poll(() => docker.calls('LogsOpen').length).toBe(2);
  expect((docker.calls('LogsOpen')[1].args as { timestamps: boolean }).timestamps).toBe(true);
  expect(docker.calls('LogsClose').length).toBeGreaterThan(0);
});

test('terminal: exec opens for the container, input is written, closing the chip closes it', async ({
  relaunch,
}) => {
  const { page, docker } = await setup(relaunch);
  await openDocker(page);
  await openContainer(page, 'solo', 'terminal');

  await page.locator('[data-testid="docker-exec-new"]').click();
  await expect.poll(() => docker.calls('ExecOpen').length).toBe(1);
  expect(docker.calls('ExecOpen')[0].args).toMatchObject({ containerId: 'c-solo' });
  await expect(page.locator('.xterm-rows')).toBeVisible();

  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('ls');
  await expect.poll(() => docker.calls('ExecWrite').length).toBeGreaterThan(0);

  await page.locator('[data-testid="docker-exec-close"]').click();
  await expect.poll(() => docker.calls('ExecClose').length).toBe(1);
});

test('terminal: no session opens until New session is clicked; sessions survive tab switches', async ({
  relaunch,
}) => {
  const { page, docker } = await setup(relaunch);
  await openDocker(page);
  await openContainer(page, 'solo', 'terminal');

  await expect(page.locator('[data-testid="docker-exec-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="docker-exec-chip"]')).toHaveCount(0);
  expect(docker.calls('ExecOpen')).toHaveLength(0);
  await page.locator('[data-testid="docker-tab-logs"]').click();
  await page.locator('[data-testid="docker-tab-terminal"]').click();
  await expect(page.locator('[data-testid="docker-exec-empty"]')).toBeVisible();
  expect(docker.calls('ExecOpen')).toHaveLength(0);

  await page.locator('[data-testid="docker-exec-new"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => docker.calls('ExecOpen').length).toBe(1);
  await expect(page.locator('[data-testid="docker-exec-chip"]')).toHaveCount(1);
  await expect(page.locator('.xterm-rows')).toBeVisible();

  await page.locator('[data-testid="docker-tab-logs"]').click();
  await page.locator('[data-testid="docker-tab-terminal"]').click();
  await expect(page.locator('[data-testid="docker-exec-chip"]')).toHaveCount(1);
  expect(docker.calls('ExecOpen')).toHaveLength(1);

  await page.locator('[data-testid="docker-exec-close"]').click();
  await expect.poll(() => docker.calls('ExecClose').length).toBe(1);
  await expect(page.locator('[data-testid="docker-exec-empty"]')).toBeVisible();
  expect(docker.calls('ExecOpen')).toHaveLength(1);
});

test('engine dropdown items do not overlap', async ({ relaunch }) => {
  const { page } = await setup(relaunch, {
    handlers: {
      Contexts: () => [
        { name: 'default', host: 'unix:///var/run/docker.sock', description: '', current: true },
        {
          name: 'colima',
          host: 'unix:///Users/me/.colima/default/docker.sock',
          description: '',
          current: false,
        },
        { name: 'remote', host: 'tcp://10.0.0.5:2376', description: '', current: false },
      ],
    },
  });
  await openDocker(page);
  await page.getByTestId('docker-panel').getByTestId('docker-endpoint-chip').click();
  await expect(page.locator('[data-testid="docker-context-option"]')).toHaveCount(3);

  const bad = await page
    .locator('[data-testid="docker-context-menu"] [role="menuitemradio"]')
    .evaluateAll((items) => {
      const problems: string[] = [];
      let prevBottom = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        if (r.top < prevBottom - 0.5) problems.push('items overlap');
        prevBottom = r.bottom;
        for (const span of item.querySelectorAll('span')) {
          const s = span.getBoundingClientRect();
          if (s.top < r.top - 0.5 || s.bottom > r.bottom + 0.5) problems.push('text spills');
        }
      }
      return problems;
    });
  expect(bad).toEqual([]);
});

test('images, volumes and networks list; "used by" selects the container', async ({ relaunch }) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  await page.locator('[data-testid="docker-section-images"]').click();
  await expect(page.locator('[data-testid="docker-row"]')).toHaveCount(2);
  await page.locator('[data-testid="docker-section-networks"]').click();
  await expect(page.locator('[data-testid="docker-row"]')).toHaveCount(1);

  await page.locator('[data-testid="docker-section-volumes"]').click();
  await page.locator('[data-testid="docker-row"]').click();
  await expect(page.locator('[data-testid="docker-resource-detail"]')).toHaveAttribute(
    'data-kind',
    'volume',
  );
  await page.locator('[data-testid="docker-used-by"]').click();
  await expect(page.locator('[data-testid="docker-container-detail"]')).toBeVisible();
  await expect(page.locator('[data-testid="docker-detail-name"]')).toHaveText('shop-db-1');
});

test('the tab strip is hidden in Docker mode and back elsewhere', async ({ relaunch }) => {
  const { page } = await setup(relaunch);
  await expect(page.locator('[data-testid="tab-strip"]')).toBeVisible();

  await openDocker(page);
  await expect(page.locator('[data-testid="tab-strip"]')).toHaveCount(0);

  await modeTab(page, 'studio').click();
  await expect(page.locator('[data-testid="tab-strip"]')).toBeVisible();
});

test('engine overview tabulates containers with humanized stats; section tabs share one row', async ({
  relaunch,
}) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  const tabs = page.locator(
    '[data-testid="docker-section-containers"], [data-testid="docker-section-images"], [data-testid="docker-section-volumes"], [data-testid="docker-section-networks"]',
  );
  await expect(tabs).toHaveCount(4);
  const tops = await tabs.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);

  await expect(page.locator('[data-testid="docker-engine-overview"]')).toBeVisible();
  await expect(page.locator('[data-testid="docker-engine-mem"]')).toHaveText('0 B');
  await expect(page.locator('[data-testid="docker-table-row"]')).toHaveCount(4);

  await emitWailsEvent(page, 'kira:docker:stats', {
    samples: [
      {
        id: 'c-db',
        cpuPercent: 3.2,
        memUsage: 1.5 * 1024 ** 3,
        memLimit: 16 * 1024 ** 3,
        memPercent: 9.4,
        netRx: 0,
        netTx: 0,
        blockRead: 0,
        blockWrite: 0,
        pids: 1,
        at: 1,
      },
    ],
  });
  await expect(page.locator('[data-testid="docker-engine-mem"]')).toHaveText('1.5 GB');
  await expect(
    page.locator('[data-testid="docker-table-row"][data-name="shop-db-1"]'),
  ).toContainText('1.5 GB');

  await page.locator('[data-testid="docker-table-row"][data-name="solo"]').click();
  await expect(page.locator('[data-testid="docker-detail-name"]')).toHaveText('solo');
  await page.locator('[data-testid="docker-overview-home"]').click();
  await expect(page.locator('[data-testid="docker-engine-overview"]')).toBeVisible();
});

test('image registry button opens the derived URL; local-only images get none', async ({
  relaunch,
}) => {
  const { page, control } = await setup(relaunch);
  await openDocker(page);
  await page.locator('[data-testid="docker-section-images"]').click();

  const alpine = page.locator('[data-testid="docker-row"]', { hasText: 'alpine:3.20' });
  const local = page.locator('[data-testid="docker-row"]', { hasText: 'local/app:dev' });
  await expect(local.locator('[data-testid="docker-image-registry"]')).toHaveCount(0);
  await alpine.hover();
  await alpine.locator('[data-testid="docker-image-registry"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.linkOpenExternal))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.linkOpenExternal)?.args).toMatchObject({
    url: 'https://hub.docker.com/_/alpine',
  });

  await alpine.click();
  await expect(page.locator('[data-testid="docker-resource-registry"]')).toBeVisible();
  await local.click();
  await expect(page.locator('[data-testid="docker-resource-registry"]')).toHaveCount(0);
});

test('container detail shows the registry button next to the image', async ({ relaunch }) => {
  const { page, control } = await setup(relaunch);
  await openDocker(page);
  await openContainer(page, 'solo');

  await page.locator('[data-testid="docker-detail-registry"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.linkOpenExternal))
    .toHaveLength(1);
});

test('start is green, stop is red, and a selected row has no bar', async ({ relaunch }) => {
  const { page } = await setup(relaunch);
  await openDocker(page);

  const stopped = page.locator('[data-testid="docker-row"][data-name="old-job"]');
  const running = page.locator('[data-testid="docker-row"][data-name="solo"]');
  await stopped.hover();
  await expect(stopped.locator('[data-testid="docker-row-start"]')).toHaveClass(/text-ok/);
  await running.hover();
  await expect(running.locator('[data-testid="docker-row-stop"]')).toHaveClass(/text-error/);

  await running.click();
  await expect(running).toHaveAttribute('aria-selected', 'true');
  expect(await running.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
});
