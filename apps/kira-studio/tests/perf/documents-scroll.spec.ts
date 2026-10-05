import type { Page } from '@playwright/test';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';
import {
  DB_PATH,
  mongoConnectionSummary,
  WIDGETS_PATH,
  widgetsFixture,
} from '../ui/support/mongoFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from '../ui/support/tree';
import {
  type Frame,
  type FrameMetrics,
  frameRunLine,
  frameStats,
  frameSummaryLine,
  load1,
} from './perfProbe';

// P161: documents view fast-scroll probe. Opt-in (`bun run perf:documents:studio`), asserts
// nothing. Run on a quiet machine (load1 <= 1.0); runs print load1 so a noisy one can be
// discarded. Real wheel input over 5 000 expanded documents (~160 px rows, 800 000 px list).

const ENV = process.env;
const RUNS = Number(ENV.KIRA_PERF_RUNS ?? 3);
const ONLY = ENV.KIRA_PERF_CASES?.split(',');
const DOCS = Number(ENV.KIRA_PERF_DOCS ?? 5000);
const FLICK_EVENTS = Number(ENV.KIRA_PERF_FLICK_EVENTS ?? 80);
const FLICK_DY = Number(ENV.KIRA_PERF_FLICK_DY ?? 9600);
const LADDER_START_DY = Number(ENV.KIRA_PERF_LADDER_DY ?? 1600);
const LADDER_DECAY = Number(ENV.KIRA_PERF_LADDER_DECAY ?? 0.92);
const SETTLE_MS = 500;
const LIST = '[data-testid="document-list"] [data-testid="virtual-list"]';

const CONNECTION_ID = 'conn-doc-perf';
const SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo Perf', 'red');
const FIXTURE = widgetsFixture(CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Mongo Perf',
      kind: 'mongodb',
      color: 'red',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 27017,
      database: 'kira_test',
      username: 'kira',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
      throttlePerSec: 0,
    },
    response: SUMMARY,
  },
  ...FIXTURE.control,
];

const hex = (n: number): string => n.toString(16).padStart(24, '0');

/** Same 7-field shape as `WIDGETS_BODIES[0]` (expanded height 160 px), unique `_id`, varied values. */
function makeDocs(n: number): { ids: string[]; bodies: string[] } {
  const ids: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `{"$oid":"${hex(i)}"}`;
    ids.push(id);
    bodies.push(
      `{"_id":${id},"name":"widget-${i}","price":{"$numberDouble":"${(i % 997) + 0.5}"},"active":${i % 2 === 0},"createdAt":{"$date":{"$numberLong":"${1704067200000 + i * 86400000}"}},"tags":["${i % 3 === 0 ? 'red' : 'blue'}","small"],"meta":{"weight":{"$numberInt":"${i}"},"note":${i % 5 === 0 ? 'null' : `"note-${i}"`}}}`,
    );
  }
  return { ids, bodies };
}

