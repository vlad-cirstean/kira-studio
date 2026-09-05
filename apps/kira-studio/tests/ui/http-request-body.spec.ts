import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// Four tests, one httpSend snapshot each (the same one-snapshot-per-test constraint
// http-request.spec.ts's own header comment states — a channel with more than one snapshot
// matches on args, and the send's renderer-minted opId makes two sends in one test unmatchable).

function modeTab(page: Page, mode: 'studio' | 'api'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewRequest(page: Page): Promise<void> {
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
  await page.click('[data-testid="new-request-start"]');
}

async function openBodyPane(page: Page): Promise<void> {
  await page.click('[data-testid="http-request-pane-body"]');
}

// insertText (a single CDP Input.insertText, not per-character key events) rather than
// keyboard.type — @codemirror/lang-xml's autoCloseTags input handler only fires for a
// single-character '>' or '/' keystroke, so per-character typing of an already-closed XML
// document (this file writes its own closing tags) fights the auto-inserted ones. A one-shot
// insert never triggers it, landing exactly the literal text.
async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.insertText(text);
}

/** True when some descendant of `view` (a CodeMirror host) has a token painted in the given
 *  resolved color — the lezer-highlighted-token check, since kiraHighlightStyle (editor/theme.ts)
 *  generates opaque per-rule class names rather than semantic ones, the same technique
 *  row-coloring.spec.ts already uses against a known --kira-syntax-* value. */
async function hasTokenColor(view: Locator, rgb: string): Promise<boolean> {
  return view.locator('.cm-content').evaluate((el, wantRgb) => {
    for (const node of el.querySelectorAll('*')) {
      if (getComputedStyle(node).color === wantRgb) return true;
    }
    return false;
  }, rgb);
}

const HTTP_SEND_OK = {
  status: 200,
  statusText: 'OK',
  proto: 'HTTP/1.1',
  headers: [],
  body: '',
  bodyEncoding: 'utf8',
  bodyBytes: 0,
  bodyTruncated: false,
  elapsedMs: 3,
  finalUrl: 'https://api.example.com/echo',
  redirects: [],
};

test('Http request body — code · XML round-trips through the builder and the wire', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.httpSend, response: HTTP_SEND_OK }];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await openBodyPane(page);
  await page.click('[data-testid="http-body-mode-code"]');
  await page.selectOption('[data-testid="http-body-code-language"]', 'xml');

  // --kira-syntax-tag: #569cd6 = rgb(86, 156, 214) (theme/tokens.css) — a tag name colored this
  // way is the observable proof the xml() grammar (not plain text) is active.
  const editor = page.locator('[data-testid="http-request-pane"]');
  await typeInto(editor, page, '<root><a>1</a><b>two</b></root>');
  expect(await hasTokenColor(editor, 'rgb(86, 156, 214)')).toBe(true);

  await page.click('[data-testid="http-body-beautify"]');
  const BEAUTIFIED = '<root>\n  <a>\n    1\n  </a>\n  <b>\n    two\n  </b>\n</root>';
  expect(await editor.locator('.cm-content').innerText()).toBe(BEAUTIFIED);

  await expect(page.locator('[data-testid="http-body-content-type-caption"]')).toHaveText(
    'Content-Type: application/xml (auto)',
  );

  await page.fill('[data-testid="http-url"]', 'https://api.example.com/echo');
  await page.click('[data-testid="http-send"]');

  const sendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(sendCalls).toHaveLength(1);
  expect(sendCalls[0].args).toMatchObject({
    body: { mode: 'code', codeLanguage: 'xml', code: BEAUTIFIED },
  });
});

