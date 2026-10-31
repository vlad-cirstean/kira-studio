import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';
import {
  bigTable,
  LONG_QUERY,
  openProofWindow,
  PENDING_ID,
  pendingSession,
  proofControl,
  SESSION_ID,
  sessions,
  stepSnapshot,
  viewState,
} from '../ui/support/proof';

// P420 Part 2: the proof window follows the review window's chrome; these baselines catch a
// layout or token drift in the three surfaces a reader sees.

const WINDOW = '[data-testid="proof-window"]';
const ready = (page: import('@playwright/test').Page) =>
  expect(page.locator('[data-testid="proof-step"][data-ready="true"]').first()).toBeVisible();

test('proof window, table step with a scrolled grid and a highlighted cell (P420)', async ({
  relaunch,
  uiServer,
}) => {
  const { window: page } = await relaunch({
    control: proofControl([
      stepSnapshot(SESSION_ID, 1, 1, 'table', { data: bigTable(), query: LONG_QUERY }),
      stepSnapshot(SESSION_ID, 1, 2, 'document'),
      stepSnapshot(SESSION_ID, 1, 3, 'keyvalue'),
      {
        channel: IPC.proofViewState,
        response: [
          viewState(1, {
            resultScrollTop: 600,
            resultScrollLeft: 60,
            selection: { kind: 'cell', row: 30, col: 2 },
          }),
        ],
      },
    ]),
  });
  await openProofWindow(page, uiServer.url);
  await ready(page);
  await expect(page.locator('.kira-cell-selected')).toHaveCount(1);
  await expect(page.locator(WINDOW)).toHaveScreenshot('proof-table-step.png');
});

test('proof window, document step with an expanded row (P420)', async ({ relaunch, uiServer }) => {
  const { window: page } = await relaunch({
    control: proofControl([
      stepSnapshot(SESSION_ID, 1, 1, 'table'),
      stepSnapshot(SESSION_ID, 1, 2, 'document', {
        data: {
          documents: [
            { id: 'doc-1', body: { a: { nested: true }, z: 1 } },
            { id: 'doc-2', body: { title: 'Second' } },
          ],
        },
      }),
      stepSnapshot(SESSION_ID, 1, 3, 'keyvalue'),
      {
        channel: IPC.proofViewState,
        response: [viewState(2, { expanded: ['doc-1'], selectedRow: 0 })],
      },
    ]),
  });
  await openProofWindow(page, uiServer.url);
  await page.locator('[data-testid="tab"]', { hasText: '#2' }).click();
  await ready(page);
  await expect(page.locator('[data-testid="console-result-doc-row"]').first()).toBeVisible();
  await expect(page.locator(WINDOW)).toHaveScreenshot('proof-document-step.png');
});

test('proof window, compare mode with a pending edit (P420)', async ({ relaunch, uiServer }) => {
  const pending = pendingSession();
  const summary = { ...sessions()[0], id: PENDING_ID, name: 'Edit me', pending: true };
  const steps = [
    ...['keep', 'replace', 'drop'].map((d, i) =>
      stepSnapshot(PENDING_ID, 1, i + 1, 'keyvalue', { description: d }),
    ),
    ...['keep', 'replaced', 'brand new'].map((d, i) =>
      stepSnapshot(PENDING_ID, 2, i + 1, 'keyvalue', { description: d }),
    ),
  ];
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.proofWindowTarget, response: { sessionId: PENDING_ID } },
      { channel: IPC.proofSessions, response: [summary] },
      { channel: IPC.proofSession, args: { sessionId: PENDING_ID }, response: pending },
      ...steps,
    ],
  });
  await openProofWindow(page, uiServer.url);
  await ready(page);
  await page.locator('[data-testid="proof-view-compare"]').click();
  await page.locator('[data-testid="tab"]', { hasText: '#2 replaced' }).click();
  await expect(page.locator('[data-testid="proof-compare"]')).toBeVisible();
  await ready(page);
  await expect(page.locator(WINDOW)).toHaveScreenshot('proof-compare-pending.png');
});
