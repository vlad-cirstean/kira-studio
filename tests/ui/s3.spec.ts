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

  // --- S3 still has no query console (caps.sql === false) — P33 didn't change that -----------------
  await openRowMenu(page, NESTED_OBJECT_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

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
  await expandRow(page, MAIN_BUCKET_PATH);
  const rootObjectRow = await findRow(page, ROOT_OBJECT_PATH);
  await rootObjectRow.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${ROOT_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();
  await view.locator('[data-testid="keyvalue-download"]').click();

  await expect
    .poll(async () => readFile(destPath, 'utf8').catch(() => null), { timeout: 15_000 })
    .toBe(ROOT_OBJECT_BODY);

  const opRow = page
    .locator('[data-testid="op-row"][data-status="done"]')
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
  await expandRow(page, MUTABLE_BUCKET_PATH);
  const row = await findRow(page, EDITABLE_OBJECT_PATH);
  await row.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${EDITABLE_OBJECT_PATH}"]`);
  await expect(view).toBeVisible();
  await expect(bodyRowOf(page, view).locator('[data-testid="keyvalue-value"]')).toContainText(
    EDITABLE_OBJECT_BODY,
    { timeout: 15_000 },
  );

  await view.locator('[data-testid="keyvalue-edit"]').click();
  const editor = view.locator('[data-testid="object-body-editor"]');
  await expect(editor).toBeVisible();
  await editor.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  const newBody = '{"status":"final"}';
  await page.keyboard.type(newBody);
  await editor.locator('[data-testid="object-body-save"]').click();

  await expect(editor).toHaveCount(0);
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
  await expandRow(page, MAIN_BUCKET_PATH);
  await expandRow(page, SIZES_PREFIX_PATH);
  const row = await findRow(page, OVERSIZED_OBJECT_PATH);
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
  await expandRow(page, MAIN_BUCKET_PATH);
  await expandRow(page, SIZES_PREFIX_PATH);
  const row = await findRow(page, BINARY_OBJECT_PATH);
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

  // The tree row exists too — Upload from a bucket with nothing in it (D17's own point) actually
  // populates it, not just the tab.
  const treeRow = await findRow(page, uploadedPath);
  await expect(treeRow).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('s3 — delete, and the read-only guard', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!s3) throw new Error('s3 fixture did not start');
  const { window: page } = kira;
  await connectS3(page, s3.config, { name: 'S3' });

  await expandRow(page, '');
  await expandRow(page, MUTABLE_BUCKET_PATH);

  // --- delete from a tree row (F12: window.confirm, auto-accepted) -----------------------------
  page.once('dialog', (d) => d.accept());
  await openRowMenu(page, DELETE_TARGET_PATH);
  await page.click('[data-testid="menu-item-delete-object"]');
  await expect(
    page.locator(`[data-testid="tree-row"][data-path="${DELETE_TARGET_PATH}"]`),
  ).toHaveCount(0, { timeout: 10_000 });

  // --- delete from an open tab: the tab then shows the ordinary "gone" error, not a stale page --
  const secondRow = await findRow(page, SECOND_DELETE_TARGET_PATH);
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
  const rootRow = await findRow(page, ROOT_OBJECT_PATH);
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