test('Http request body — form-data with a real file field sends a path, never bytes', async ({
  relaunch,
}) => {
  const PICKED_FILE = {
    canceled: false,
    file: { path: '/tmp/report.csv', name: 'report.csv', size: 2048 },
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.filesChooseOpen, response: PICKED_FILE },
    { channel: IPC.httpSend, response: HTTP_SEND_OK },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await openBodyPane(page);
  await page.click('[data-testid="http-body-mode-formdata"]');

  const rows = page.locator('[data-testid="http-formdata-row"]');

  // Row 0: a text field.
  await rows.nth(0).locator('[data-testid="http-formdata-name"]').fill('title');
  await rows.nth(0).locator('[data-testid="http-formdata-value"]').fill('hello');

  // Row 1 (now the trailing blank row): switch to File, name it, and pick a file.
  await rows.nth(1).locator('[data-testid="http-formdata-kind"]').selectOption('file');
  await rows.nth(1).locator('[data-testid="http-formdata-name"]').fill('upload');
  await rows.nth(1).locator('[data-testid="http-formdata-choose-file"]').click();
  await expect(rows.nth(1).locator('[data-testid="http-formdata-file-caption"]')).toHaveText(
    'report.csv (2.0 KB)',
  );

  // Row 2 (now the trailing blank row): a text field the user leaves *disabled* — D5: only
  // enabled, named rows may ever cross the wire.
  await rows.nth(2).locator('[data-testid="http-formdata-name"]').fill('skip');
  await rows.nth(2).locator('[data-testid="http-formdata-value"]').fill('skip-value');
  await rows.nth(2).locator('[data-testid="http-formdata-enabled"]').uncheck();

  await page.fill('[data-testid="http-url"]', 'https://api.example.com/upload');
  await page.click('[data-testid="http-send"]');

  const sendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(sendCalls).toHaveLength(1);
  const body = (sendCalls[0].args as { body: { formData: unknown[] } }).body;
  expect(body.formData).toEqual([
    { name: 'title', kind: 'text', value: 'hello', path: '', contentType: '' },
    { name: 'upload', kind: 'file', value: '', path: '/tmp/report.csv', contentType: 'text/csv' },
  ]);

  // The load-bearing assertion (D4/F7): the picked file's bytes never crossed the bridge — every
  // call this test made (a no-args call logs `args: undefined`, which JSON.stringify reports as
  // `undefined`, not a string — treated as 0 bytes) carries only short metadata, never anything
  // file-sized.
  for (const entry of control.log()) {
    const size = entry.args === undefined ? 0 : JSON.stringify(entry.args).length;
    expect(size).toBeLessThan(500);
  }
});

test('Http request body — binary and code both persist and restore', async ({ relaunch }) => {
  const RESTORED_TAB = {
    id: 'tab-binary-1',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'POST',
      url: 'https://api.example.com/upload',
      headers: [],
      bodyMode: 'file',
      binaryFile: { path: '/tmp/image.png', name: 'image.png', size: 12345 },
      requestPane: 'body',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [RESTORED_TAB] },
    { channel: IPC.httpSend, response: HTTP_SEND_OK },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-binary-file-caption"]')).toHaveText(
    'image.png (12.1 KB)',
  );

  await page.click('[data-testid="http-body-mode-code"]');
  await page.selectOption('[data-testid="http-body-code-language"]', 'javascript');
  const CODE = 'fetch("/widgets").then((r) => r.json());';
  await typeInto(page.locator('[data-testid="http-request-pane"]'), page, CODE);

  await expect
    .poll(
      () => {
        const saves = control.log().filter((e) => e.channel === IPC.tabsSave);
        if (saves.length === 0) return null;
        const args = saves[saves.length - 1].args as { tabs: { id: string; state: unknown }[] };
        const tab = args.tabs.find((t) => t.id === 'tab-binary-1');
        return tab?.state ?? null;
      },
      { timeout: 3000 },
    )
    .toMatchObject({ code: CODE, codeLanguage: 'javascript' });

  await page.click('[data-testid="http-send"]');
  const sendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(sendCalls).toHaveLength(1);
  expect(sendCalls[0].args).toMatchObject({
    body: { mode: 'code', codeLanguage: 'javascript', code: CODE },
  });
});

test('Http request body — a pre-P3 tab restores into code · JSON', async ({ relaunch }) => {
  const PRE_P3_TAB = {
    id: 'tab-pre-p3-1',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'POST',
      url: 'https://api.example.com/widgets',
      headers: [],
      bodyMode: 'json',
      body: '{"name":"gizmo"}',
      requestPane: 'body',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.tabsList, response: [PRE_P3_TAB] }];
  const { window: page } = await relaunch({ control: CONTROL });

  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-body-mode-code"]')).toHaveClass(/on/);
  await expect(page.locator('[data-testid="http-body-code-language"]')).toHaveValue('json');
  const editor = page.locator('[data-testid="http-request-pane"] .cm-content');
  expect(await editor.innerText()).toBe('{"name":"gizmo"}');

  // The legacy alias's other half: switching to a mode absent from the pre-P3 record renders an
  // empty table rather than throwing.
  await page.click('[data-testid="http-body-mode-formdata"]');
  await expect(page.locator('[data-testid="http-formdata-table"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-formdata-row"]')).toHaveCount(1); // the trailing blank row only
});
