import { expect, test } from './fixtures';

// P232 A: a secret-bearing request sent from the UI against a real server. The secret reaches the
// wire resolved, and never lands in the op log or the history row.

interface Created {
  id: string;
}

interface OpRecord {
  command?: string;
}

test('UI send resolves a secret on the wire, history lists it, op log keeps the placeholder', async ({
  kira,
  flowServers,
}) => {
  const env = await kira.call<Created>('VariablesService', 'CreateEnvironment', {
    name: 'Flow',
    description: '',
    color: 'blue',
  });
  const upsert = (name: string, value: string, isSecret: boolean) =>
    kira.call('VariablesService', 'Upsert', {
      scope: 'environment',
      ownerId: env.id,
      id: '',
      name,
      value,
      isSecret,
      description: '',
    });
  await upsert('base', flowServers.http, false);
  await upsert('token', 'sekret-value-9f3a', true);
  await kira.call('VariablesService', 'SetActiveEnvironment', { id: env.id });
  await kira.window.reload();
  await kira.window.waitForSelector('[data-testid="status-bar"]');

  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="new-request-start"]');
  await page.fill('[data-testid="http-url"]', '{{base}}/echo?t={{token}}');
  await page.click('[data-testid="http-send"]');

  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');
  const seen = (await flowServers.requests()).filter((r) => r.path === '/echo');
  expect(seen).toHaveLength(1);
  expect(seen[0].query).toBe('t=sekret-value-9f3a');

  await page.click('[data-testid="http-response-pane-history"]');
  await expect(page.locator('[data-testid="http-history-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="http-history-row"]')).not.toContainText(
    'sekret-value-9f3a',
  );

  await expect
    .poll(async () => {
      const ops = await kira.call<OpRecord[]>('OpsService', 'Recent', { limit: 20 });
      return JSON.stringify(ops);
    })
    .toContain('{{token}}');
  const ops = await kira.call<OpRecord[]>('OpsService', 'Recent', { limit: 20 });
  expect(JSON.stringify(ops)).not.toContain('sekret-value-9f3a');
});
