import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

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

test('folders list, add, watch and remove send their args', async ({ relaunch }) => {
  const fx = adeFixture<ReposFx>('repos');
  const { window: page, control } = await openRepos(relaunch);
  await expect(page.locator(t('ade-folder'))).toHaveCount(fx.folders.length);

  await page.locator(t('ade-add-folder')).fill('~/code/oss');
  await page.locator(t('ade-add-folder-go')).click();
  await expect.poll(() => calls(control, IPC.adeTaskAddFolder)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskAddFolder)[0]?.args).toEqual({
    path: '~/code/oss',
    watch: true,
  });

  await page.locator(t('ade-folder-watch')).first().click();
  await expect.poll(() => calls(control, IPC.adeTaskSetFolderWatch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetFolderWatch)[0]?.args).toEqual({
    path: fx.folders[0]?.path,
    watch: !fx.folders[0]?.watch,
  });

  await page.locator(t('ade-folder-remove')).first().click();
  await expect.poll(() => calls(control, IPC.adeTaskRemoveFolder)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRemoveFolder)[0]?.args).toEqual({ path: fx.folders[0]?.path });
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

test('+ Add repo imports the typed path', async ({ relaunch }) => {
  const { window: page, control } = await openRepos(relaunch);
  await page.locator(t('ade-add-repo-path')).fill('/tmp/new-repo');
  await page.locator(t('ade-add-repo-go')).click();
  await expect.poll(() => calls(control, IPC.codeWorkspaceImportRepo)).toHaveLength(1);
  expect(calls(control, IPC.codeWorkspaceImportRepo)[0]?.args).toEqual({ path: '/tmp/new-repo' });
});
