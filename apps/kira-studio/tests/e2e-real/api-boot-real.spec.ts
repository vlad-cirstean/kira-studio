import { expect, test } from './fixtures';

// P232 smoke: the flow-server fixture, serverEnv and the shared bound() helper work end to end.
// Seeds an environment through the bound surface, sends a request from the UI to a real local
// server, and checks both the response pane and what the server recorded.

interface Created {
  id: string;
}

test('API send resolves an environment variable against a real server', async ({
  kira,
  flowServers,
}) => {
  const env = await kira.call<Created>('VariablesService', 'CreateEnvironment', {
    name: 'Flow',
    description: '',
    color: 'blue',
  });
  await kira.call('VariablesService', 'Upsert', {
    scope: 'environment',
    ownerId: env.id,
    id: '',
    name: 'base',
    value: flowServers.http,
    isSecret: false,
    description: '',
  });
  await kira.call('VariablesService', 'SetActiveEnvironment', { id: env.id });
  await kira.window.reload();
  await kira.window.waitForSelector('[data-testid="status-bar"]');

  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="new-request-start"]');
  await page.fill('[data-testid="http-url"]', '{{base}}/echo?from=ui');
  await page.click('[data-testid="http-send"]');

  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');
  const seen = (await flowServers.requests()).filter((r) => r.path === '/echo');
  expect(seen).toHaveLength(1);
  expect(seen[0].query).toBe('from=ui');
});