function readSnapshot(
  pageSize: number,
  docs: { ids: string[]; bodies: string[] },
  hasMore: boolean,
): PortSnapshot {
  return {
    op: DATA_OP.read,
    payload: {
      connectionId: CONNECTION_ID,
      path: WIDGETS_PATH,
      projection: null,
      filter: null,
      sort: null,
      pageSize,
      cursor: { mode: 'offset', offset: 0 },
    },
    response: {
      kind: 'read',
      page: {
        kind: 'document',
        ids: docs.ids.slice(0, pageSize),
        bodies: docs.bodies.slice(0, pageSize),
        position: {
          offset: 0,
          pageSize,
          hasMore,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
      },
      source: 'server',
    },
  };
}

async function installRecorder(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const list = document.querySelector<HTMLElement>(sel);
    if (!list) throw new Error('virtual-list not found');
    interface Rec {
      frames: Array<{ t: number; uncoveredPx: number }>;
      start: number;
      end: number;
      stop: boolean;
    }
    const rec: Rec = { frames: [], start: 0, end: 0, stop: false };
    (window as unknown as { __kiraRec: Rec }).__kiraRec = rec;
    const tick = (t: number) => {
      const top = list.scrollTop;
      const h = list.clientHeight;
      // Style attributes, not getBoundingClientRect: no forced layout inside the probe.
      const spans: Array<[number, number]> = [];
      for (const el of list.querySelectorAll<HTMLElement>('[data-testid="document-row"]')) {
        const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
        const start = m ? Number(m[1]) : 0;
        spans.push([start - top, start - top + Number.parseFloat(el.style.height)]);
      }
      spans.sort((a, b) => a[0] - b[0]);
      let covered = 0;
      let cursor = 0;
      for (const [a, b] of spans) {
        const lo = Math.max(a, cursor, 0);
        const hi = Math.min(b, h);
        if (hi > lo) covered += hi - lo;
        cursor = Math.max(cursor, b);
      }
      rec.frames.push({ t, uncoveredPx: Math.max(0, h - covered) });
      if (!rec.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, LIST);
}

async function mark(page: Page, which: 'start' | 'end'): Promise<void> {
  await page.evaluate((w) => {
    const rec = (window as unknown as { __kiraRec: { start: number; end: number } }).__kiraRec;
    rec[w] = performance.now();
  }, which);
}

async function collect(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const rec = (
      window as unknown as {
        __kiraRec: { frames: Frame[]; start: number; end: number; stop: boolean };
      }
    ).__kiraRec;
    rec.stop = true;
    return rec.frames.filter((f) => f.t >= rec.start && f.t <= rec.end);
  });
}

type Gesture = { name: string; fromBottom: boolean; deltas: number[] };

const ladder: number[] = [];
for (let dy = LADDER_START_DY; dy >= 20; dy *= LADDER_DECAY) ladder.push(Math.round(dy));
const flick: number[] = Array.from({ length: FLICK_EVENTS }, () => FLICK_DY);

const GESTURES: Gesture[] = [
  { name: 'ladder', fromBottom: false, deltas: ladder },
  { name: 'flick', fromBottom: false, deltas: flick },
  { name: 'flick-up', fromBottom: true, deltas: flick.map((d) => -d) },
];

const PARAMS = `docs=${DOCS} flickEvents=${FLICK_EVENTS} flickDy=${FLICK_DY} ladderDy=${LADDER_START_DY} ladderDecay=${LADDER_DECAY}`;

test.describe.configure({ mode: 'serial' });

test('documents scroll', async ({ relaunch }) => {
  test.setTimeout(900_000);
  const docs = makeDocs(DOCS);
  const { window: page } = await relaunch({
    control: CONTROL,
    stream: [
      readSnapshot(100, docs, true),
      readSnapshot(10000, docs, false),
      ...FIXTURE.port.slice(1),
    ],
  });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mongodb"]');
  await page.fill('[data-testid="connection-name"]', 'Mongo Perf');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '27017');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
  await page.click('[data-testid="color-red"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  const connRow = connectionRow(page);
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await (await findRow(page, WIDGETS_PATH)).dblclick();
  await expect(page.locator('[data-testid="document-row"]').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.click('[data-testid="document-page-size-10000"]');
  const list = page.locator(LIST);
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(Math.round(DOCS * 158));
  const box = await list.boundingBox();
  if (!box) throw new Error('virtual-list has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const gesture = async (g: Gesture): Promise<Frame[]> => {
    await list.evaluate((el, bottom) => {
      el.scrollTop = bottom ? el.scrollHeight : 0;
    }, g.fromBottom);
    await page.waitForTimeout(400);
    await installRecorder(page);
    await mark(page, 'start');
    for (const dy of g.deltas) await page.mouse.wheel(0, dy);
    await mark(page, 'end');
    const frames = await collect(page);
    await page.waitForTimeout(SETTLE_MS);
    return frames;
  };

  for (const g of GESTURES) {
    if (ONLY && !ONLY.includes(g.name)) continue;
    await gesture(g); // warm-up, discarded
    const runs: FrameMetrics[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const load = load1();
      const m = frameStats(await gesture(g), load);
      runs.push(m);
      console.log(frameRunLine(g.name, run, PARAMS, m));
    }
    console.log(frameSummaryLine(g.name, PARAMS, runs));
  }
});
