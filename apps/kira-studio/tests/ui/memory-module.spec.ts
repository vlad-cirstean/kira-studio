import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab } from './support/apiMode';
import { IPC } from './support/ipcChannels';

// P201: the Memory module against a mocked bridge — search, history flags, the version trail, the
// Add memory challenge/resubmit flow and the Connect dialog.

function memory(over: Record<string, unknown>) {
  return {
    id: 'm1',
    lineageId: 'm1',
    version: 1,
    fact: 'The billing API listens on port 9090.',
    reason: 'Manifest changed in March.',
    keywords: ['billing', 'port'],
    author: 'user',
    status: 'current',
    historical: false,
    supersedesId: null,
    supersededById: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    supersededAt: null,
    versions: 1,
    ...over,
  };
}

const CURRENT = memory({
  id: 'm2',
  lineageId: 'm1',
  version: 2,
  versions: 2,
  supersedesId: 'm1',
  author: 'agent',
});
const OLD = memory({
  id: 'm1',
  fact: 'The billing API listens on port 8080.',
  status: 'superseded',
  historical: true,
  supersededById: 'm2',
  supersededAt: '2026-03-02T10:00:00.000Z',
});

const HISTORY = {
  memories: [OLD, CURRENT],
  events: [
    {
      seq: 1,
      requestId: 'r1',
      source: 'ui',
      action: 'add',
      lineageId: 'm1',
      memoryId: 'm1',
      previousId: null,
      author: 'user',
      rationale: 'No related memory.',
      createdAt: OLD.createdAt,
    },
    {
      seq: 2,
      requestId: 'r2',
      source: 'mcp',
      action: 'update',
      lineageId: 'm1',
      memoryId: 'm2',
      previousId: 'm1',
      author: 'agent',
      rationale: 'Port corrected.',
      createdAt: CURRENT.createdAt,
    },
  ],
};

const BASE: ControlSnapshot[] = [
  { channel: IPC.memoryRecent, response: [CURRENT] },
  {
    channel: IPC.memorySearch,
    args: { query: 'billing', includeHistory: false },
    response: [CURRENT],
  },
  {
    channel: IPC.memorySearch,
    args: { query: 'billing', includeHistory: true },
    response: [CURRENT, OLD],
  },
  { channel: IPC.memoryHistory, response: HISTORY },
];

type Page = import('@playwright/test').Page;

async function openMemory(page: Page): Promise<void> {
  await modeTab(page, 'memory').click();
  await expect(modeTab(page, 'memory')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();
}

test('Memory mode lists recent memories, searches, and flags history', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: BASE });
  await openMemory(page);

  const rows = page.locator('[data-testid^="memory-row-"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('port 9090');
  await expect(rows.first()).toContainText('agent');
  await expect(page.locator('[data-testid="memory-detail-empty"]')).toBeVisible();

  await page.locator('[data-testid="memory-search"]').fill('billing');
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.memorySearch).length)
    .toBeGreaterThan(0);

  await page.locator('[data-testid="memory-include-history"]').click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="memory-row-m1"]')).toContainText('historical');
  await expect(page.locator('[data-testid="memory-row-m2"]')).not.toContainText('historical');
});

test('selecting a memory shows its reason and version trail', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: BASE });
  await openMemory(page);

  await page.locator('[data-testid="memory-row-m2"]').click();
  const detail = page.locator('[data-testid="memory-detail"]');
  await expect(detail).toContainText('Manifest changed in March.');
  const trail = page.locator('[data-testid="memory-trail"]');
  await expect(trail.locator('[data-testid="memory-version-1"]')).toContainText('historical');
  await expect(trail.locator('[data-testid="memory-version-2"]')).toContainText('Port corrected.');
});

test('Add memory: a challenge shows questions, resubmit sends clarifications, stored lists outcomes', async ({
  relaunch,
}) => {
  const item = { fact: 'it uses port 8080', reason: 'because' };
  const answer = { question: 'Which service?', answer: 'billing-api' };
  const { window: page, control } = await relaunch({
    control: [
      ...BASE,
      {
        channel: IPC.memoryStore,
        args: { items: [item], clarifications: [] },
        response: {
          status: 'challenged',
          challenges: [{ index: 0, fact: item.fact, questions: [answer.question] }],
          outcomes: [],
        },
      },
      {
        channel: IPC.memoryStore,
        args: { items: [item], clarifications: [answer] },
        response: {
          status: 'stored',
          challenges: [],
          outcomes: [
            {
              fact: 'billing-api uses port 8080',
              reason: 'because',
              action: 'add',
              id: 'm9',
              lineageId: 'm9',
              version: 1,
              previousId: '',
              why: '',
              error: '',
            },
          ],
        },
      },
    ],
  });
  await openMemory(page);

  await page.locator('[data-testid="memory-add"]').click();
  const dialog = page.locator('[data-testid="add-memory-dialog"]');
  await dialog.locator('[data-testid="add-memory-fact"]').fill(item.fact);
  await dialog.locator('[data-testid="add-memory-reason"]').fill(item.reason);
  await dialog.locator('[data-testid="add-memory-submit"]').click();

  await expect(dialog.locator('[data-testid="add-memory-challenge"]')).toContainText(
    answer.question,
  );
  await dialog.locator('[data-testid="add-memory-answer"]').fill(answer.answer);
  await dialog.locator('[data-testid="add-memory-submit"]').click();

  await expect(dialog.locator('[data-testid="add-memory-outcome-0"]')).toHaveText('Added');
  const stores = control.log().filter((e) => e.channel === IPC.memoryStore);
  expect(stores).toHaveLength(2);
  expect(stores[1]?.args).toMatchObject({ clarifications: [answer] });

  await dialog.locator('[data-testid="add-memory-done"]').click();
  await expect(dialog).toHaveCount(0);
});

test('Connect Claude Code shows the registration command', async ({ relaunch }) => {
  const command =
    "claude mcp remove --scope user 'kira-memory' 2>/dev/null; claude mcp add-json --scope user 'kira-memory' '{}'";
  const { window: page } = await relaunch({
    control: [
      ...BASE,
      {
        channel: IPC.memoryMcpStatus,
        response: {
          command,
          executable: '/Applications/Kira Studio',
          claudeAvailable: true,
          probed: [],
        },
      },
      {
        channel: IPC.memoryMcpInstall,
        response: { outcome: 'installed', detail: '', probed: [] },
      },
    ],
  });
  await openMemory(page);

  await page.locator('[data-testid="memory-connect"]').click();
  await expect(page.locator('[data-testid="memory-mcp-command"]')).toContainText('kira-memory');
  await page.locator('[data-testid="memory-mcp-install"]').click();
  await expect(page.locator('[data-testid="memory-mcp-install-outcome"]')).toContainText(
    'Registered',
  );
});
