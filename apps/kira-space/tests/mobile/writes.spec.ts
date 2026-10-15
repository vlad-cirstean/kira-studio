import { contract } from '../ui/support/contract';
import { expect, test } from './fixtures';

// The phone's write paths against the scripted backend: what each tap sends, and how the app
// reacts to a refusal.

const t = (id: string) => `[data-testid="${id}"]`;

const posts = (server: { state: { requests: { method: string; path: string }[] } }, path: string) =>
  server.state.requests.filter((r) => r.method === 'POST' && r.path === path);

test.describe('with write access', () => {
  test.beforeEach(async ({ app, server }) => {
    server.state.auth = 'ok';
    server.state.permissions = { write: true, agentInput: false };
    await app();
  });

  test('contract: adding a backlog item sends it once with an idempotency key', async ({
    page,
    server,
  }) => {
    const args = contract<{ text: string }>('mobile-board', 'args:POST /api/ade/backlog/items');
    server.state.replies.backlogItem = contract('mobile-board', 'http:POST /api/ade/backlog/items');
    await page.locator(t('tab-backlog')).click();
    await page.locator(t('backlog-add')).fill(args.text);
    await page.locator(t('backlog-add-submit')).click();
    await expect(page.locator(t('backlog-add'))).toHaveValue('');
    const sent = posts(server, '/api/ade/backlog/items') as { body: string; key: string }[];
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual(args);
    expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('dragging a row by its handle sends where it landed', async ({ page, server }) => {
    await page.locator(t('tab-backlog')).click();
    const rows = page.locator(t('backlog-item'));
    await expect(rows).toHaveCount(4);
    const handle = await rows.nth(0).locator('[data-drag-handle]').boundingBox();
    const target = await rows.nth(2).boundingBox();
    if (!handle || !target) throw new Error('rows not laid out');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    // The sortable library samples pointer positions per frame: move in many small steps.
    await page.mouse.move(handle.x + 10, handle.y + 30, { steps: 10 });
    await page.mouse.move(target.x + 40, target.y + target.height * 0.75, { steps: 40 });
    await page.mouse.up();
    await expect.poll(() => posts(server, '/api/ade/backlog/move').length).toBe(1);
    const body = JSON.parse(
      (posts(server, '/api/ade/backlog/move')[0] as { body: string }).body,
    ) as { id: string; toIndex: number };
    expect(body.id).toBe('i1');
    expect(body.toIndex).toBeGreaterThan(0);
  });

  test('confirm buttons are at least 44px tall', async ({ page }) => {
    await page.locator(t('tab-plan')).click();
    const card = page
      .locator(t('plan-task'))
      .filter({ hasText: 'Cart total test fails intermittently' });
    await card.locator('button').first().click();
    await card.locator(t('plan-step-next')).click();
    for (const id of ['confirm-cancel', 'confirm-yes']) {
      const box = await page.locator(t(id)).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('Next asks first, then moves the task from the step the phone saw', async ({
    page,
    server,
  }) => {
    await page.locator(t('tab-plan')).click();
    const card = page
      .locator(t('plan-task'))
      .filter({ hasText: 'Cart total test fails intermittently' });
    await card.locator('button').first().click();
    await card.locator(t('plan-step-next')).click();
    await expect(page.locator(t('confirm-dialog'))).toBeVisible();
    expect(posts(server, '/api/ade/tasks/step')).toHaveLength(0);
    await page.locator(t('confirm-yes')).click();
    await expect.poll(() => posts(server, '/api/ade/tasks/step').length).toBe(1);
    const sent = posts(server, '/api/ade/tasks/step')[0] as { body: string; key: string };
    const body = JSON.parse(sent.body) as { taskId: string; fromStepId: string; stepId: string };
    expect(body.fromStepId).not.toBe(body.stepId);
    expect(sent.key).not.toBe('');
  });

  test('a stale move shows the server message and keeps the card', async ({ page, server }) => {
    server.state.failNext.set('/api/ade/tasks/step', {
      status: 409,
      code: 'E_CONFLICT',
      message: 'The task moved on the computer. Refresh and try again.',
    });
    await page.locator(t('tab-plan')).click();
    const card = page
      .locator(t('plan-task'))
      .filter({ hasText: 'Cart total test fails intermittently' });
    await card.locator('button').first().click();
    await card.locator(t('plan-step-next')).click();
    await page.locator(t('confirm-yes')).click();
    await expect(page.locator(t('confirm-dialog'))).toContainText('moved on the computer');
  });
});

test('without write access the controls are replaced by a hint', async ({ page, server, app }) => {
  server.state.auth = 'ok';
  server.state.permissions = { write: false, agentInput: false };
  await app();
  await page.locator(t('tab-backlog')).click();
  await expect(page.locator(t('permission-hint'))).toContainText(
    'turn on mobile access in the settings of Kira Space',
  );
  await expect(page.locator(t('backlog-add'))).toHaveCount(0);
  await page.locator(t('tab-plan')).click();
  await page
    .locator(t('plan-task'))
    .filter({ hasText: 'Cart total test fails intermittently' })
    .locator('button')
    .first()
    .click();
  await expect(page.locator(t('plan-step-next'))).toHaveCount(0);
});
