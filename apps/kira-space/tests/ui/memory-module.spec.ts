import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

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
      sourceRef: null,
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
      sourceRef: null,
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

function modeTab(page: Page, mode: 'git' | 'automations' | 'ade' | 'memory') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openMemory(page: Page): Promise<void> {
  await modeTab(page, 'memory').click();
  await expect(modeTab(page, 'memory')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-strip"]')).toHaveCount(0);
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

test('Add memory: free text, a challenge shows questions, resubmit sends clarifications, stored lists outcomes', async ({
  relaunch,
}) => {
  const item = {
    fact: 'it uses port 8080 and deploys on Fridays',
    reason: 'Stated by the user, added manually in the Memory module.',
  };
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
              reason: item.reason,
              action: 'add',
              id: 'm9',
              lineageId: 'm9',
              version: 1,
              previousId: '',
              why: '',
              error: '',
            },
            {
              fact: 'billing-api deploys on Fridays',
              reason: item.reason,
              action: 'noop',
              id: 'm10',
              lineageId: 'm10',
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
  await dialog.locator('[data-testid="add-memory-text"]').fill(item.fact);
  await dialog.locator('[data-testid="add-memory-submit"]').click();

  await expect(dialog.locator('[data-testid="add-memory-challenge"]')).toContainText(
    answer.question,
  );
  await dialog.locator('[data-testid="add-memory-answer"]').fill(answer.answer);
  await dialog.locator('[data-testid="add-memory-submit"]').click();

  await expect(dialog.locator('[data-testid="add-memory-outcome-0"]')).toHaveText('Added');
  await expect(dialog.locator('[data-testid="add-memory-outcome-1"]')).toHaveText('Already known');
  const stores = control.log().filter((e) => e.channel === IPC.memoryStore);
  expect(stores).toHaveLength(2);
  expect(stores[1]?.args).toMatchObject({ clarifications: [answer] });

  await dialog.locator('[data-testid="add-memory-done"]').click();
  await expect(dialog).toHaveCount(0);
});

test('module hosts no setup; hints open Settings > Memory', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.memoryRecent, response: [] },
      {
        channel: IPC.memorySemanticStatus,
        response: { state: 'notInstalled', message: '', model: '', done: 0, total: 0 },
      },
    ],
  });
  await openMemory(page);

  await expect(page.locator('[data-testid="memory-connect"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="memory-setup-hint-semantic"]')).toBeVisible();
  await expect(page.locator('[data-testid="memory-setup-hint-claude"]')).toBeVisible();
  await page.locator('[data-testid="memory-open-settings"]').first().click();
  await expect(page.locator('[data-testid="memory-semantic"]')).toBeVisible();
});

// Contract memory + restart. Backend halves: memoryflow TestStoreThroughGate (stored, found by
// search) and journeyflow TestRestartKeepsUserData (same list after a relaunch).
for (const [scenario, key] of [
  ['memory', 'MemoryService.Recent#gated'],
  ['restart', 'MemoryService.Recent#after-restart'],
] as const) {
  test(`contract: ${scenario} Recent list shows every stored fact`, async ({ relaunch }) => {
    const recent = contract<{ id: string; fact: string }[]>(scenario, key);
    const { window: page } = await relaunch({
      control: [{ channel: IPC.memoryRecent, response: recent }],
    });
    await openMemory(page);
    await expect(page.locator('[data-testid^="memory-row-"]')).toHaveCount(recent.length);
    for (const m of recent) {
      await expect(page.locator(`[data-testid="memory-row-${m.id}"]`)).toContainText(m.fact);
    }
  });
}

test('contract: a search hit lists the fact found by its gate keyword', async ({ relaunch }) => {
  const hits = contract<{ id: string; fact: string }[]>(
    'memory',
    'MemoryService.Search#postgresql',
  );
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.memoryRecent, response: [] },
      { channel: IPC.memorySearch, response: hits },
    ],
  });
  await openMemory(page);
  await page.locator('[data-testid="memory-search"]').fill('postgresql');
  await expect(page.locator('[data-testid^="memory-row-"]')).toHaveCount(hits.length);
  await expect(page.locator(`[data-testid="memory-row-${hits[0]?.id}"]`)).toContainText(
    hits[0]?.fact ?? '',
  );
});
