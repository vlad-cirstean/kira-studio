import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from './fixtures';

// The phone terminal screen against a scripted socket (page.routeWebSocket): no Go server, so
// what is checked is the frames the app sends and how it reacts to the frames it gets.

const t = (id: string) => `[data-testid="${id}"]`;

interface Socket {
  route: WebSocketRoute;
  /** Binary frames as text, text frames as JSON strings. */
  received: string[];
  connections: number;
}

async function scriptSocket(page: Page): Promise<Socket> {
  const socket: Socket = { route: undefined as never, received: [], connections: 0 };
  await page.routeWebSocket(/\/api\/agent\/sessions\/[^/]+\/terminal/, (ws) => {
    socket.route = ws;
    socket.connections += 1;
    ws.send(JSON.stringify({ type: 'hello', offset: 0, cols: 80, rows: 24 }));
    ws.send(Buffer.from('claude> ready\r\n'));
    ws.onMessage((m) => socket.received.push(typeof m === 'string' ? m : m.toString('latin1')));
  });
  return socket;
}

test.describe('with agent input', () => {
  test.beforeEach(async ({ app, server }) => {
    server.state.auth = 'ok';
    server.state.permissions = { write: true, agentInput: true };
    server.state.agentInputGlobal = true;
    await app();
  });

  const open = async (page: Page, server: { url: string }) => {
    await page.goto(`${server.url}terminal/9ab0`);
    await expect(page.locator(t('term-status'))).toHaveText('Live');
  };

  test('shows the snapshot and sends the key bar bytes', async ({ page, server }) => {
    const socket = await scriptSocket(page);
    await open(page, server);
    await expect(page.locator('.xterm-rows')).toContainText('claude> ready');
    await page.locator(t('term-key-esc')).click();
    await page.locator(t('term-key-ctrl-c')).click();
    await page.locator(t('term-key-up')).click();
    await page.locator(t('term-key-enter')).click();
    await expect
      .poll(() => socket.received.filter((m) => !m.startsWith('{')))
      .toEqual(['\x1b', '\x03', '\x1b[A', '\r']);
  });

  test('the compose row pastes the text and presses Enter', async ({ page, server }) => {
    const socket = await scriptSocket(page);
    await open(page, server);
    await page.locator(t('term-compose')).fill('hello there');
    await page.locator(t('term-compose-send')).click();
    await expect.poll(() => socket.received.join('')).toContain('hello there\r');
  });

  test('larger text tells the server the new size', async ({ page, server }) => {
    const socket = await scriptSocket(page);
    await open(page, server);
    await page.locator(t('term-font-up')).click();
    await expect
      .poll(() => socket.received.some((m) => m.startsWith('{"type":"resize"')))
      .toBe(true);
  });

  test('a reclaim from the computer ends the session without reconnecting', async ({
    page,
    server,
  }) => {
    const socket = await scriptSocket(page);
    await open(page, server);
    await socket.route.close({ code: 4001, reason: 'reclaimed' });
    await expect(page.locator(t('term-ended'))).toContainText('took the terminal back');
    await page.waitForTimeout(1500);
    expect(socket.connections).toBe(1);
  });

  test('Release tells the server and leaves the screen', async ({ page, server }) => {
    const socket = await scriptSocket(page);
    await page.goto(`${server.url}needs`);
    await page.goto(`${server.url}terminal/9ab0`);
    await expect(page.locator(t('term-status'))).toHaveText('Live');
    await page.locator(t('term-release')).click();
    await expect.poll(() => socket.received).toContain('{"type":"release"}');
    await expect(page.locator(t('terminal-screen'))).toHaveCount(0);
  });
});

test('without agent input the screen shows the hint and never connects', async ({
  page,
  server,
  app,
}) => {
  server.state.auth = 'ok';
  server.state.permissions = { write: true, agentInput: false };
  const socket = await scriptSocket(page);
  await app();
  await page.goto(`${server.url}terminal/9ab0`);
  await expect(page.locator(t('permission-hint'))).toContainText('Settings > Mobile access');
  expect(socket.connections).toBe(0);
});
