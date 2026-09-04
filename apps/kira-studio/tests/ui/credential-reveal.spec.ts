import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm, cancelConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';

// P14: confirm-before-reveal for saved credentials. Follows secrets.spec.ts's own pattern (F10) —
// mocking ConnectionsService.Reveal's response per scenario, rather than branching on the host OS
// or a real LocalAuthentication prompt this tier cannot drive at all (no darwin toolchain, no
// display — evaluate_darwin.go's own header comment). All four RevealResult outcomes (D6) run
// here, on any OS, in one file: revealed, cancelled, confirmation-required (the non-macOS/OS-auth-
// unavailable fallback this sandbox always takes), and error.

const CONN: ConnectionSummary = {
  id: 'conn-reveal',
  name: 'Reveal Test DB',
  kind: 'postgres',
  color: 'blue',
  mode: 'fields',
  readOnly: false,
  host: '127.0.0.1',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  uri: null,
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  autoExplain: false,
  throttlePerSec: 0,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// The Update args a no-op save (password left untouched) sends — every field from CONN, minus the
// id/sortOrder/createdAt/updatedAt saveDialog() strips, plus password: null (D1/F4: "never typed"
// means "unchanged", the same three-state convention URI mode already relied on before P14).
const UNCHANGED_UPDATE_ARGS = {
  name: CONN.name,
  kind: CONN.kind,
  color: CONN.color,
  mode: CONN.mode,
  readOnly: CONN.readOnly,
  host: CONN.host,
  port: CONN.port,
  database: CONN.database,
  username: CONN.username,
  uri: CONN.uri,
  options: CONN.options,
  preconnect: CONN.preconnect,
  preconnectSidecar: CONN.preconnectSidecar,
  autoExplain: CONN.autoExplain,
  password: null,
};

function boot(extra: ControlSnapshot[]): ControlSnapshot[] {
  return [{ channel: IPC.connectionsList, response: [CONN] }, ...extra];
}

function connectionRow(page: import('@playwright/test').Page) {
  return page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: CONN.name });
}

async function openEdit(page: import('@playwright/test').Page): Promise<void> {
  await connectionRow(page).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
}

test('opening Edit… does not fetch or show the secret', async ({ relaunch }) => {
  // Deliberately no connectionsReveal snapshot at all: F1's whole point is that the plaintext is
  // no longer fetched just by opening the dialog. If openEditDialog ever regresses back to
  // reveal-on-open, this test fails on the unmocked call (a 422 E_FIXTURE_MISS the mock answers
  // any request with no matching snapshot), not just on the password field's own value — the
  // assertion most likely to survive a "pre-filling is convenient" regression is the call count.
  const { window: page, control } = await relaunch({ control: boot([]) });

  await openEdit(page);

  const passwordField = page.locator('[data-testid="connection-password"]');
  await expect(passwordField).toHaveValue('');
  await expect(passwordField).toHaveAttribute('placeholder', 'Unchanged — click the eye to reveal');
  expect(control.log().filter((e) => e.channel === IPC.connectionsReveal)).toHaveLength(0);
});

test('revealing fills and unmasks the field; toggling makes no further call', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: boot([
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: { password: 'hunter2', error: null, outcome: 'revealed' },
      },
    ]),
  });

  await openEdit(page);
  const passwordField = page.locator('[data-testid="connection-password"]');

  await page.click('[aria-label="Show password"]');
  await expect(passwordField).toHaveValue('hunter2');
  await expect(passwordField).toHaveAttribute('type', 'text');

  // F8/D5: once revealed, hide/show is a free client-side toggle — no second round trip.
  await page.click('[aria-label="Hide password"]');
  await expect(passwordField).toHaveAttribute('type', 'password');
  await page.click('[aria-label="Show password"]');
  await expect(passwordField).toHaveAttribute('type', 'text');

  expect(control.log().filter((e) => e.channel === IPC.connectionsReveal)).toHaveLength(1);
});

test('a cancelled reveal shows nothing, and an untouched save still succeeds', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: boot([
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: { password: null, error: null, outcome: 'cancelled' },
      },
      {
        channel: IPC.connectionsUpdate,
        args: { id: CONN.id, input: UNCHANGED_UPDATE_ARGS },
        response: CONN,
      },
    ]),
  });

  await openEdit(page);
  const passwordField = page.locator('[data-testid="connection-password"]');

  await page.click('[aria-label="Show password"]');
  await expect(passwordField).toHaveValue('');
  await expect(page.locator('[data-testid="connection-save-error"]')).toHaveCount(0);

  // D1/F4: a cancelled reveal must not have turned draft.password into anything but null — a save
  // right afterward still goes through as "unchanged", not an accidental clear.
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
});

test('OS auth unavailable routes through the in-app confirmation', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: boot([
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: { password: null, error: null, outcome: 'confirmation-required' },
      },
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: true },
        response: { password: 'hunter2', error: null, outcome: 'revealed' },
      },
    ]),
  });

  await openEdit(page);
  const passwordField = page.locator('[data-testid="connection-password"]');

  // First press: confirm-dialog appears with D11's wording; cancelling it reveals nothing and
  // makes no second Reveal call.
  await page.click('[aria-label="Show password"]');
  await expect(page.locator('[data-testid="confirm-dialog-message"]')).toHaveText(
    `Show the saved password for "${CONN.name}"? It will be displayed in plain text.`,
  );
  await cancelConfirm(page);
  await expect(passwordField).toHaveValue('');
  expect(control.log().filter((e) => e.channel === IPC.connectionsReveal)).toHaveLength(1);

  // Second press, this time confirming: the second Reveal call carries confirmed: true, and the
  // field fills.
  await page.click('[aria-label="Show password"]');
  await acceptConfirm(page);
  await expect(passwordField).toHaveValue('hunter2');
  const revealCalls = control.log().filter((e) => e.channel === IPC.connectionsReveal);
  expect(revealCalls).toHaveLength(3);
  expect(revealCalls[2]?.args).toEqual({ id: CONN.id, confirmed: true });
});

test("a reveal error renders in the dialog's existing error slot", async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: boot([
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: {
          password: null,
          error: 'The stored credential could not be decrypted.',
          outcome: 'error',
        },
      },
    ]),
  });

  await openEdit(page);

  await page.click('[aria-label="Show password"]');
  await expect(page.locator('[data-testid="connection-save-error"]')).toHaveText(
    'The stored credential could not be decrypted.',
  );
  await expect(page.locator('[data-testid="connection-password"]')).toHaveValue('');
});
