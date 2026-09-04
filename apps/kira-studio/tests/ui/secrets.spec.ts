import type { ConnectionSummary } from '@shared/domain/connection';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// Ported from tests/e2e/secrets.spec.ts (P57 D16), per P57-cutover.md §11's connections/secrets
// finding — but only a small slice of it. Scenarios 2-4 there (7 of the file's 9 substantive
// checks) read the app's own on-disk kira.sqlite directly and assert real encrypt-at-rest,
// plaintext-upgrade-on-relaunch and idempotent-re-encryption behavior across 2-3 real relaunches
// each. None of that has an equivalent here: there is no disk and no second process
// (tests/ui/fixtures.ts's own header comment), and the guarantee is now covered more precisely at
// the layer that actually implements it — apps/kira-studio/internal/storage/repos/secrets_test.go's real
// AES-256-GCM round trip and apps/kira-studio/internal/connections/service_test.go's
// TestPasswordThreeStateConvention (AGENTS.md's P57 finding).
//
// What *is* pure UI and ports here: connectionsSecretsStatus()'s three backend shapes and
// ConnectionDialog.vue's `connection-credential-note` rendering for each, plus the failed/
// succeeded-save behavior when secrets are unavailable (scenario 5's UI half, minus its own two
// on-disk assertions). This is actually a strictly better test than the original: the original
// branches on `process.platform` and only ever exercises the one status shape the host OS
// produces (P52 D16), so no sandbox has ever run more than one of these three branches in one
// process. Mocking the status means all three run unconditionally, on any OS, in one file.

const KEYCHAIN: SecretStorageStatus = {
  available: true,
  backend: 'keychain',
  insecureFallback: false,
  reason: null,
};
const BASIC_TEXT: SecretStorageStatus = {
  available: true,
  backend: 'basic_text',
  insecureFallback: true,
  reason: null,
};
const UNAVAILABLE: SecretStorageStatus = {
  available: false,
  backend: 'unavailable',
  insecureFallback: false,
  reason: 'the platform keychain could not be reached',
};

function withSecretStatus(status: SecretStorageStatus): ControlSnapshot[] {
  return [{ channel: IPC.connectionsSecretsStatus, response: status }];
}

test('keychain available shows the keychain-encrypted note', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: withSecretStatus(KEYCHAIN) });
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await expect(page.locator('[data-testid="connection-credential-note"]')).toContainText(
    'Credentials are encrypted with your macOS Keychain.',
  );
});

test('the Linux dev fallback shows the development-fallback note', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: withSecretStatus(BASIC_TEXT) });
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await expect(page.locator('[data-testid="connection-credential-note"]')).toContainText(
    'Development fallback',
  );
});

test('the unavailable path fails loudly and safely', async ({ relaunch, consoleErrors }) => {
  const CREATED: ConnectionSummary = {
    id: 'conn-unavailable',
    name: 'Secrets Unavailable',
    kind: 'postgres',
    color: 'none',
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
  const draftArgs = (password: string | null) => ({
    name: 'Secrets Unavailable',
    kind: 'postgres',
    color: 'none',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'testdb',
    username: 'testuser',
    password,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
  });

  const { window: page } = await relaunch({
    control: [
      ...withSecretStatus(UNAVAILABLE),
      {
        channel: IPC.connectionsCreate,
        args: draftArgs('wont-be-saved'),
        error: { code: 'E_SECRET_STORE', message: 'The macOS Keychain is unavailable.' },
      },
      { channel: IPC.connectionsCreate, args: draftArgs(null), response: CREATED },
    ],
  });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await expect(page.locator('[data-testid="connection-credential-note"]')).toBeVisible();

  // With a password: the save fails visibly, the dialog stays open, and no record is created.
  await page.fill('[data-testid="connection-name"]', 'Secrets Unavailable');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.fill('[data-testid="connection-password"]', 'wont-be-saved');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-save-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="tree-row"][data-kind="connection"]')).toHaveCount(0);
  await page.click('[data-testid="connection-cancel"]');

  // Without a password (a fresh dialog whose password field is never touched, so it stays
  // `null`): succeeds normally — proving the cipher is never consulted when there is no secret.
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Secrets Unavailable');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await expect(
    page
      .locator('[data-testid="tree-row"][data-kind="connection"]')
      .filter({ hasText: 'Secrets Unavailable' }),
  ).toBeVisible();

  // D7's real point: no *unhandled* rejection reached the renderer console at any point above.
  // Under Wails, that no longer means zero console lines — the real bound-call transport answers
  // every handled business-rule error with a genuine HTTP 422 (`pkg/application/transport_http.go`
  // — confirmed in the module cache, not assumed), and Chromium/WebKit's own devtools log any
  // non-2xx fetch as "Failed to load resource" regardless of whether the page's JS handles it
  // (AGENTS.md's P57 finding; the same phenomenon `mockRuntime.ts`'s own `/wails/custom.js` comment
  // documents for a 404). So the real assertion is "no line *other than* that one expected,
  // already-handled 422" — the one thing this tier can still prove.
  expect(consoleErrors).toEqual([
    'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
  ]);
});
