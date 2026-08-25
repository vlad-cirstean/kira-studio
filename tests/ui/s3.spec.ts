import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  BINARY_OBJECT_KEY,
  DELETE_TARGET_KEY,
  EDITABLE_OBJECT_BODY,
  EDITABLE_OBJECT_KEY,
  EMPTY_BUCKET,
  MAIN_BUCKET,
  MUTABLE_BUCKET,
  NESTED_OBJECT_BODY,
  NESTED_OBJECT_KEY,
  OVERSIZED_OBJECT_KEY,
  ROOT_OBJECT_BODY,
  ROOT_OBJECT_KEY,
  SECOND_DELETE_TARGET_KEY,
} from '../db/fixtures/0007_s3_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type S3Fixture,
  startS3,
} from './support/s3';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

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

const MUTABLE_BUCKET_PATH = `bucket:${MUTABLE_BUCKET}`;
const EDITABLE_OBJECT_PATH = `${MUTABLE_BUCKET_PATH}/object:${EDITABLE_OBJECT_KEY}`;
const DELETE_TARGET_PATH = `${MUTABLE_BUCKET_PATH}/object:${DELETE_TARGET_KEY}`;
const SECOND_DELETE_TARGET_PATH = `${MUTABLE_BUCKET_PATH}/object:${SECOND_DELETE_TARGET_KEY}`;
// Mirrors NESTED_OBJECT_PATH above: the 'prefix' segment stays local ("sizes"), but the 'object'
// leaf's own name is the full bucket-relative key (D3), encoded since it contains '/'.
const SIZES_PREFIX_PATH = `${MAIN_BUCKET_PATH}/prefix:sizes`;
const OVERSIZED_OBJECT_PATH = `${SIZES_PREFIX_PATH}/object:${encodeURIComponent(OVERSIZED_OBJECT_KEY)}`;
const BINARY_OBJECT_PATH = `${SIZES_PREFIX_PATH}/object:${encodeURIComponent(BINARY_OBJECT_KEY)}`;

// Every new scenario below connects its own fresh app (the `kira` fixture relaunches per test) —
// this factors out the six-line connect-and-wait dance the original scenario above wrote by hand.
async function connectS3(
  page: Page,
  cfg: S3Fixture['config'],
  opts: { name: string; readOnly?: boolean } = { name: 'S3' },
): Promise<void> {
  await page.evaluate(
    ({ uri, options, opts }) =>
      window.kira.connectionsCreate({
        name: opts.name,
        kind: 's3',
        color: 'olive',
        mode: 'uri',
        readOnly: opts.readOnly ?? false,
        host: null,
        port: null,
        database: null,
        username: null,
        password: null,
        uri,
        options,
        preconnect: null,
        preconnectSidecar: false,
      }),
    { uri: cfg.uri, options: cfg.options, opts },
  );
  const connRow = connectionRow(page, opts.name);
  await expect(connRow).toBeVisible();
  await connRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
}

