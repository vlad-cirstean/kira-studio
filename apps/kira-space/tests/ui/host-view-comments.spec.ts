import { expect } from '@playwright/test';
import {
  azureTarget,
  calls,
  composeForge,
  composeGitHub,
  discardSnap,
  githubTarget,
  hostViewControl,
  issueCompose,
  issueControl,
  postedOk,
  postSnap,
  postUnavailable,
  sendFiles,
  stagedPng,
  stageSnap,
  t,
  hostViewTest as test,
} from './support/hostView';
import { IPC } from './support/ipcChannels';

// UI half of githostflow/comments_test.go: the Go flows write tests/contract/host-view-comments.json
// (compose capabilities, staged attachment, post results); this spec drives the composer with them.

const COMPOSER = '[data-testid="comment-composer"]';
const forge = (post = postSnap(postedOk)) =>
  hostViewControl(azureTarget, composeForge, [stageSnap(), discardSnap(), post]);

test('post shows the comment pending at once, then clears the draft', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge(postSnap(postedOk, true)) });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  await composer.locator(t('comment-body')).fill('Looks good');
  await composer.locator(t('comment-post')).click();
  const pending = page.locator('[data-pending]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('Looks good');
  await expect(composer.locator(t('comment-post'))).toBeDisabled();
  control.release(IPC.hostViewPostComment);
  await expect(composer.locator(t('comment-body'))).toHaveValue('');
  const [post] = calls(control, IPC.hostViewPostComment);
  expect(post?.args).toMatchObject({ body: 'Looks good', replyTo: '', attachmentIds: [] });
});

test('a failed post keeps the text, shows the reason and retries', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge(postSnap(postUnavailable)) });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  await composer.locator(t('comment-body')).fill('Looks good');
  await composer.locator(t('comment-post')).click();
  await expect(composer.locator(t('comment-error'))).toContainText('no such thread');
  await expect(composer.locator(t('comment-body'))).toHaveValue('Looks good');
  await expect(page.locator('[data-pending]')).toHaveCount(0);
  await expect(composer.locator(t('comment-post'))).toBeEnabled();
  await composer.locator(t('comment-post')).click();
  await expect.poll(() => calls(control, IPC.hostViewPostComment)).toHaveLength(2);
});

test('dropping a file stages it and posts its id', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge() });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  await sendFiles(page, `${t('host-view-compose')} ${COMPOSER}`, 'drop', [
    { name: 'shot.png', mime: 'image/png', bytes: 70 },
  ]);
  const row = composer.locator(t('comment-attachment'));
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-state', 'ready');
  await expect(row).toContainText('shot.png');
  const [stage] = calls(control, IPC.hostViewStageAttachment);
  expect(stage?.args).toMatchObject({ name: 'shot.png' });
  await composer.locator(t('comment-post')).click();
  await expect.poll(() => calls(control, IPC.hostViewPostComment)).toHaveLength(1);
  const args = calls(control, IPC.hostViewPostComment)[0]?.args as { attachmentIds: string[] };
  expect(args.attachmentIds).toEqual([stagedPng.id]);
});

test('the file picker stages a file and Remove discards it', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge() });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  const chooser = page.waitForEvent('filechooser');
  await composer.locator(t('comment-attach')).click();
  await (await chooser).setFiles({
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(70),
  });
  const row = composer.locator(t('comment-attachment'));
  await expect(row).toHaveAttribute('data-state', 'ready');
  await row.locator(t('comment-attachment-remove')).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => calls(control, IPC.hostViewDiscardAttachment)).toHaveLength(1);
  expect(calls(control, IPC.hostViewDiscardAttachment)[0]?.args).toMatchObject({
    id: stagedPng.id as string,
  });
});

test('pasting a file stages it', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: forge() });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  await sendFiles(page, `${t('host-view-compose')} ${t('comment-body')}`, 'paste', [
    { name: 'shot.png', mime: 'image/png', bytes: 70 },
  ]);
  await expect(composer.locator(t('comment-attachment'))).toHaveAttribute('data-state', 'ready');
});

test('client limits refuse a file without staging it', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge() });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  const sel = `${t('host-view-compose')} ${COMPOSER}`;
  await sendFiles(page, sel, 'drop', [
    { name: 'run.exe', mime: 'application/x-msdownload', bytes: 8 },
  ]);
  await expect(composer.locator(t('comment-notice'))).toContainText('run.exe');
  await sendFiles(page, sel, 'drop', [
    { name: 'big.zip', mime: 'application/zip', bytes: 10 * 1024 * 1024 + 1 },
  ]);
  await expect(composer.locator(t('comment-notice'))).toContainText('big.zip');
  expect(calls(control, IPC.hostViewStageAttachment)).toHaveLength(0);
  await expect(composer.locator(t('comment-attachment'))).toHaveCount(0);
});

test('GitHub states why attachments are unavailable', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: hostViewControl(githubTarget, composeGitHub, [stageSnap(), postSnap(postedOk)]),
  });
  const composer = page.locator(`${t('host-view-compose')} ${COMPOSER}`);
  await sendFiles(page, `${t('host-view-compose')} ${COMPOSER}`, 'drop', [
    { name: 'shot.png', mime: 'image/png', bytes: 70 },
  ]);
  await expect(composer.locator(t('comment-notice'))).toContainText('GitHub has no API');
  await expect(composer.locator(t('comment-attachment'))).toHaveCount(0);
  expect(calls(control, IPC.hostViewStageAttachment)).toHaveLength(0);
});

test('Reply posts into the thread and only on reply kinds', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: forge() });
  const threads = page.locator(t('host-view-thread'));
  await threads.nth(0).locator(t('host-view-thread-reply')).click();
  const composer = threads.nth(0).locator(COMPOSER);
  await composer.locator(t('comment-body')).fill('Agreed');
  await composer.locator(t('comment-post')).click();
  await expect.poll(() => calls(control, IPC.hostViewPostComment)).toHaveLength(1);
  expect(calls(control, IPC.hostViewPostComment)[0]?.args).toMatchObject({
    body: 'Agreed',
    replyTo: 't1',
  });
});

test('GitHub offers Reply on code threads only', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: hostViewControl(githubTarget, composeGitHub, [postSnap(postedOk)]),
  });
  const threads = page.locator(t('host-view-thread'));
  await expect(threads.nth(0).locator(t('host-view-thread-reply'))).toHaveCount(0);
  await expect(page.locator(t('host-view-thread-reply'))).toHaveCount(1);
});

test('an issue window posts a comment without attachments', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: issueControl(issueCompose, [postSnap(postedOk)]),
  });
  const composer = page.locator(`${t('issue-compose')} ${COMPOSER}`);
  await expect(composer.locator(t('comment-attach'))).toBeDisabled();
  await composer.locator(t('comment-body')).fill('Done in 1.2');
  await composer.locator(t('comment-post')).click();
  await expect.poll(() => calls(control, IPC.hostViewPostComment)).toHaveLength(1);
  expect(calls(control, IPC.hostViewPostComment)[0]?.args).toMatchObject({ body: 'Done in 1.2' });
});

test('a drop outside the composer leaves the page in place', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: forge() });
  const url = page.url();
  const prevented = await page.evaluate(() => {
    const ev = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(page.url()).toBe(url);
});

test('the draft survives a reload', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: forge() });
  const body = page.locator(`${t('host-view-compose')} ${t('comment-body')}`);
  await body.fill('half written');
  await page.reload();
  await expect(page.locator(`${t('host-view-compose')} ${t('comment-body')}`)).toHaveValue(
    'half written',
  );
});
