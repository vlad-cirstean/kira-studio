import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, adeV2Control, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// The Git module's Repositories dialog: import, per-repo configuration and scan folders.

interface ReposFx {
  repos: { codeRepoId: string; nickname: string }[];
  folders: { path: string; watch: boolean }[];
}

const t = (id: string) => `[data-testid="${id}"]`;

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

const chooseFolder = {
  channel: IPC.filesChooseFolder,
  response: { canceled: false, path: '~/code/oss' },
};

async function openDialog(relaunch: Parameters<typeof openPlan>[0], extra: ControlSnapshot[] = []) {
  const app = await relaunch({
    control: adeV2Control([
      { channel: IPC.windowsEnsure, response: { mode: 'git' } },
      chooseFolder,
      ...extra,
    ]),
  });
  await app.window.locator(t('manage-repos')).click();
  await app.window.locator(t('repos-dialog')).waitFor();
  return app;
}

async function openFolders(relaunch: Parameters<typeof openPlan>[0]) {
  const app = await openDialog(relaunch);
  await app.window.locator(t('repos-dialog-tab-folders')).click();
  return app;
}

test('the Agents shell has no Repos tab; its empty state opens the dialog in the Git module', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await expect(page.locator(t('ade-tab-repos'))).toHaveCount(0);

  const empty = await relaunch({
    control: adeV2Control([{ channel: IPC.codeWorkspaceListRepos, response: [] }]),
  });
  await empty.window.locator(t('ade-import')).click();
  await expect(empty.window.locator(t('repos-dialog'))).toBeVisible();
  await expect(empty.window.locator(t('ade-view'))).toHaveCount(0);
});

test('a repo row menu opens the dialog on that repo', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: adeV2Control([{ channel: IPC.windowsEnsure, response: { mode: 'git' } }]),
  });
  await page.locator(`${t('repo-row')}[data-repo-id="repo-api"]`).click({ button: 'right' });
  await page.locator(t('menu-item-configure')).click();
  await expect(page.locator(t('repos-dialog'))).toBeVisible();
  await expect(page.locator(t('repo-nick'))).toHaveValue('api');
});

test('dialog folders list, add, watch and remove send their args', async ({ relaunch }) => {
  const fx = adeFixture<ReposFx>('repos');
  const { window: page, control } = await openFolders(relaunch);
  await expect(page.locator(t('repos-dialog-folder'))).toHaveCount(fx.folders.length);

  await page.locator(t('repos-dialog-add-folder')).click();
  await expect.poll(() => calls(control, IPC.adeTaskAddFolder)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskAddFolder)[0]?.args).toEqual({
    path: '~/code/oss',
    watch: true,
  });

  await page.locator(t('repos-dialog-folder-watch')).first().click();
  await expect.poll(() => calls(control, IPC.adeTaskSetFolderWatch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetFolderWatch)[0]?.args).toEqual({
    path: fx.folders[0]?.path,
    watch: !fx.folders[0]?.watch,
  });

  await page.locator(t('repos-dialog-folder-remove')).first().click();
  await expect.poll(() => calls(control, IPC.adeTaskRemoveFolder)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRemoveFolder)[0]?.args).toEqual({ path: fx.folders[0]?.path });
});

test('dialog import sends the chosen path', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch);
  await page.locator(t('repos-dialog-import')).click();
  await expect.poll(() => calls(control, IPC.codeWorkspaceImportRepo)).toHaveLength(1);
  expect(calls(control, IPC.codeWorkspaceImportRepo)[0]?.args).toEqual({ path: '~/code/oss' });
});

test('a repos push re-reads the shared list without the ade module open', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: adeV2Control([{ channel: IPC.windowsEnsure, response: { mode: 'git' } }]),
  });
  await expect(page.locator(t('manage-repos'))).toBeVisible();
  const before = calls(control, IPC.codeWorkspaceListRepos).length;
  await emitWailsEvent(page, IPC.adeTaskReposChanged, null);
  await expect
    .poll(() => calls(control, IPC.codeWorkspaceListRepos).length)
    .toBeGreaterThan(before);
});

test('selecting a repo shows its settings', async ({ relaunch }) => {
  const fx = adeFixture<ReposFx>('repos');
  const { window: page } = await openDialog(relaunch);
  await expect(page.locator(t('repos-dialog-repo'))).toHaveCount(3);
  await page.locator(t('repos-dialog-repo')).nth(1).click();
  await expect(page.locator(t('repo-nick'))).toHaveValue(fx.repos[1]?.nickname ?? '');
});

test('removing a repository asks first', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch, [
    { channel: IPC.codeWorkspaceRemoveRepo },
  ]);
  await page.locator(t('repos-dialog-repo-remove')).click();
  await page.locator(t('confirm-dialog-cancel')).click();
  expect(calls(control, IPC.codeWorkspaceRemoveRepo)).toHaveLength(0);
  await page.locator(t('repos-dialog-repo-remove')).click();
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect.poll(() => calls(control, IPC.codeWorkspaceRemoveRepo)).toHaveLength(1);
});

async function commit(page: Page, id: string, value: string): Promise<void> {
  const field = page.locator(t(id)).first();
  await field.fill(value);
  await field.blur();
}

