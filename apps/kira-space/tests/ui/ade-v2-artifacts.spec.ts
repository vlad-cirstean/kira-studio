import { expect, test } from './fixtures';
import { adeBoard, archivedTaskFx, openPlan, openTask } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// Task artifacts: the Artifacts tab, manual add and remove, gap warnings, the Done dialog list and
// the read-only archived tab. Contract ade-artifacts; backend half: flows/adeflow TestTaskArtifacts
// (artifacts_test.go).

const t = (id: string) => `[data-testid="${id}"]`;

interface ArtifactFx {
  id: string;
  kind: string;
  title: string;
  url: string;
  ref: string;
  status: string;
  repo: string;
  source: string;
  createdAt: number;
}
interface ResultFx {
  artifacts: ArtifactFx[];
  gaps: { source: string; repo: string }[];
}

const recorded = (key: string) => contract<ResultFx>('ade-artifacts', key);

/** Stored rows get distinct ids: the contract masks them. */
function withIds(res: ResultFx): ResultFx {
  return {
    ...res,
    artifacts: res.artifacts.map((a, i) => ({
      ...a,
      id: a.source === 'agent' || a.source === 'user' ? `a_${i}` : '',
    })),
  };
}

function snapshot(res: ResultFx): ControlSnapshot {
  return { channel: IPC.adeTaskArtifacts, response: res };
}

test('contract: the Artifacts tab lists every row with kind, status and source', async ({
  relaunch,
}) => {
  const res = withIds(recorded('AdeTaskService.Artifacts'));
  const { window: page, control } = await openPlan(relaunch, [snapshot(res)]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-panel-tab-artifacts')).click();
  await expect.poll(() => calls(control, IPC.adeTaskArtifacts)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskArtifacts)[0]?.args).toEqual({ taskId: 'T_alerts' });

  const rows = page.locator(t('ade-artifact-row'));
  await expect(rows).toHaveCount(res.artifacts.length);
  const pr = rows.filter({ hasText: 'Fix login' });
  await expect(pr).toContainText('Change request');
  await expect(pr).toContainText('Open');
  await expect(pr.locator(t('ade-artifact-source'))).toHaveText('Code host');
  const deployment = rows.filter({ hasText: 'prod' });
  await expect(deployment).toContainText('Deployed');
  await expect(deployment.locator(t('ade-artifact-source'))).toHaveText('Git');
  await expect(rows.filter({ hasText: 'KIRA-12' }).locator(t('ade-artifact-source'))).toHaveText(
    'Task',
  );
  await expect(
    rows.filter({ hasText: 'Preview env' }).locator(t('ade-artifact-source')),
  ).toHaveText('Agent');

  const stored = res.artifacts.filter((a) => a.id).length;
  await expect(page.locator(t('ade-artifact-remove'))).toHaveCount(stored);
  await expect(pr.locator(t('ade-artifact-remove'))).toHaveCount(0);
  await expect(page.locator(t('ade-artifact-gap'))).toHaveCount(0);
});

