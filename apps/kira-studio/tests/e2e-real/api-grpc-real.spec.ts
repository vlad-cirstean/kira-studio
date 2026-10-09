import type { Page } from '@playwright/test';
import { editorText } from '../ui/support/editorText';
import { expect, test } from './fixtures';

// P232 A: gRPC through the UI against the real flow server: reflection describe, a unary call
// with header and trailer, and a server stream that appears message by message and stops on Stop.

async function openGrpc(page: Page, target: string): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="api"]').click();
  await page.click('[data-testid="new-grpc-request-start"]');
  await page.fill('[data-testid="grpc-target"]', target);
  await page.getByRole('button', { name: 'Plaintext' }).click();
  await page.click('[data-testid="grpc-request-pane-schema"]');
  await expect(page.locator('[data-testid="grpc-service-name"]')).toHaveText(['Flow']);
}

async function pick(page: Page, method: string, message: string): Promise<void> {
  await page.locator('[data-testid="grpc-method-row"]', { hasText: method }).first().click();
  const editor = page.locator('[data-testid="grpc-message-editor"]');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(message);
  await expect.poll(() => editorText(editor)).toBe(message);
}

test('reflection describes the flow service over the UI', async ({ kira, flowServers }) => {
  const page = kira.window;
  await openGrpc(page, flowServers.grpc);
  await expect(page.locator('[data-testid="grpc-method-row"]')).toHaveCount(6);
  await expect(
    page.locator('[data-testid="grpc-method-row"]').getByText('ServerStream', { exact: true }),
  ).toBeVisible();
});

test('a unary call shows message, header and trailer', async ({ kira, flowServers }) => {
  const page = kira.window;
  await openGrpc(page, flowServers.grpc);
  await pick(page, 'Unary', '{"text":"hello"}');
  await page.click('[data-testid="grpc-call"]');

  await expect(page.locator('[data-testid="grpc-status-chip"]')).toContainText('OK (0)');
  const entry = page.locator('[data-testid="grpc-message-entry"]');
  await expect(entry).toHaveCount(1);
  expect(await editorText(entry)).toContain('hello');

  await page.click('[data-testid="grpc-response-pane-metadata"]');
  const metadata = page.locator('[data-testid="grpc-response-metadata"]');
  await expect(metadata).toContainText('content-type');
  await expect(metadata).toContainText('grpc-status');
});

test('a server stream delivers messages one by one and Stop ends it', async ({
  kira,
  flowServers,
}) => {
  const page = kira.window;
  await openGrpc(page, flowServers.grpc);
  await pick(page, 'ServerStream', '{"text":"s","count":50,"intervalMs":200}');
  await page.click('[data-testid="grpc-call"]');

  const entries = page.locator('[data-testid="grpc-message-entry"]');
  await expect(entries).toHaveCount(2, { timeout: 15_000 });
  const mid = await entries.count();
  expect(mid).toBeLessThan(50);
  await expect(page.locator('[data-testid="grpc-request-stop"]')).toBeEnabled();

  await page.click('[data-testid="grpc-request-stop"]');
  await expect(page.locator('[data-testid="grpc-request-stop"]')).toBeDisabled();
  await expect(page.locator('[data-testid="grpc-stopped-strip"]')).toContainText('Stopped after');
  const final = await entries.count();
  expect(final).toBeGreaterThanOrEqual(mid);
  expect(final).toBeLessThan(50);
  await page.waitForTimeout(600);
  expect(await entries.count()).toBe(final);
});