function bodyRowOf(page: Page, view: Locator): Locator {
  return view
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'Body' }) });
}

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

  // --- tree: two buckets at the root, each a 'bucket' node — now leaves (P41 D5) ----------------
  await expandRow(page, '');
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await expect(mainBucketRow).toBeVisible();
  await expect(mainBucketRow).toHaveAttribute('data-kind', 'bucket');
  await expect(mainBucketRow.locator('.twisty')).toHaveClass(/invisible/);
  const emptyBucketRow = await findRow(page, EMPTY_BUCKET_PATH);
  await expect(emptyBucketRow).toBeVisible();
  await expect(emptyBucketRow.locator('.twisty')).toHaveClass(/invisible/);

  // --- bucket context menu: Browse objects first (P41 D17), then the menu that was never empty
  //     (P17 validation finding #4) -----------------------------------------------------------
  await openRowMenu(page, MAIN_BUCKET_PATH);
  await expect(page.locator('[data-testid="menu-item-browse"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-refresh"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  await page.keyboard.press('Escape');

  const browseView = page.locator('[data-testid="browse-view"]');

  // --- an empty bucket's Browse tab shows zero items, not an error --------------------------------
  await emptyBucketRow.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', EMPTY_BUCKET_PATH);
  await expect(browseView.locator('[data-testid="browse-empty"]')).toBeVisible();

  // --- the main bucket's Browse tab: a 'reports' prefix and a root-level object, prefixes first ---
  await mainBucketRow.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const reportsRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${REPORTS_PREFIX_PATH}"]`,
  );
  await expect(reportsRow).toBeVisible();
  await expect(reportsRow).toHaveAttribute('data-kind', 'prefix');
  const rootObjectRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${ROOT_OBJECT_PATH}"]`,
  );
  await expect(rootObjectRow).toBeVisible();
  await expect(rootObjectRow).toHaveAttribute('data-kind', 'object');

  // --- prefix context menu (the moved namespaceMenu/prefixMenu shape) — no empty menu either -----
  await reportsRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-refresh"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/screenshots/s3.png' });

  // --- open the root object: type badge, no TTL (redis-only concept), a real memory badge
  //     (P33 D5: memoryBytes now carries the object's own ContentLength, not always null), no pager
  await rootObjectRow.dblclick();
  const rootView = page.locator(`[data-testid="keyvalue-view"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(rootView).toBeVisible();
  await expect(rootView.locator('[data-testid="keyvalue-type"]')).toHaveText('object');
  await expect(rootView.locator('[data-testid="keyvalue-ttl"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-memory"]')).not.toHaveText('unknown');
  await expect(rootView.locator('[data-testid="keyvalue-prev"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-next"]')).toHaveCount(0);
  await expect(rootView.locator('[data-testid="keyvalue-page-size-picker"]')).toHaveCount(0);

  const bodyRow = rootView
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'Body' }) });
  await expect(bodyRow.locator('[data-testid="keyvalue-value"]')).toContainText(ROOT_OBJECT_BODY, {
    timeout: 15_000,
  });

  // --- P33: S3 gained write caps — Add now reads "Upload a file" on an object tab, since inserting
  //     from here means putting a sibling object into the same bucket, not editing this one --------
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toBeEnabled();
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toHaveAttribute(
    'data-kira-tip',
    'Upload a file',
  );

  // --- Count is exact for a single object (HeadObject-backed) — no "~" prefix --------------------
  await rootView.locator('[data-testid="keyvalue-count"]').click();
  await expect(rootView.locator('[data-testid="keyvalue-status"]')).toContainText(/\d+ total/, {
    timeout: 10_000,
  });
  await expect(rootView.locator('[data-testid="keyvalue-status"]')).not.toContainText('~');

  // --- descend to the nested object: reactivating the main bucket's Browse tab (§8.4's identity
  // rule) resumes it right where it was left (still the bucket's own root — nothing navigated it
  // deeper before rootObjectRow's tab opened above), so this is Down twice, not a fresh reveal. ---
  await mainBucketRow.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  await reportsRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', REPORTS_PREFIX_PATH);
  const nestedPrefixRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${NESTED_PREFIX_PATH}"]`,
  );
  await expect(nestedPrefixRow).toBeVisible();
  await nestedPrefixRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', NESTED_PREFIX_PATH);
  const nestedObjectRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${NESTED_OBJECT_PATH}"]`,
  );
  await expect(nestedObjectRow).toBeVisible();
  await expect(nestedObjectRow).toHaveAttribute('data-kind', 'object');

  // --- object context menu (the moved keyMenu/objectMenu shape): Open/Open-in-new-tab/Copy name,
  //     no empty menu -------------------------------------------------------------------------------
  await nestedObjectRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open-new-tab"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-copy-name"]')).toBeVisible();
  // --- S3 still has no query console (caps.sql === false) — P33 didn't change that, and neither
  //     does the move out of the tree (views/browse/menu.ts's object menu never had one either) ---
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

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

  expect(consoleErrors).toEqual([]);
});

