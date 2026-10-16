import { expect, test } from '../ui/fixtures';
import { adeBoard, openPlan } from '../ui/support/adeV2';
import { contract } from '../ui/support/contract';
import { IPC } from '../ui/support/ipcChannels';

// P287: the run line's sandbox popover with denials (contract ade-sandbox, key denied).

type Wire = Record<string, unknown>;

test('run sandbox popover with denials', async ({ relaunch }) => {
  const run = contract<Wire>('ade-sandbox', 'AdeTaskService.Run#denied');
  const detail = contract<{ denials: Wire[] } & Wire>(
    'ade-sandbox',
    'AdeTaskService.RunSandbox#denied',
  );
  const board = adeBoard((b) => {
    const bill = b.tasks.find((x) => x.id === 'T_bill');
    if (!bill) throw new Error('fixture task missing');
    bill.runs = bill.runs.map((r) =>
      r.id === 'r_T_bill_impl_b_billdash' ? { ...r, sandbox: run.sandbox } : r,
    );
  });
  const { window } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
    {
      channel: IPC.adeTaskRunSandbox,
      response: {
        ...detail,
        profile: '(version 1)\n(allow default)',
        denials: detail.denials.map((d) => ({ ...d, at: 1_790_036_400_000 })),
      },
    },
  ]);
  await window.setViewportSize({ width: 1400, height: 900 });
  await window
    .locator('[data-testid="ade-card"][data-task-id="T_bill"] [data-testid="ade-card-head"]')
    .click();
  await window
    .locator(
      '[data-testid="ade-run-line"][data-branch-id="b_billdash"] [data-testid="ade-run-sandbox"]',
    )
    .click();
  await expect(window.locator('[data-testid="ade-run-sandbox-denial"]')).toHaveCount(1);
  await expect(window.locator('[data-testid="ade-run-sandbox-popover"]')).toHaveScreenshot(
    'sandbox-popover.png',
  );
});
