import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm, cancelConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

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
  mcpEnabled: false,
  mcpDescription: '',
  mcpReadMode: 'allow',
  mcpWriteMode: 'prompt',
  mcpDdlMode: 'deny',
  mcpAutoExplain: true,
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

// P108 Part 12 F4: a reveal in flight for the connection being edited must not write (or show)
// its secret into whatever draft has replaced it by the time the reveal resolves —
// ConnectionDialog.vue stays mounted across the swap (App.vue's `v-if="connectionDialogStore.open"`
// never toggles: openCreateDialog Object.assigns a fresh draft into the same store, it doesn't
// close and reopen the dialog), so nothing but requestReveal's own draft-identity check stands
// between them. The swap itself is the menu-bar "New Connection" command the finding calls out
// (IPC.newConnection, a push event — same path a Cmd+N keypress or File-menu click takes), fired
// straight at the mock's dispatch hook rather than closing the dialog: a close (or a v-if-gated
// remount of any kind) would reset revealed/showPassword on its own even under the old, unfixed
// code, and would prove nothing about the identity-check fix this finding is actually about.
test("a draft swap while a reveal is in flight does not leak the old draft's secret", async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: boot([
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: { password: 'hunter2', error: null, outcome: 'revealed' },
        hold: true,
      },
    ]),
  });

  await openEdit(page);
  const passwordField = page.locator('[data-testid="connection-password"]');

  // Press reveal for CONN — the reply is held, so this awaits nothing but the click itself.
  await page.click('[aria-label="Show password"]');
  expect(control.log().filter((e) => e.channel === IPC.connectionsReveal)).toHaveLength(1);

  // Swap the draft to a brand-new create-mode one while CONN's reveal is still in flight — same
  // live dialog instance, no close/reopen. defaultDraft()'s own empty name is the swap's signal:
  // the dialog never unmounted (still visible throughout), only its draft identity changed.
  await emitWailsEvent(page, IPC.newConnection, undefined);
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-name"]')).toHaveValue('');
  await expect(passwordField).toHaveValue('');
  await expect(passwordField).toHaveAttribute('type', 'password');

  // Now let CONN's held reveal resolve. It must not land in the new, unrelated draft.
  control.release(IPC.connectionsReveal);
  await expect(passwordField).toHaveValue('');
  await expect(passwordField).toHaveAttribute('type', 'password');
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
