import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// No container needed — every scenario here reads/writes the local SQLite store directly (the
// same on-disk file the app itself uses, opened here via node:sqlite in this test file's own
// process rather than through the Electron app — Playwright's own CLI runs test files under real
// Node even when launched via `bunx`, so this is available despite the project otherwise running
// on Bun; `electronApplication.evaluate()` was tried first, but neither a dynamic `import()` nor
// a bare `require()` is available inside Playwright's CDP eval context for the Electron main
// process) or drives the connection dialog. Unlike connections.spec.ts, several scenarios here
// are genuinely platform-conditional (P25 D13/D16), so this file — not connections.spec.ts's own
// CRUD narrative — is where that conditionality lives.

const PERSIST_SETTLE_MS = 300;

interface ConnectionSummaryLike {
  id: string;
  name: string;
  uri: string | null;
  [key: string]: unknown;
}

async function listConnections(page: Page): Promise<ConnectionSummaryLike[]> {
  return page.evaluate(() => window.kira.connectionsList());
}

async function connectionRow(page: Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

// Reads one row's raw stored password directly off disk — the same node:sqlite the app itself
// uses (storage/db.ts). WAL + a busy_timeout make a second reader safe while the app still has
// the file open.
function storedPassword(kiraHome: string, id: string): string | null {
  const db = new DatabaseSync(`${kiraHome}/kira.sqlite`);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const row = db.prepare('SELECT password FROM connections WHERE id = ?').get(id) as
      | { password: string | null }
      | undefined;
    return row?.password ?? null;
  } finally {
    db.close();
  }
}

// Same seam, writing — used only to plant a pre-P25-shaped plaintext row (scenario 4).
function writePlaintextPassword(kiraHome: string, id: string, value: string): void {
  const db = new DatabaseSync(`${kiraHome}/kira.sqlite`);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE connections SET password = ? WHERE id = ?').run(value, id);
  } finally {
    db.close();
  }
}

// Every file in KIRA_HOME matching kira.sqlite* contains no copy of `needle`'s UTF-8 bytes — WAL
// means a recent write can still live in kira.sqlite-wal rather than kira.sqlite (F14), so this
// must run after the app that wrote it has closed (relaunch() already closes the prior instance
// before this is called), and it must scan every matching file.
function noFileContains(kiraHome: string, needle: string): boolean {
  const target = Buffer.from(needle, 'utf-8');
  for (const name of readdirSync(kiraHome)) {
    if (!name.startsWith('kira.sqlite')) continue;
    if (readFileSync(`${kiraHome}/${name}`).includes(target)) return false;
  }
  return true;
}

async function createConnection(page: Page, name: string, password: string | null): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  if (password !== null) await page.fill('[data-testid="connection-password"]', password);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
}

test('scenario 1 — the platform storage status is what it claims to be', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  const status = await page.evaluate(() => window.kira.connectionsSecretsStatus());

  if (process.platform === 'darwin') {
    // This is the CI guard (D15) — it must fail loudly, never skip, if the keychain-prep step
    // in .github/workflows/ci.yml ever regresses.
    expect(status.available).toBe(true);
    expect(status.backend).toBe('keychain');
    expect(status.insecureFallback).toBe(false);
    expect(status.reason).toBeNull();
    return;
  }

  if (process.platform === 'linux') {
    expect(status.available).toBe(true);
    expect(status.backend).toBe('basic_text');
    expect(status.insecureFallback).toBe(true);
    await page.click('[data-testid="add-connection"]');
    await page.click('[data-testid="connection-kind-postgres"]');
    await expect(page.locator('[data-testid="connection-credential-note"]')).toContainText(
      'Development fallback',
    );
    await page.click('[data-testid="connection-cancel"]');
    return;
  }

  test.skip(true, 'SPEC §1: macOS only; Linux is dev-only (P25 D13)');
});

