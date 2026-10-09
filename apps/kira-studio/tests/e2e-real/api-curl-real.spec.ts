import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from './fixtures';

// P232 A: curl import and export round-trip against a real server. The command the app copies,
// run by the real curl binary, makes the server see the same request the app itself sent.

const run = promisify(execFile);

function hasCurl(): boolean {
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('imported curl sends as written, and copy-as-curl replays identically via real curl', async ({
  kira,
  flowServers,
}) => {
  test.skip(!hasCurl(), 'curl binary not installed');
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="import-curl-start"]');

  const body = '{"sku":"A-1","qty":3}';
  const curl = `curl -X POST '${flowServers.http}/echo?src=curl' -H 'Content-Type: application/json' -H 'X-Flow-Probe: p232' -d '${body}'`;
  await page.fill('[data-testid="import-curl-textarea"]', curl);
  await page.click('[data-testid="import-curl-submit"]');
  await expect(page.locator('[data-testid="http-method-chip"]')).toHaveText('POST');

  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');

  const fromApp = (await flowServers.requests()).filter((r) => r.path === '/echo');
  expect(fromApp).toHaveLength(1);
  expect(fromApp[0].method).toBe('POST');
  expect(fromApp[0].query).toBe('src=curl');
  expect(Buffer.from(fromApp[0].body ?? '', 'base64').toString()).toBe(body);

  await page.click('[data-testid="http-copy-as-curl"]');
  const command = await page.locator('[data-testid="copy-as-curl-command"]').inputValue();
  await run('sh', ['-c', command]);

  const all = (await flowServers.requests()).filter((r) => r.path === '/echo');
  expect(all).toHaveLength(2);
  const [a, b] = all;
  expect(b.method).toBe(a.method);
  expect(b.query).toBe(a.query);
  expect(b.bodySha256).toBe(a.bodySha256);
  for (const h of ['Content-Type', 'X-Flow-Probe']) {
    expect(b.header[h]).toEqual(a.header[h]);
  }
});
