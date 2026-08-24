import {
  EMPTY_BUCKET,
  MAIN_BUCKET,
  NESTED_OBJECT_BODY,
  NESTED_OBJECT_KEY,
  ROOT_OBJECT_BODY,
  ROOT_OBJECT_KEY,
} from '../db/fixtures/0007_s3_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type S3Fixture,
  startS3,
} from './support/s3';
import { expandRow, findRow, openRowMenu } from './support/tree';

// The seventh engine through the real UI (P17, mirrors sqs.spec.ts's discipline for the sixth):
// the point of this spec is the object browser's tree (bucket → prefix/object, lazy, '/'-
// delimited) and KeyValueView.vue's reuse for a non-redis "key" — plus the context-menu and
// full-key-identity fixes the P17 validation pass found missing.
test.describe.configure({ timeout: 240_000 });

let s3: S3Fixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  s3 = await startS3();
});

test.afterAll(async () => {
  await s3?.stop();
});

const MAIN_BUCKET_PATH = `bucket:${MAIN_BUCKET}`;
const EMPTY_BUCKET_PATH = `bucket:${EMPTY_BUCKET}`;
const ROOT_OBJECT_PATH = `${MAIN_BUCKET_PATH}/object:${ROOT_OBJECT_KEY}`;
const REPORTS_PREFIX_PATH = `${MAIN_BUCKET_PATH}/prefix:reports`;
const NESTED_PREFIX_PATH = `${REPORTS_PREFIX_PATH}/prefix:2024`;
// An object leaf's own path segment carries the full key verbatim (catalog.ts's listPrefixChildren,
// P9 D3 precedent), not just this level's local segment — same as ROOT_OBJECT_PATH above, just
// with a key that needs encodeURIComponent since it contains '/'.
const NESTED_OBJECT_PATH = `${NESTED_PREFIX_PATH}/object:${encodeURIComponent(NESTED_OBJECT_KEY)}`;

test('s3 — connect, bucket/prefix/object tree, object browser via KeyValueView', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;

  const cfg = s3.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'S3',
        kind: 's3',
        color: 'olive',
        mode: 'uri',
        readOnly: false,
        host: null,
        port: null,
        database: null,
        username: null,
        password: null,
        uri: c.uri,
        options: c.options,
        preconnect: null,
        preconnectSidecar: false,
      }),
    { uri: cfg.uri, options: cfg.options },
  );

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // --- tree: two buckets at the root, each a 'bucket' node -------------------------------------
  await expandRow(page, '');
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await expect(mainBucketRow).toBeVisible();
  await expect(mainBucketRow).toHaveAttribute('data-kind', 'bucket');
  const emptyBucketRow = await findRow(page, EMPTY_BUCKET_PATH);
  await expect(emptyBucketRow).toBeVisible();

  // --- bucket context menu is no longer empty (P17 validation finding #4) ----------------------
  await openRowMenu(page, MAIN_BUCKET_PATH);
  await expect(page.locator('[data-testid="menu-item-refresh"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- an empty bucket expands to zero children, not an error -----------------------------------
  await expandRow(page, EMPTY_BUCKET_PATH);
  await expect(
    page.locator(`[data-testid="tree-row"][data-path^="${EMPTY_BUCKET_PATH}/"]`),
  ).toHaveCount(0);

  // --- expand the main bucket: a 'reports' prefix and a root-level object, prefixes first -------
  await expandRow(page, MAIN_BUCKET_PATH);
  const reportsRow = await findRow(page, REPORTS_PREFIX_PATH);
  await expect(reportsRow).toBeVisible();
  await expect(reportsRow).toHaveAttribute('data-kind', 'prefix');
  const rootObjectRow = await findRow(page, ROOT_OBJECT_PATH);
  await expect(rootObjectRow).toBeVisible();
  await expect(rootObjectRow).toHaveAttribute('data-kind', 'object');

  // --- prefix context menu (namespaceMenu reuse) — no empty menu either --------------------------
  await openRowMenu(page, REPORTS_PREFIX_PATH);
  await expect(page.locator('[data-testid="menu-item-refresh"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- descend one more prefix level to reach the nested object ----------------------------------
  await expandRow(page, REPORTS_PREFIX_PATH);
  const nestedPrefixRow = await findRow(page, NESTED_PREFIX_PATH);
  await expect(nestedPrefixRow).toBeVisible();
  await expandRow(page, NESTED_PREFIX_PATH);
  const nestedObjectRow = await findRow(page, NESTED_OBJECT_PATH);
  await expect(nestedObjectRow).toBeVisible();
  await expect(nestedObjectRow).toHaveAttribute('data-kind', 'object');

  // --- object context menu (objectMenu): Open/Open-in-new-tab/Copy name, no empty menu -----------
  await openRowMenu(page, NESTED_OBJECT_PATH);
  await expect(page.locator('[data-testid="menu-item-open-keyvalue"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open-keyvalue-new-tab"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/screenshots/s3.png' });

  // --- open the root object: type badge, no TTL/memory badges (redis-only concepts), no pager ----
  await rootObjectRow.dblclick();
  const rootView = page.locator(`[data-testid="keyvalue-view"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(rootView).toBeVisible();
  await expect(rootView.locator('[data-testid="keyvalue-type"]')).toHaveText('object');
  await expect(rootView.locator('[data-testid="keyvalue-ttl"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-memory"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-prev"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-next"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-page-size-picker"]')).toHaveCount(0);

  const bodyRow = rootView
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'Body' }) });
  await expect(bodyRow.locator('[data-testid="keyvalue-value"]')).toContainText(ROOT_OBJECT_BODY, {
    timeout: 15_000,
  });

  // --- read-only tooltips name the real reason (S3 has no write caps at all, not a toggle) -------
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toBeDisabled();
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toHaveAttribute(
    'data-kira-tip',
    'Not supported for this connection type',
  );

  // --- Count is exact for a single object (HeadObject-backed) — no "~" prefix --------------------
  await rootView.locator('[data-testid="keyvalue-count"]').click();
  await expect(rootView.locator('[data-testid="keyvalue-status"]')).toContainText(/\d+ total/, {
    timeout: 10_000,
  });
  await expect(rootView.locator('[data-testid="keyvalue-status"]')).not.toContainText('~');

  // --- the nested object's header/tab shows its FULL key, not just the local segment
  //     (P17 validation finding #3 — a bare "summary.json" would be indistinguishable from any
  //     other summary.json elsewhere in the bucket) ------------------------------------------------
  await nestedObjectRow.dblclick();
  const nestedView = page.locator(
    `[data-testid="keyvalue-view"][data-path="${NESTED_OBJECT_PATH}"]`,
  );
  await expect(nestedView).toBeVisible();
  // keyvalue-target covers the whole "path prefix + name" span (ViewHeader.vue), so this is a
  // containment check, not an exact match — the point is that the full key with its '/'s shows
  // up at all, not just the trailing "summary.json" local segment.
  await expect(page.locator('[data-testid="keyvalue-target"]')).toContainText(NESTED_OBJECT_KEY);
  const nestedBodyRow = nestedView
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'Body' }) });
  await expect(nestedBodyRow.locator('[data-testid="keyvalue-value"]')).toContainText(
    NESTED_OBJECT_BODY,
    { timeout: 15_000 },
  );

  // --- S3 is read-only with no console (caps.sql === false) ---------------------------------------
  await openRowMenu(page, NESTED_OBJECT_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});
