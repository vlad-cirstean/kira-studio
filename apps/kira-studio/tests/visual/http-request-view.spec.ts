import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { openHttpModeAndNewRequest } from '../ui/support/apiMode';
import { IPC } from '../ui/support/ipcChannels';

// P117 §4.2: the Api module had no visual snapshot at all before this phase, so P110's Tailwind
// migration could (and did — see A1/A2) break it silently. An HTTP request view with a sent
// response, at rest — the densest single-request surface, exercising the method/URL bar, the
// pane-switcher ToggleGroup (A1) and the response headers/body chrome together.

const RESPONSE = {
  status: 200,
  statusText: 'OK',
  proto: 'HTTP/1.1',
  headers: [
    { name: 'content-type', value: 'application/json' },
    { name: 'x-request-id', value: 'req-abc123' },
  ],
  body: '{\n  "id": 1,\n  "name": "Ada Lovelace",\n  "active": true\n}',
  bodyEncoding: 'utf8',
  bodyBytes: 58,
  bodyTruncated: false,
  elapsedMs: 42,
  finalUrl: 'https://api.example.com/v1/users/1',
  redirects: [],
};

const CONTROL: ControlSnapshot[] = [{ channel: IPC.httpSend, response: RESPONSE }];

test('HTTP request view at rest, with a sent response (P117)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await openHttpModeAndNewRequest(page);
  await page.fill('[data-testid="http-url"]', 'https://api.example.com/v1/users/1');
  await page.click('[data-testid="http-send"]');

  await expect(page.locator('[data-testid="http-status"]')).toHaveText('200 OK');
  await expect(page.locator('[data-testid="http-request-view"]')).toHaveScreenshot(
    'http-request-view-at-rest.png',
  );
});
