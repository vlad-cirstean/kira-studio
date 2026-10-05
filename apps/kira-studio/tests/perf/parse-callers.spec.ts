import type { Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { grpcTab } from '../ui/support/apiMode';
import { connectAndExpand, connectionCreateArgs, openConsoleFromMenu } from '../ui/support/connect';
import { typeInto } from '../ui/support/editor';
import { IPC } from '../ui/support/ipcChannels';
import {
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from '../ui/support/postgresFixture';
import { type ActionMetrics, actionLine, actionSummaryLine, measureAction } from './blockMeter';

// P163: opt-in probe of every large-input parse caller (`bun run perf:parse:studio`), asserts
// nothing. Same gate as the HTTP probe: run only at load1 <= 1.0 (docs/DEV_ENVIRONMENT.md).

const MB = 1_048_576;
const RUNS = Number(process.env.KIRA_PERF_RUNS ?? 3);
const ONLY = process.env.KIRA_PERF_CASES?.split(',');
const want = (c: string): boolean => !ONLY || ONLY.includes(c);

function jsonOfSize(bytes: number): string {
  const rows: string[] = [];
  let len = 2;
  for (let n = 0; len < bytes; n++) {
    const r = `{"id":${n},"name":"user-${n}","email":"user-${n}@example.com","active":true,"score":12.5,"tags":["a","b"]}`;
    rows.push(r);
    len += r.length + 1;
  }
  return `[${rows.join(',')}]`;
}

function xmlOfSize(bytes: number): string {
  const rows: string[] = [];
  let len = 13;
  for (let n = 0; len < bytes; n++) {
    const r = `<item id="${n}"><name>user-${n}</name><v>${n}</v><tag>a</tag></item>`;
    rows.push(r);
    len += r.length;
  }
  return `<root>${rows.join('')}</root>`;
}

function sqlScriptOfSize(bytes: number): string {
  const stmts: string[] = [];
  let len = 0;
  for (let n = 0; len < bytes; n++) {
    const s = `select a${n},b from t${n} where a=${n} and b in (select x from y);`;
    stmts.push(s);
    len += s.length + 1;
  }
  return stmts.join('\n');
}

// Pretty output starts with a short first line and spans many lines; the compact input is one
// long first line.
const PRETTY_DONE = `() => {
  const lines = document.querySelectorAll('.monaco-editor .view-lines .view-line');
  if (lines.length < 3) return false;
  const first = (lines[0].textContent || '').trim();
  return first.length > 0 && first.length <= 12;
}`;

async function measure(
  name: string,
  size: string,
  open: () => Promise<Page>,
  click: string,
  done: string,
): Promise<void> {
  const results: ActionMetrics[] = [];
  for (let run = 0; run <= RUNS; run++) {
    const page = await open();
    await page.waitForTimeout(500);
    const m = await measureAction(page, click, done);
    // run 0 is the discarded warm-up.
    if (run > 0) {
      results.push(m);
      console.log(actionLine(name, size, run, m));
    }
    await page.close();
  }
  console.log(actionSummaryLine(name, size, results));
  expect(results.length).toBe(RUNS);
}

test.describe.configure({ mode: 'serial' });

const BODY_SIZES = [0.5, 5];

for (const [kind, gen, lang] of [
  ['json', jsonOfSize, 'json'],
  ['xml', xmlOfSize, 'xml'],
] as const) {
  const name = `req-body-${kind}`;
  if (want(name)) {
    for (const mb of BODY_SIZES) {
      test(`${name} ${mb}MB`, async ({ relaunch }) => {
        test.setTimeout(900_000);
        const code = gen(Math.round(mb * MB));
        const tab = {
          id: 'tab-http-1',
          connectionId: null,
          path: 'request',
          kind: 'http-request',
          order: 0,
          active: true,
          state: {
            method: 'POST',
            url: 'https://api.example.com/upload',
            headers: [],
            bodyMode: 'code',
            code,
            codeLanguage: lang,
            requestPane: 'body',
            responsePane: 'body',
            responseView: 'pretty',
            requestPaneHeight: 0,
          },
        };
        await measure(
          name,
          `${mb}MB`,
          async () => {
            const { window } = await relaunch({
              control: [{ channel: IPC.tabsList, response: [tab] }],
            });
            await expect(window.locator('[data-testid="http-request-view"]')).toBeVisible();
            await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
            return window;
          },
          '[data-testid="http-body-beautify"]',
          PRETTY_DONE,
        );
      });
    }
  }
}

if (want('grpc-json')) {
  for (const mb of BODY_SIZES) {
    test(`grpc-json ${mb}MB`, async ({ relaunch }) => {
      test.setTimeout(900_000);
      const message = jsonOfSize(Math.round(mb * MB));
      await measure(
        'grpc-json',
        `${mb}MB`,
        async () => {
          const { window } = await relaunch({
            control: [
              {
                channel: IPC.tabsList,
                response: [grpcTab({ message }, { responsePane: 'messages' })],
              },
            ],
          });
          await expect(window.locator('[data-testid="grpc-request-view"]')).toBeVisible();
          await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
          return window;
        },
        '[data-testid="grpc-beautify"]',
        PRETTY_DONE,
      );
    });
  }
}

if (want('console-format')) {
  for (const kb of [64, 236, 1024]) {
    test(`console-format ${kb}KB`, async ({ relaunch }) => {
      test.setTimeout(900_000);
      const script = sqlScriptOfSize(kb * 1024);
      const id = 'conn-perf-format';
      const summary = postgresConnectionSummary(id, 'Perf DB', 'green');
      const fixture = orderItemsFixture(id);
      const control: ControlSnapshot[] = [
        { channel: IPC.connectionsList, response: [] },
        {
          channel: IPC.connectionsCreate,
          args: connectionCreateArgs('Perf DB', 'green'),
          response: summary,
        },
        ...fixture.control,
      ];
      await measure(
        'console-format',
        `${kb}KB`,
        async () => {
          const { window } = await relaunch({ control });
          await connectAndExpand(window, 'Perf DB', 'green');
          await openConsoleFromMenu(window, ORDER_ITEMS_PATH);
          const view = window.locator('[data-testid="console-view"]');
          await expect(view).toBeVisible();
          await typeInto(view, window, script, { paste: true });
          await expect(view.locator('.view-line').first()).toContainText('select');
          return window;
        },
        '[data-testid="console-format"]',
        `() => {
          const lines = document.querySelectorAll('[data-testid="console-view"] .view-lines .view-line');
          if (lines.length < 3) return false;
          return (lines[0].textContent || '').trim() === 'select';
        }`,
      );
    });
  }
}
