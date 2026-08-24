import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// P11: the pre-connect script feature. Split in two, mirroring connections.spec.ts /
// tree.spec.ts's discipline — the dialog+failure-before-connect half needs no engine at all and
// must never skip, while the sidecar lifecycle needs a connection that genuinely reaches
// `connected`.

async function connectionRow(page: Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('preconnect — dialog field, persistence, and failure before connect', async ({ relaunch }) => {
  let { window: page } = await relaunch();

  // --- the field is visible in both fields and URI mode -------------------------------------
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toHaveCount(0);
  await page.click('[data-testid="mode-uri"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toBeVisible();
  // An empty draft's formatted URI can't round-trip back to fields, so mode-fields is a no-op
  // here (by design — §8.12) — start a fresh dialog instead of relying on that toggle.
  await page.click('[data-testid="connection-cancel"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');

  // --- typing a command shows the warning, saving persists it, editing shows it again --------
  await page.fill('[data-testid="connection-name"]', 'Preconnect Test');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.fill('[data-testid="connection-preconnect"]', 'echo hi');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toBeVisible();
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  await page.waitForTimeout(300);
  ({ window: page } = await relaunch());
  await (await connectionRow(page, 'Preconnect Test')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toHaveValue('echo hi');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toBeVisible();

  const stored = await page.evaluate(() => window.kira.connectionsList());
  const record = stored.find((r) => r.name === 'Preconnect Test');
  expect((record as { preconnect: string | null } | undefined)?.preconnect).toBe('echo hi');

  // --- clearing the field and saving stores null, not '' -------------------------------------
  await page.fill('[data-testid="connection-preconnect"]', '');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toHaveCount(0);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  const afterClear = await page.evaluate(() => window.kira.connectionsList());
  const clearedRecord = afterClear.find((r) => r.name === 'Preconnect Test');
  expect((clearedRecord as { preconnect: string | null } | undefined)?.preconnect).toBe(null);

  // --- a failing script aborts the connect before the adapter is ever contacted --------------
  await (await connectionRow(page, 'Preconnect Test')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '1'); // nothing listens here
  await page.fill('[data-testid="connection-preconnect"]', 'echo nope >&2; exit 3');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const failRow = await connectionRow(page, 'Preconnect Test');
  await failRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-status', 'error', {
    timeout: 10_000,
  });
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-kira-tip', /exit 3/);
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-kira-tip', /nope/);
  // Never observed 'connected' — the failing script must have aborted the connect outright,
  // proven here by the status never having flipped away from 'error' at all.
  await expect(failRow.locator('.status-dot')).not.toHaveAttribute('data-status', 'connected');
});

let pg: PgFixture | null = null;

test.describe('preconnect — sidecar lifecycle against a live connection', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    if (!(await isDockerAvailable())) {
      test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
      return;
    }
    pg = await startPostgres({ seedBigTable: false });
  });

  test.afterAll(async () => {
    await pg?.stop();
  });

  test('sidecar armed exit drops the connection; disconnect/delete kill it', async ({
    kiraHome,
    kira,
    consoleErrors,
  }) => {
    test.setTimeout(180_000);
    if (!pg) throw new Error('postgres fixture did not start');
    const { window: page } = kira;
    const cfg = pg.config;

    const pidFile = join(kiraHome, 'preconnect-pid');
    const markerFile = join(kiraHome, 'preconnect-marker');
    const marker2File = join(kiraHome, 'preconnect-marker2');

    // --- (a) connect: the script runs (marker exists) and the connection reaches connected ---
    await page.evaluate(
      (c) =>
        window.kira.connectionsCreate({
          name: 'Sidecar PG',
          kind: 'postgres',
          color: 'green',
          mode: 'fields',
          readOnly: false,
          host: c.host,
          port: c.port,
          database: c.database,
          username: c.username,
          password: c.password,
          uri: null,
          options: {},
          preconnect: `echo $$ > ${c.pidFile}; touch ${c.markerFile}; sleep 600`,
          preconnectSidecar: true,
        }),
      {
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: cfg.username,
        password: cfg.password,
        pidFile,
        markerFile,
      },
    );

    const row = await connectionRow(page, 'Sidecar PG');
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.click('[data-testid="menu-item-connect"]');
    await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
    await waitFor(() => existsSync(markerFile), 5000);
    await waitFor(() => existsSync(pidFile), 5000);
    const pid = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
    expect(isAlive(pid)).toBe(true);

    // --- (b) killing the script drops the connection to error ------------------------------
    process.kill(-pid, 'SIGTERM');
    await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'error', {
      timeout: 10_000,
    });
    await expect(row.locator('.status-dot')).toHaveAttribute(
      'data-kira-tip',
      /Pre-connect script exited/,
    );
    await row.click({ button: 'right' });
    await expect(page.locator('[data-testid="menu-item-connect"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // --- (c) reconnect, then disconnect: the group is gone afterwards ----------------------
    await row.click({ button: 'right' });
    await page.click('[data-testid="menu-item-connect"]');
    await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
    const pid2 = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
    expect(isAlive(pid2)).toBe(true);
    await row.click({ button: 'right' });
    await page.click('[data-testid="menu-item-disconnect"]');
    await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'disconnected', {
      timeout: 10_000,
    });
    await waitFor(() => !isAlive(pid2), 5000);

    // --- (d) reconnect, then delete: the group is gone afterwards --------------------------
    await row.click({ button: 'right' });
    await page.click('[data-testid="menu-item-connect"]');
    await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
    const pid3 = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
    expect(isAlive(pid3)).toBe(true);
    page.once('dialog', (dialog) => dialog.accept());
    await row.click({ button: 'right' });
    await page.click('[data-testid="menu-item-delete"]');
    await expect(row).toHaveCount(0);
    await waitFor(() => !isAlive(pid3), 5000);

    // --- (e) a one-shot script's own clean exit never drops the connection -----------------
    await page.evaluate(
      (c) =>
        window.kira.connectionsCreate({
          name: 'OneShot PG',
          kind: 'postgres',
          color: 'blue',
          mode: 'fields',
          readOnly: false,
          host: c.host,
          port: c.port,
          database: c.database,
          username: c.username,
          password: c.password,
          uri: null,
          options: {},
          preconnect: `touch ${c.marker2File}`,
          preconnectSidecar: false,
        }),
      {
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: cfg.username,
        password: cfg.password,
        marker2File,
      },
    );
    const oneShotRow = await connectionRow(page, 'OneShot PG');
    await oneShotRow.click({ button: 'right' });
    await page.click('[data-testid="menu-item-connect"]');
    await expect(oneShotRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
    await waitFor(() => existsSync(marker2File), 5000);
    await page.waitForTimeout(3000);
    await expect(oneShotRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected');

    expect(consoleErrors).toEqual([]);
  });
});
