import { expect, test } from './fixtures';
import { adeFixture, adeV2Control, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// The Repos page: watched folders, the repo list and the per-repo settings.

interface ReposFx {
  repos: { codeRepoId: string; nickname: string }[];
  folders: { path: string; watch: boolean }[];
}

const t = (id: string) => `[data-testid="${id}"]`;

async function openRepos(relaunch: Parameters<typeof openPlan>[0]) {
  const app = await openPlan(relaunch);
  await app.window.locator(t('ade-tab-repos')).click();
  await app.window.locator(t('ade-repos')).waitFor();
  return app;
}

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

test('the repos page has no import inputs and opens the Git module dialog', async ({
  relaunch,
}) => {
  const { window: page } = await openRepos(relaunch);
  await expect(page.locator(t('ade-add-folder'))).toHaveCount(0);
  await expect(page.locator(t('ade-add-repo-path'))).toHaveCount(0);
  await page.locator(t('ade-repos-manage')).click();
  await expect(page.locator(t('repos-dialog'))).toBeVisible();
  await expect(page.locator(t('ade-view'))).toHaveCount(0);
});

const chooseFolder = {
  channel: IPC.filesChooseFolder,
  response: { canceled: false, path: '~/code/oss' },
};

async function openDialog(relaunch: Parameters<typeof openPlan>[0]) {
  const app = await openPlan(relaunch, [chooseFolder]);
  await app.window.locator(t('ade-tab-repos')).click();
  await app.window.locator(t('ade-repos-manage')).click();
  await app.window.locator(t('repos-dialog')).waitFor();
  return app;
}

test('dialog folders list, add, watch and remove send their args', async ({ relaunch }) => {
  const fx = adeFixture<ReposFx>('repos');
  const { window: page, control } = await openDialog(relaunch);
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
  const { window: page } = await openRepos(relaunch);
  await expect(page.locator(t('ade-repo-row'))).toHaveCount(fx.repos.length);
  await page.locator(t('ade-repo-row')).nth(1).click();
  await expect(page.locator(t('ade-repo-nick'))).toHaveValue(fx.repos[1]?.nickname ?? '');
});

test('nickname, prepare script and timeout edits send one-leaf patches', async ({ relaunch }) => {
  const { window: page, control } = await openRepos(relaunch);
  const nick = page.locator(t('ade-repo-nick'));
  await nick.fill('webby');
  await nick.press('Enter');
  await expect.poll(() => calls(control, IPC.adeTaskUpdateRepo)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateRepo)[0]?.args).toMatchObject({
    codeRepoId: 'repo-web-app',
    patch: { nickname: 'webby' },
  });

  const prepare = page.locator(t('ade-repo-prepare'));
  await prepare.fill('pnpm install');
  await prepare.blur();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateRepo)).toHaveLength(2);
  expect(calls(control, IPC.adeTaskUpdateRepo)[1]?.args).toMatchObject({
    patch: { prepareScript: 'pnpm install' },
  });

  const timeout = page.locator(t('ade-repo-timeout'));
  await timeout.fill('45m');
  await timeout.blur();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateRepo)).toHaveLength(3);
  expect(calls(control, IPC.adeTaskUpdateRepo)[2]?.args).toMatchObject({
    patch: { prepareTimeout: '45m' },
  });
});