test('s3 — download an object to disk', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  const tmpDir = await mkdtemp(join(tmpdir(), 'kira-ui-s3-dl-'));
  const destPath = join(tmpDir, 'downloaded.txt');
  // F25: the only way to test a native dialog Playwright cannot click — stub it in the main
  // process so filesChooseSave's IPC handler returns a path we control.
  await kira.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, destPath);

  await page.click('[data-testid="toggle-operations-panel"]');
  await expandRow(page, '');
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await mainBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const rootObjectRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${ROOT_OBJECT_PATH}"]`,
  );
  await expect(rootObjectRow).toBeVisible();
  await rootObjectRow.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();
  await view.locator('[data-testid="keyvalue-download"]').click();

  await expect
    .poll(async () => readFile(destPath, 'utf8').catch(() => null), { timeout: 15_000 })
    .toBe(ROOT_OBJECT_BODY);

  // OpStatus (shared/domain/ops.ts) is 'running' | 'ok' | 'error' | 'cancelled' — a finished
  // transfer's row carries data-status="ok", not "done".
  const opRow = page
    .locator('[data-testid="op-row"][data-status="ok"]')
    .filter({ hasText: 'transfer' });
  await expect(opRow).toBeVisible({ timeout: 15_000 });
  await expect(opRow).toContainText(`GetObject s3://${MAIN_BUCKET}/${ROOT_OBJECT_KEY} ->`);

  expect(consoleErrors).toEqual([]);
});

test("s3 — edit a small object's body", async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  await expandRow(page, '');
  const mutableBucketRow = await findRow(page, MUTABLE_BUCKET_PATH);
  await mutableBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MUTABLE_BUCKET_PATH);
  const row = browseView.locator(`[data-testid="browse-row"][data-path="${EDITABLE_OBJECT_PATH}"]`);
  await expect(row).toBeVisible();
  await row.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${EDITABLE_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toContainText(
    EDITABLE_OBJECT_BODY,
    { timeout: 15_000 },
  );

  // Task: S3 body edits now go through the docked cell editor (format detection, beautify,
  // etc.) with an explicit Save strip — never an auto-commit-on-blur write to S3.
  await view.locator('[data-testid="keyvalue-edit"]').click();
  const editor = view.locator('[data-testid="cell-editor-encoded"]');
  await expect(editor).toBeVisible();
  await editor.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  const newBody = '{"status":"final"}';
  await page.keyboard.type(newBody);
  await page.keyboard.press('ControlOrMeta+Enter');
  await view.locator('[data-testid="keyvalue-object-edit-save"]').click();

  await expect(view.locator('[data-testid="keyvalue-object-edit-pending"]')).toHaveCount(0);
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toContainText(
    newBody,
    { timeout: 15_000 },
  );
  // D11: PutObject replaces the body but preserveAttributes() carries ContentType forward.
  const contentTypeRow = view
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'ContentType' }) });
  await expect(contentTypeRow.locator('[data-testid="keyvalue-value"]')).toHaveText(
    'application/json',
  );

  expect(consoleErrors).toEqual([]);
});

test('s3 — an over-limit object is neither rendered nor editable', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  await expandRow(page, '');
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await mainBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const sizesRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${SIZES_PREFIX_PATH}"]`,
  );
  await expect(sizesRow).toBeVisible();
  await sizesRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', SIZES_PREFIX_PATH);
  const row = browseView.locator(
    `[data-testid="browse-row"][data-path="${OVERSIZED_OBJECT_PATH}"]`,
  );
  await expect(row).toBeVisible();
  await row.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${OVERSIZED_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();

  // P33 D4: over OBJECT_BODY_PREVIEW_BYTES — no Body row, an honest strip naming the real size.
  await expect(view.locator('[data-testid="keyvalue-object-too-large"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(view.locator('[data-testid="keyvalue-field"]', { hasText: 'Body' })).toHaveCount(0);
  // formatBytes() — OVERSIZED_OBJECT_BYTES is just over 4 MB, so this reads "4.0 MB".
  await expect(view.locator('[data-testid="keyvalue-memory"]')).toHaveText(/MB$/);

  await expect(view.locator('[data-testid="keyvalue-edit"]')).toBeDisabled();
  await expect(view.locator('[data-testid="keyvalue-edit"]')).toHaveAttribute(
    'data-kira-tip',
    'Too large to edit — download it to open it locally',
  );
  await expect(view.locator('[data-testid="keyvalue-download"]')).toBeEnabled();

  expect(consoleErrors).toEqual([]);
});

test('s3 — a binary object refuses to edit but still previews', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  await expandRow(page, '');
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await mainBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const sizesRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${SIZES_PREFIX_PATH}"]`,
  );
  await expect(sizesRow).toBeVisible();
  await sizesRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', SIZES_PREFIX_PATH);
  const row = browseView.locator(`[data-testid="browse-row"][data-path="${BINARY_OBJECT_PATH}"]`);
  await expect(row).toBeVisible();
  await row.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${BINARY_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();

  const contentTypeRow = view
    .locator('[data-testid="keyvalue-row"]')
    .filter({ has: page.locator('[data-testid="keyvalue-field"]', { hasText: 'ContentType' }) });
  await expect(contentTypeRow.locator('[data-testid="keyvalue-value"]')).toHaveText('image/png');
  // Under the preview limit, so the (lossy) body still renders — the not-UTF-8 reason only blocks
  // Edit, never the read path.
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toBeVisible({
    timeout: 15_000,
  });

  await expect(view.locator('[data-testid="keyvalue-edit"]')).toBeDisabled();
  await expect(view.locator('[data-testid="keyvalue-edit"]')).toHaveAttribute(
    'data-kira-tip',
    "This object isn't valid UTF-8 text — download it to edit it locally",
  );
  await expect(view.locator('[data-testid="keyvalue-download"]')).toBeEnabled();

  expect(consoleErrors).toEqual([]);
});

