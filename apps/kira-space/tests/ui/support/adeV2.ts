import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { KiraApp, RelaunchOptions } from '../fixtures';
import { IPC } from './ipcChannels';
import type { ControlSnapshot } from './types';

// The ade v2 fixtures are the P143 captures; `FIXED_NOW` is the day they are anchored to
// (Tue 2026-09-22), so band labels and relative times match the committed data.
export const FIXED_NOW = 1_790_070_000_000;

const FIXTURE_DIR = resolve(__dirname, '../../fixtures/ade-v2');

export function adeFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;
}

function repoRecord(id: string, name: string, order: number) {
  return {
    id,
    name,
    root: `/tmp/${name}`,
    repoId: `/tmp/${name}`,
    sortOrder: order,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const REPO_RECORDS = [
  repoRecord('repo-web-app', 'acme-customer-dashboard-web-frontend', 1),
  repoRecord('repo-api', 'acme-platform-core-api-service', 2),
  repoRecord('repo-mobile', 'acme-mobile-react-native-app', 3),
];

/** Boots straight into the ade mode with the committed board, PR, workflow and repo fixtures;
 *  `extra` snapshots replace a default of the same channel. */
export function adeV2Control(extra: readonly ControlSnapshot[] = []): ControlSnapshot[] {
  const defaults: ControlSnapshot[] = [
    { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
    { channel: IPC.codeWorkspaceListRepos, response: REPO_RECORDS },
    { channel: IPC.adeTaskBoard, response: adeFixture('board') },
    { channel: IPC.adeTaskPrs, response: adeFixture('prs') },
    { channel: IPC.adeTaskWorkflows, response: adeFixture('workflows') },
    { channel: IPC.adeTaskRepos, response: adeFixture('repos') },
    { channel: IPC.adeTaskBacklog, response: adeFixture('backlog') },
    { channel: IPC.adeTaskSetPlan },
    { channel: IPC.adeTaskUpdateTask, response: adeFixture('task') },
    { channel: IPC.adeTaskAddTaskRepo, response: adeFixture('branch') },
    {
      channel: IPC.adeTaskUpdateBacklogItem,
      response: adeFixture<{ items: unknown[] }>('backlog').items[0],
    },
    { channel: IPC.adeTaskMoveBacklogItem },
    { channel: IPC.adeTaskDeleteBacklogItem },
    { channel: IPC.adeTaskPromoteBacklogItem, response: adeFixture('task') },
  ];
  const overridden = new Set(extra.map((s) => s.channel));
  return [...defaults.filter((s) => !overridden.has(s.channel)), ...extra];
}

/** Opens the ade Plan on the fixture day. The clock is installed after boot and the page reloaded,
 *  so the first render already sees `FIXED_NOW`. */
export async function openPlan(
  relaunch: (options?: RelaunchOptions) => Promise<KiraApp>,
  extra: readonly ControlSnapshot[] = [],
): Promise<KiraApp> {
  const app = await relaunch({ control: adeV2Control(extra) });
  await app.window.clock.install({ time: FIXED_NOW });
  await app.window.reload();
  await app.window.locator('[data-testid="ade-plan"]').waitFor();
  return app;
}

export function bandOf(page: Page, day: number) {
  return page.locator(`[data-testid="ade-day-band"][data-ade-day="${day}"]`);
}