test('scenario 2 — a saved password is encrypted at rest and survives a relaunch', async ({
  relaunch,
  kiraHome,
}) => {
  let { window: page } = await relaunch();
  const password = 'p25-secret-π-🔐'; // non-ASCII on purpose — D3's Buffer/TEXT round trip
  // breaks visibly here if it breaks at all.
  await createConnection(page, 'Secrets PG', password);

  const created = (await listConnections(page)).find((r) => r.name === 'Secrets PG');
  expect(created).toBeDefined();
  const id = created?.id as string;

  const stored = storedPassword(kiraHome, id);
  expect(stored).not.toBeNull();
  expect(stored?.startsWith('kira:v1:')).toBe(true);
  expect(stored).not.toBe(password);

  // P1 D9, re-asserted alongside the at-rest guarantee so the two are checked together.
  for (const record of await listConnections(page)) {
    expect(Object.hasOwn(record, 'password')).toBe(false);
  }

  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());

  const revealed = await page.evaluate(
    (connId) => window.kira.connectionsReveal({ id: connId }),
    id,
  );
  expect(revealed.password).toBe(password);
  expect(revealed.error).toBeNull();
  expect(noFileContains(kiraHome, password)).toBe(true);

  // Reopen through Edit, change only the name — the password is unaffected (three-state
  // convention) and stays enveloped.
  await (await connectionRow(page, 'Secrets PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.fill('[data-testid="connection-name"]', 'Secrets PG Renamed');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  const revealedAfterEdit = await page.evaluate(
    (connId) => window.kira.connectionsReveal({ id: connId }),
    id,
  );
  expect(revealedAfterEdit.password).toBe(password);
  expect(storedPassword(kiraHome, id)).toMatch(/^kira:v1:/);

  // Duplicate copies the secret without decrypting it (D11); the copy reveals the same password.
  const beforeDuplicate = (await listConnections(page)).length;
  await (await connectionRow(page, 'Secrets PG Renamed')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-duplicate"]');
  await expect.poll(async () => (await listConnections(page)).length).toBe(beforeDuplicate + 1);
  const duplicated = (await listConnections(page)).find(
    (r) => r.name === 'Secrets PG Renamed copy',
  );
  expect(duplicated).toBeDefined();
  const revealedDup = await page.evaluate(
    (connId) => window.kira.connectionsReveal({ id: connId }),
    duplicated?.id as string,
  );
  expect(revealedDup.password).toBe(password);
  expect(storedPassword(kiraHome, duplicated?.id as string)).toMatch(/^kira:v1:/);
});

test('scenario 3 — a URI-mode secret takes the same path (AWS static keys, F4)', async ({
  relaunch,
  kiraHome,
}) => {
  let { window: page } = await relaunch();
  const secret = 'p25-uri-secret';
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'URI Secrets');
  await page.click('[data-testid="mode-uri"]');
  await page.fill(
    '[data-testid="connection-uri"]',
    `postgresql://uriuser:${secret}@10.0.0.9:5555/uridb`,
  );
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const created = (await listConnections(page)).find((r) => r.name === 'URI Secrets');
  expect(created).toBeDefined();
  const id = created?.id as string;
  expect(created?.uri).toContain('uriuser');
  expect(created?.uri).not.toContain(secret);
  expect(storedPassword(kiraHome, id)).toMatch(/^kira:v1:/);

  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());

  const revealed = await page.evaluate(
    (connId) => window.kira.connectionsReveal({ id: connId }),
    id,
  );
  expect(revealed.password).toBe(secret);
  expect(noFileContains(kiraHome, secret)).toBe(true);
});

test('scenario 4 — a pre-P25 plaintext row is upgraded on next launch (D10)', async ({
  relaunch,
  kiraHome,
}) => {
  let { window: page } = await relaunch();
  await createConnection(page, 'Legacy PG', null);
  const created = (await listConnections(page)).find((r) => r.name === 'Legacy PG');
  expect(created).toBeDefined();
  const id = created?.id as string;

  // Plants a bare plaintext value exactly as a pre-P25 build would have left it.
  writePlaintextPassword(kiraHome, id, 'p25-legacy-pw');
  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());

  const stored = storedPassword(kiraHome, id);
  expect(stored).not.toBeNull();
  expect(stored?.startsWith('kira:v1:')).toBe(true);
  expect(stored).not.toBe('p25-legacy-pw');

  const revealed = await page.evaluate(
    (connId) => window.kira.connectionsReveal({ id: connId }),
    id,
  );
  expect(revealed.password).toBe('p25-legacy-pw');
  // No file-bytes assertion here (D17): the plaintext was genuinely written once, and WAL/freed
  // pages may still hold it — only the column-value assertion is sound for this case.

  // Idempotent: a second launch does not re-wrap an already-enveloped value.
  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());
  expect(storedPassword(kiraHome, id)).toBe(stored);
});

test('scenario 5 — the unavailable path fails loudly and safely (Linux only)', async ({
  relaunch,
  consoleErrors,
  kiraHome,
}) => {
  test.skip(
    process.platform !== 'linux',
    'the Keychain cannot be made unavailable on macOS from within a test (P25 D16)',
  );

  const { window: page } = await relaunch({ env: { KIRA_INSECURE_SECRETS: undefined } });

  const status = await page.evaluate(() => window.kira.connectionsSecretsStatus());
  expect(status.available).toBe(false);
  expect(status.backend).toBe('unavailable');
  expect(status.reason).not.toBeNull();

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await expect(page.locator('[data-testid="connection-credential-note"]')).toBeVisible();

  // With a password: the save fails visibly, the dialog stays open, and no record is created.
  const beforeFailedSave = (await listConnections(page)).length;
  await page.fill('[data-testid="connection-name"]', 'Secrets Unavailable');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.fill('[data-testid="connection-password"]', 'wont-be-saved');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-save-error"]')).toBeVisible();
  expect((await listConnections(page)).length).toBe(beforeFailedSave);
  await page.click('[data-testid="connection-cancel"]');

  // Without a password (a fresh dialog whose password field is never touched, so it stays
  // `null`): succeeds normally — proving the cipher is never consulted when there is no secret.
  await createConnection(page, 'Secrets Unavailable', null);
  const created = (await listConnections(page)).find((r) => r.name === 'Secrets Unavailable');
  expect(created).toBeDefined();
  expect(storedPassword(kiraHome, created?.id as string)).toBeNull();

  // D7's real point: no unhandled rejection reached the renderer console at any point above.
  expect(consoleErrors).toEqual([]);
});