test("s3 — upload from an empty bucket's tree menu", async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  const tmpDir = await mkdtemp(join(tmpdir(), 'kira-ui-s3-up-'));
  const sourcePath = join(tmpDir, 'hello.txt');
  const sourceBody = 'uploaded through the empty bucket tree menu';
  await writeFile(sourcePath, sourceBody, 'utf8');
  await kira.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, sourcePath);

  await expandRow(page, '');
  await openRowMenu(page, EMPTY_BUCKET_PATH);
  await page.click('[data-testid="menu-item-upload-file"]');

  const dialog = page.locator('[data-testid="upload-dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="upload-choose-file"]').click();
  await expect(dialog.locator('[data-testid="upload-chosen-file"]')).toContainText('hello.txt');
  // Prefilled from the chosen file's own name and extension (D17) — editable, but left as-is here.
  await expect(dialog.locator('[data-testid="upload-key"]')).toHaveValue('hello.txt');
  await expect(dialog.locator('[data-testid="upload-content-type"]')).toHaveValue('text/plain');
  await dialog.locator('[data-testid="upload-submit"]').click();
  await expect(dialog).toHaveCount(0);

  const uploadedPath = `${EMPTY_BUCKET_PATH}/object:hello.txt`;
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${uploadedPath}"]`);
  await expect(view).toBeVisible();
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toContainText(
    sourceBody,
    { timeout: 15_000 },
  );

  // The Browse panel shows it too (P41) — Upload from a bucket with nothing in it (D17's own
  // point) actually populates the level, not just the tab.
  const emptyBucketRow = await findRow(page, EMPTY_BUCKET_PATH);
  await emptyBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  const browseRow = browseView.locator(`[data-testid="browse-row"][data-path="${uploadedPath}"]`);
  await expect(browseRow).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('s3 — delete, and the read-only guard', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  await expandRow(page, '');
  const mutableBucketRow = await findRow(page, MUTABLE_BUCKET_PATH);
  await mutableBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MUTABLE_BUCKET_PATH);

  // --- delete from the Browse panel (F12: window.confirm, auto-accepted) -------------------------
  const deleteTargetRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${DELETE_TARGET_PATH}"]`,
  );
  await expect(deleteTargetRow).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await deleteTargetRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-delete-object"]');
  await expect(deleteTargetRow).toHaveCount(0, { timeout: 10_000 });

  // --- delete from an open tab: the tab then shows the ordinary "gone" error, not a stale page --
  const secondRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${SECOND_DELETE_TARGET_PATH}"]`,
  );
  await expect(secondRow).toBeVisible();
  await secondRow.dblclick();
  const deletedView = page.locator(
    `[data-testid="keyvalue-view"][data-path="${SECOND_DELETE_TARGET_PATH}"]`,
  );
  await expect(deletedView).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await deletedView.locator('[data-testid="keyvalue-delete"]').click();
  await expect(deletedView.locator('[data-testid="keyvalue-error"]')).toBeVisible({
    timeout: 10_000,
  });

  // --- toggle the connection read-only (menu-item-readonly), confirming the live-reconnect prompt
  // ROOT_OBJECT_PATH lives under MAIN_BUCKET, reached through its own Browse tab.
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await mainBucketRow.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const rootRow = browseView.locator(`[data-testid="browse-row"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(rootRow).toBeVisible();
  await rootRow.dblclick();
  const rootView = page.locator(`[data-testid="keyvalue-view"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(rootView).toBeVisible();

  const connRow = connectionRow(page, 'S3');
  page.once('dialog', (d) => d.accept());
  await connRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-readonly"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // D18: Edit/Delete/Upload disabled with the read-only reason; Download stays enabled.
  await expect(rootView.locator('[data-testid="keyvalue-edit"]')).toBeDisabled();
  await expect(rootView.locator('[data-testid="keyvalue-edit"]')).toHaveAttribute(
    'data-kira-tip',
    'Connection is read-only',
  );
  await expect(rootView.locator('[data-testid="keyvalue-delete"]')).toBeDisabled();
  await expect(rootView.locator('[data-testid="keyvalue-delete"]')).toHaveAttribute(
    'data-kira-tip',
    'Connection is read-only',
  );
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toBeDisabled();
  await expect(rootView.locator('[data-testid="keyvalue-add"]')).toHaveAttribute(
    'data-kira-tip',
    'Connection is read-only',
  );
  await expect(rootView.locator('[data-testid="keyvalue-download"]')).toBeEnabled();

  // uploadMenuItem() omits the row entirely when read-only, rather than showing it disabled.
  await openRowMenu(page, MAIN_BUCKET_PATH);
  await expect(page.locator('[data-testid="menu-item-upload-file"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});

test('s3 — browse tab: descend to reports, upload from a prefix level, no prefix rows in the tree (P41)', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  // --- the tree never renders a 'prefix' row anywhere — bucket/prefix nesting only ever shows up
  //     inside a Browse tab now (P41 D5) — and a bucket row's twisty stays invisible, since a
  //     bucket is a leaf in the tree even though it still opens into a Browse panel. -------------
  await expandRow(page, '');
  await expect(page.locator('[data-testid="tree-row"][data-kind="prefix"]')).toHaveCount(0);
  const mainBucketRow = await findRow(page, MAIN_BUCKET_PATH);
  await expect(mainBucketRow.locator('.twisty')).toHaveClass(/invisible/);

  await mainBucketRow.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', MAIN_BUCKET_PATH);
  const reportsRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${REPORTS_PREFIX_PATH}"]`,
  );
  await reportsRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', REPORTS_PREFIX_PATH);

  // --- upload from this prefix level: the toolbar button (not a row's own context menu), landing
  //     one level below where the panel already sits ------------------------------------------------
  const tmpDir = await mkdtemp(join(tmpdir(), 'kira-ui-s3-browse-up-'));
  const sourcePath = join(tmpDir, 'note.txt');
  const sourceBody = 'uploaded from a browse-panel prefix level';
  await writeFile(sourcePath, sourceBody, 'utf8');
  await kira.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, sourcePath);

  await browseView.locator('[data-testid="browse-upload"]').click();
  const dialog = page.locator('[data-testid="upload-dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="upload-choose-file"]').click();
  // Prefilled with the panel's own level prefix ahead of the file name (containerPrefix, D17) —
  // 'reports/', since the panel is one level below the bucket root.
  await expect(dialog.locator('[data-testid="upload-key"]')).toHaveValue('reports/note.txt');
  await dialog.locator('[data-testid="upload-submit"]').click();
  await expect(dialog).toHaveCount(0);

  // catalog.ts's own object-path convention (F-precedent, matches NESTED_OBJECT_PATH above): the
  // full ancestor prefix chain, then an object segment named with the *whole* key, not just its
  // trailing segment.
  const uploadedPath = `${REPORTS_PREFIX_PATH}/object:${encodeURIComponent('reports/note.txt')}`;
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${uploadedPath}"]`);
  await expect(view).toBeVisible();
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toContainText(
    sourceBody,
    { timeout: 15_000 },
  );

  // Reactivating the bucket's Browse tab resumes at the reports level (§8.4 tab-identity reuse),
  // and browseInvalidate() means the new row shows up without a manual refresh.
  await mainBucketRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', REPORTS_PREFIX_PATH);
  const uploadedRow = browseView.locator(`[data-testid="browse-row"][data-path="${uploadedPath}"]`);
  await expect(uploadedRow).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
