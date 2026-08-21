import { expect, test } from './fixtures';
import { api } from './support/api';

// Connection CRUD, colors, URI round-trip — no database needed, never skips (P1 §12b).

test('create a connection via the dialog; persists across relaunch; never leaks a password', async ({
  kira,
  relaunch,
}) => {
  let { window } = kira;

  await window.click('[data-testid="new-connection"]');
  await expect(window.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await window.fill('[data-testid="connection-name"]', 'Local PG');
  await window.screenshot({ path: 'test-results/screenshots/connection-dialog.png' });
  await window.click('[data-testid="connection-save"]');
  await expect(window.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const row = window.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Local PG');
  await expect(row).toHaveAttribute('data-status', 'disconnected');

  // D9, asserted not eyeballed: the list never carries a password field.
  const list = await api.connectionsList(window);
  expect(list).toHaveLength(1);
  for (const record of list) {
    expect(Object.keys(record as Record<string, unknown>)).not.toContain('password');
  }

  ({ window } = await relaunch());
  const persisted = window.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(persisted).toHaveCount(1);
  await expect(persisted).toContainText('Local PG');
});

test('fields → URI regenerates the URI; an exotic multi-host URI refuses to leave URI mode', async ({
  kira,
}) => {
  const { window } = kira;

  await window.click('[data-testid="new-connection"]');
  await window.fill('[data-testid="connection-name"]', 'URI PG');
  await window.fill('[data-testid="connection-host"]', 'db.example.com');
  await window.fill('[data-testid="connection-port"]', '5432');
  await window.fill('[data-testid="connection-database"]', 'mydb');
  await window.fill('[data-testid="connection-user"]', 'alice');

  await window.click('[data-testid="connection-mode-uri"]');
  await expect(window.locator('[data-testid="connection-uri"]')).toHaveValue(
    'postgres://alice@db.example.com:5432/mydb',
  );

  await window.fill('[data-testid="connection-uri"]', 'postgres://u:p@a.example,b.example/db');
  await window.click('[data-testid="connection-mode-fields"]');
  // stays in URI mode (never silently drops the multi-host info)
  await expect(window.locator('[data-testid="connection-mode-uri"]')).toHaveClass(/active/);
});

test('a URI-mode save strips the password from the list; reveal returns it', async ({ kira }) => {
  const { window } = kira;

  await window.click('[data-testid="new-connection"]');
  await window.fill('[data-testid="connection-name"]', 'Secret PG');
  await window.click('[data-testid="connection-mode-uri"]');
  await window.fill('[data-testid="connection-uri"]', 'postgres://u:s3cret@h.example:5432/db');
  await window.click('[data-testid="connection-save"]');
  await expect(window.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const list = await api.connectionsList(window);
  expect(list).toHaveLength(1);
  expect(list[0].uri).not.toContain('s3cret');

  const revealed = await api.connectionsReveal(window, list[0].id);
  expect(revealed.password).toBe('s3cret');
});

test('duplicate and delete through the context menu', async ({ kira }) => {
  const { window } = kira;
  window.on('dialog', (dialog) => dialog.accept());

  await window.click('[data-testid="new-connection"]');
  await window.fill('[data-testid="connection-name"]', 'Dup Me');
  await window.click('[data-testid="connection-save"]');
  await expect(window.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const rows = () => window.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(rows()).toHaveCount(1);

  await rows().first().click({ button: 'right' });
  await expect(window.locator('[data-testid="context-menu"]')).toBeVisible();
  await window.click('[data-testid="menu-item-duplicate"]');
  await expect(rows()).toHaveCount(2);

  await rows().first().click({ button: 'right' });
  await window.click('[data-testid="menu-item-delete"]');
  await expect(rows()).toHaveCount(1);
});
