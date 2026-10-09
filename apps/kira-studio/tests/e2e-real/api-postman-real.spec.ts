import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { installPassthrough } from './support/passthrough';

// P232 A: Postman import through the UI menu, a real send from the imported tree, then export
// through the save dialog. Only the two file dialogs are faked; server mode has none.

const FIXTURE = resolve(__dirname, 'testdata/api/orders.postman_collection.json');

interface Tree {
  collections: { id: string; name: string }[];
  items: { kind: string; name: string }[];
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
}

function names(items: PostmanItem[]): string[] {
  return items.flatMap((i) => [i.name, ...names(i.item ?? [])]);
}

test('Postman import builds the tree, the imported request sends, export writes a re-readable file', async ({
  kira,
  kiraHome,
  flowServers,
}) => {
  const dir = join(kiraHome, 'postman');
  await mkdir(dir, { recursive: true });
  const importPath = join(dir, 'in.json');
  const exportPath = join(dir, 'out.postman_collection.json');
  const source = (await readFile(FIXTURE, 'utf8')).replaceAll('__BASE_URL__', flowServers.http);
  await writeFile(importPath, source);

  const page = kira.window;
  await installPassthrough(page, {
    'FilesService.ChooseOpen': {
      response: {
        canceled: false,
        file: { path: importPath, name: 'in.json', size: source.length },
      },
    },
    'FilesService.ChooseSave': { response: { canceled: false, filePath: exportPath } },
  });

  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="import-collection-start"]');
  await expect(page.locator('[data-testid="import-report"]')).toBeVisible();
  const root = page.locator('[data-testid="collection-row"][data-kind="collection"]');
  await expect(root).toContainText('Flow Orders');

  const tree = await kira.call<Tree>('CollectionsService', 'List');
  expect(tree.collections.map((c) => c.name)).toEqual(['Flow Orders']);
  const imported = tree.items.map((i) => i.name);
  expect(imported).toEqual(expect.arrayContaining(['Orders', 'Create order', 'List orders']));

  await page.locator('[data-kind="request"]', { hasText: 'List orders' }).dblclick();
  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');
  expect((await flowServers.requests()).filter((r) => r.path === '/echo').length).toBe(1);

  await root.click({ button: 'right' });
  await page.click('[data-testid="menu-item-export"]');
  await expect.poll(() => readFile(exportPath, 'utf8').catch(() => '')).not.toBe('');

  const out = JSON.parse(await readFile(exportPath, 'utf8')) as {
    info: { name: string };
    item: PostmanItem[];
  };
  expect(out.info.name).toBe('Flow Orders');
  expect(names(out.item)).toEqual(
    expect.arrayContaining(['Orders', 'Create order', 'List orders']),
  );
});
