import { expect, test } from './fixtures';

// SIGKILL and respawn on the same KIRA_HOME: API environments and the active one are read back from
// SQLite, the way a crash-and-relaunch would.
test('environments and the active one survive a killed and relaunched server', async ({
  kira,
  flowServers,
}) => {
  const env = await kira.call<{ id: string }>('VariablesService', 'CreateEnvironment', {
    name: 'Persisted',
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

  await kira.relaunch();

  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="new-request-start"]');
  await page.fill('[data-testid="http-url"]', '{{base}}/echo?after=relaunch');
  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');
  const seen = (await flowServers.requests()).filter((r) => r.path === '/echo');
  expect(seen).toHaveLength(1);
  expect(seen[0].query).toBe('after=relaunch');
});
