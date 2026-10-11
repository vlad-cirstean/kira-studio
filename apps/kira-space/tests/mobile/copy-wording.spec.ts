import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';

// Catalog wording on the phone: the take over confirm, the backlog empty state, the pairing screen.

const t = (id: string) => `[data-testid="${id}"]`;

interface BoardFx {
  tasks: { runs: { id: string; state: string }[] }[];
}

function stuckBoard(): BoardFx {
  const board = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/ade-v2/board.json'), 'utf8'),
  ) as BoardFx;
  for (const task of board.tasks) {
    for (const run of task.runs) if (run.id.startsWith('r_T_bill_impl_')) run.state = 'stuck';
  }
  return board;
}

test('the pairing screen titles itself with the product name', async ({ page, app }) => {
  await app();
  await expect(page.locator(t('pair-screen')).getByRole('heading', { level: 1 })).toHaveText(
    'Kira Space',
  );
  await expect(page.locator(t('pair-request'))).toHaveText('Request access');
});

test('an empty backlog explains where items come from', async ({ page, app, server }) => {
  server.state.auth = 'ok';
  server.state.replies.backlog = { items: [] };
  await app();
  await page.locator(t('tab-backlog')).click();
  const empty = page.locator(t('backlog-empty'));
  await expect(empty).toContainText('No backlog items yet');
  await expect(empty).toContainText('Items added here or in Kira Space appear here.');
});

test.describe('with write access', () => {
  test.beforeEach(async ({ app, server }) => {
    server.state.auth = 'ok';
    server.state.permissions = { write: true, agentInput: true };
    server.state.replies.board = stuckBoard();
    await app();
  });

  test('take over asks with a title, an explanation and Take over / Cancel buttons', async ({
    page,
  }) => {
    await page.locator(t('needs-take-over')).first().click();
    const dialog = page.locator(t('confirm-dialog'));
    await expect(dialog).toContainText('Take over run?');
    await expect(dialog).toContainText(
      'Taking over stops the background run and continues it in Claude Code on your computer.',
    );
    await expect(page.locator(t('confirm-yes'))).toHaveText('Take over');
    await expect(page.locator(t('confirm-cancel'))).toHaveText('Cancel');
  });
});