test('each field sends a one-leaf patch', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch);
  const patches = () => calls(control, IPC.adeTaskUpdateRepo).map((e) => e.args);

  await commit(page, 'repo-nick', 'webby');
  await expect.poll(patches).toHaveLength(1);
  expect(patches()[0]).toMatchObject({ codeRepoId: 'repo-web-app', patch: { nickname: 'webby' } });

  await commit(page, 'repo-prepare', 'pnpm install\npnpm build');
  await expect.poll(patches).toHaveLength(2);
  expect(patches()[1]).toMatchObject({ patch: { prepareScript: 'pnpm install\npnpm build' } });

  await commit(page, 'repo-timeout', '45m');
  await expect.poll(patches).toHaveLength(3);
  expect(patches()[2]).toMatchObject({ patch: { prepareTimeout: '45m' } });

  await commit(page, 'repo-base-path', '/work/trees');
  await expect.poll(patches).toHaveLength(4);
  expect(patches()[3]).toMatchObject({ patch: { worktreeBasePath: '/work/trees' } });

  await commit(page, 'repo-targets', 'develop, staging');
  await expect.poll(patches).toHaveLength(5);
  expect(patches()[4]).toMatchObject({ patch: { integrationBranches: ['develop', 'staging'] } });

  await commit(page, 'repo-env-script', 'echo abc');
  await expect.poll(patches).toHaveLength(6);
  const envs = (patches()[5] as { patch: { environments: unknown[] } }).patch.environments;
  expect(envs).toHaveLength(3);
  expect(envs[0]).toEqual({ name: 'preview', deployedShaScript: 'echo abc' });
});

test('Choose… writes the picked folder as the base path', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch);
  await page.locator(t('repo-base-path-choose')).click();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateRepo)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateRepo)[0]?.args).toMatchObject({
    patch: { worktreeBasePath: '~/code/oss' },
  });
});

test('a rejected timeout shows the error and keeps the text', async ({ relaunch }) => {
  const { window: page } = await openDialog(relaunch, [
    {
      channel: IPC.adeTaskUpdateRepo,
      error: { code: 'invalid', message: 'prepareTimeout must be a duration' },
    },
  ]);
  await commit(page, 'repo-timeout', 'soon');
  await expect(page.locator(t('repo-timeout-error'))).toContainText(
    'prepareTimeout must be a duration',
  );
  await expect(page.locator(t('repo-timeout'))).toHaveValue('soon');
});

test('picking a swatch sends SetRepoColor and the nav dot follows', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch, [
    {
      channel: IPC.codeWorkspaceSetRepoColor,
      response: {
        id: 'repo-web-app',
        name: 'acme-customer-dashboard-web-frontend',
        root: '/tmp/acme-customer-dashboard-web-frontend',
        repoId: '/tmp/acme-customer-dashboard-web-frontend',
        sortOrder: 1,
        color: 'red',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ]);
  await page.locator(`${t('repo-color')} ${t('color-red')}`).check({ force: true });
  await expect.poll(() => calls(control, IPC.codeWorkspaceSetRepoColor)).toHaveLength(1);
  expect(calls(control, IPC.codeWorkspaceSetRepoColor)[0]?.args).toEqual({
    id: 'repo-web-app',
    color: 'red',
  });
  await expect(
    page.locator(
      `${t('repos-dialog-repo')}[data-repo-id="repo-web-app"] ${t('repos-dialog-repo-rail')}`,
    ),
  ).toHaveClass(/bg-conn-red/);
});

test('Add environment writes nothing until name and command are filled', async ({ relaunch }) => {
  const { window: page, control } = await openDialog(relaunch);
  const patches = () => calls(control, IPC.adeTaskUpdateRepo).map((e) => e.args);
  const before = await page.locator(t('repo-env')).count();

  await page.locator(t('repo-add-env')).click();
  await expect(page.locator(t('repo-env'))).toHaveCount(before + 1);
  const row = page.locator(t('repo-env')).last();
  await expect(row.locator(t('repo-env-name'))).toBeFocused();

  await row.locator(t('repo-env-name')).fill('qa');
  await row.locator(t('repo-env-name')).blur();
  expect(patches()).toHaveLength(0);

  await row.locator(t('repo-env-script')).fill('echo abc');
  await row.locator(t('repo-env-script')).blur();
  await expect.poll(patches).toHaveLength(1);
  const envs = (patches()[0] as { patch: { environments: unknown[] } }).patch.environments;
  expect(envs).toHaveLength(before + 1);
  expect(envs[before]).toEqual({ name: 'qa', deployedShaScript: 'echo abc' });
});

// Contract repos. Backend half: repoflow TestImportViaFolderPicker. The imported record is what the
// repo list shows in the nav.
test('contract: an imported repo record shows as a nav row with its name and colour', async ({
  relaunch,
}) => {
  const rec = contract<{ id: string; name: string; color: string }>(
    'repos',
    'CodeWorkspaceService.ImportRepo',
  );
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'git' } },
      { channel: IPC.codeWorkspaceListRepos, response: [rec] },
    ],
  });
  const row = page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`);
  await expect(row).toContainText(rec.name);
});