test('contract: Add sends AddArtifact with the form values', async ({ relaunch }) => {
  const sentKeys = Object.keys(
    contract<Record<string, unknown>>('ade-artifacts', 'args:AdeTaskService.AddArtifact'),
  );
  const { window: page, control } = await openPlan(relaunch, [
    snapshot(withIds(recorded('AdeTaskService.Artifacts'))),
  ]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-panel-tab-artifacts')).click();
  await page.locator(t('ade-artifact-add')).click();
  await expect(page.locator(t('ade-artifact-submit'))).toBeDisabled();
  await page.locator(t('ade-artifact-kind')).selectOption('link');
  await page.locator(t('ade-artifact-title-input')).fill('Runbook');
  await page.locator(t('ade-artifact-url-input')).fill('https://wiki.example/runbook');
  await page.locator(t('ade-artifact-submit')).click();
  await expect.poll(() => calls(control, IPC.adeTaskAddArtifact)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskAddArtifact)[0]?.args as Record<string, unknown>;
  expect(sent).toEqual({
    taskId: 'T_alerts',
    kind: 'link',
    title: 'Runbook',
    url: 'https://wiki.example/runbook',
    ref: '',
  });
  expect(Object.keys(sent).sort()).toEqual([...sentKeys].sort());
  await expect(page.locator(t('ade-artifact-form'))).toBeHidden();
});

test('contract: remove on a stored row sends RemoveArtifact; detected rows have no remove', async ({
  relaunch,
}) => {
  const sentKeys = Object.keys(
    contract<Record<string, unknown>>('ade-artifacts', 'args:AdeTaskService.RemoveArtifact'),
  );
  const res = withIds(recorded('AdeTaskService.Artifacts'));
  const { window: page, control } = await openPlan(relaunch, [snapshot(res)]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-panel-tab-artifacts')).click();
  const doc = page.locator(t('ade-artifact-row')).filter({ hasText: 'Design notes' });
  await doc.locator(t('ade-artifact-remove')).click();
  await expect.poll(() => calls(control, IPC.adeTaskRemoveArtifact)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskRemoveArtifact)[0]?.args as Record<string, unknown>;
  const id = res.artifacts.find((a) => a.title === 'Design notes')?.id;
  expect(sent).toEqual({ taskId: 'T_alerts', id });
  expect(Object.keys(sent).sort()).toEqual([...sentKeys].sort());
});

test('contract: a failed source shows a warning above the list', async ({ relaunch }) => {
  const res = withIds(recorded('AdeTaskService.Artifacts#gap'));
  expect(res.gaps).toHaveLength(1);
  const { window: page } = await openPlan(relaunch, [snapshot(res)]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-panel-tab-artifacts')).click();
  const gap = page.locator(t('ade-artifact-gap'));
  await expect(gap).toHaveCount(1);
  await expect(gap).toContainText(`Couldn’t read ${res.gaps[0]?.source} for ${res.gaps[0]?.repo}`);
  await expect(page.locator(t('ade-artifact-row'))).not.toHaveCount(0);
});

test('an empty task shows the hint', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [snapshot({ artifacts: [], gaps: [] })]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-panel-tab-artifacts')).click();
  await expect(page.locator(t('ade-artifact-empty'))).toBeVisible();
});

test('moving a task to Done lists its artifacts, read-only', async ({ relaunch }) => {
  const res = withIds(recorded('AdeTaskService.Artifacts'));
  const { window: page } = await openPlan(relaunch, [
    snapshot(res),
    { channel: IPC.adeTaskBoard, response: adeBoard(() => undefined) },
  ]);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-step-pick')).click();
  await page.locator(t('ade-step-option-done')).click();
  const dialog = page.locator(t('ade-stage-dialog'));
  await expect(dialog).toBeVisible();
  const list = dialog.locator(t('ade-stage-artifacts'));
  await expect(list.locator(t('ade-artifact-row'))).toHaveCount(res.artifacts.length);
  await expect(list.locator(t('ade-artifact-remove'))).toHaveCount(0);
  await expect(list.locator(t('ade-artifact-add'))).toHaveCount(0);
});

test('an archived task shows the tab read-only', async ({ relaunch }) => {
  const res = withIds(recorded('AdeTaskService.Artifacts#archived'));
  const { window: page } = await openPlan(relaunch, [
    snapshot(res),
    { channel: IPC.adeTaskArchivedTask, response: archivedTaskFx() },
  ]);
  await page.locator(t('ade-archived-find')).click();
  await page.locator(`${t('ade-archived-find-item')}[data-task-id="H_1"]`).click();
  await page.locator(t('ade-panel-tab-artifacts')).click();
  const rows = page.locator(t('ade-archived-artifacts')).locator(t('ade-artifact-row'));
  await expect(rows).toHaveCount(res.artifacts.length);
  await expect(page.locator(t('ade-artifact-add'))).toHaveCount(0);
  await expect(page.locator(t('ade-artifact-remove'))).toHaveCount(0);
});
