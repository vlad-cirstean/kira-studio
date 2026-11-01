import type { CDPSession, Page } from '@playwright/test';

// P433 tab heap probe. Chromium only (CDP). Report-only: prints `HEAP ...` lines, asserts nothing.

/** Channels that write or only announce; every other control call counts as a read. */
const WRITE_CHANNEL = /(save|set|reorder|update|delete|create|touch|record|persist|focus|ensure)/i;

export function isReadChannel(channel: string): boolean {
  return !WRITE_CHANNEL.test(channel);
}

export class HeapSampler {
  private constructor(private readonly cdp: CDPSession) {}

  static async attach(page: Page): Promise<HeapSampler> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    return new HeapSampler(cdp);
  }

  /** Used JS heap in MB after two forced GCs. */
  async sampleMb(): Promise<number> {
    await this.cdp.send('HeapProfiler.collectGarbage');
    await this.cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await this.cdp.send('Runtime.getHeapUsage');
    return usedSize / (1024 * 1024);
  }
}

/** Closes every tab through a tab's context menu; `keep` pinned tabs stay. */
export async function closeAllTabs(page: Page, keep = 0): Promise<void> {
  // The last tab: a pinned first tab has a shorter menu.
  const tabs = page.locator('[data-testid="tab"]');
  if ((await tabs.count()) <= keep) return;
  const last = tabs.last();
  await last.scrollIntoViewIfNeeded();
  await last.click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="tab"]').length <= n,
    keep,
  );
}

export interface HeapTab {
  name: string;
  open(): Promise<void>;
  /** The tab exists from boot and cannot be reopened after close-all. */
  bootOnly?: true;
}

export interface HeapScenario {
  page: Page;
  tabs: readonly HeapTab[];
  /** Cumulative read calls so far, one label per call. */
  reads(): Promise<string[]>;
  closeAll(): Promise<void>;
  /** Leaves and returns to the tab strip, for a world with a single tab to switch away from. */
  away?: { leave(): Promise<void>; back(): Promise<void> };
  rounds?: number;
}

export interface HeapReport {
  baselineMb: number;
  open: { name: string; mb: number; deltaMb: number }[];
  rounds: { mb: number; reads: number; byChannel: Record<string, number> }[];
  away6m: { mb: number; reads: number; byChannel: Record<string, number> };
  closedMb: number;
  /** Second open-all/close-all cycle: heap after its close-all (warm baseline growth = closed2Mb - closedMb). */
  closed2Mb: number;
}

const SETTLE_MS = 500;

function tally(labels: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of labels) out[l] = (out[l] ?? 0) + 1;
  return out;
}

/** Labels in `after` beyond those in `before`; the lists may interleave sources. */
function added(before: readonly string[], after: readonly string[]): string[] {
  const seen = tally(before);
  const out: string[] = [];
  for (const l of after) {
    if (seen[l]) seen[l]--;
    else out.push(l);
  }
  return out;
}

async function activate(page: Page, index: number): Promise<void> {
  const tab = page.locator('[data-testid="tab"]').nth(index);
  await tab.click();
  await page.waitForFunction(
    (i) =>
      document.querySelectorAll('[data-testid="tab"]')[i]?.getAttribute('data-active') === 'true',
    index,
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function round(
  s: HeapScenario,
  sampler: HeapSampler,
  label: string,
): Promise<HeapReport['rounds'][number]> {
  const before = await s.reads();
  for (let i = 0; i < s.tabs.length; i++) await activate(s.page, i);
  if (s.away) {
    await s.away.leave();
    await s.page.waitForTimeout(SETTLE_MS);
    await s.away.back();
    await s.page.waitForTimeout(SETTLE_MS);
  }
  const delta = added(before, await s.reads());
  const mb = await sampler.sampleMb();
  const rec = { mb, reads: delta.length, byChannel: tally(delta) };
  console.log(
    `HEAP ${label} mb=${mb.toFixed(1)} reads=${delta.length} ${JSON.stringify(rec.byChannel)}`,
  );
  return rec;
}

/** Open each tab, three switch rounds, six minutes away, one more round, close all, then reopen and close all again. */
export async function runHeapScenario(s: HeapScenario): Promise<HeapReport> {
  const sampler = await HeapSampler.attach(s.page);
  await s.page.waitForTimeout(2000);
  const baselineMb = await sampler.sampleMb();
  console.log(`HEAP baseline mb=${baselineMb.toFixed(1)}`);

  const open: HeapReport['open'] = [];
  let prev = baselineMb;
  for (const tab of s.tabs) {
    await tab.open();
    await s.page.waitForTimeout(SETTLE_MS * 2);
    const mb = await sampler.sampleMb();
    open.push({ name: tab.name, mb, deltaMb: mb - prev });
    console.log(`HEAP open ${tab.name} mb=${mb.toFixed(1)} delta=${(mb - prev).toFixed(1)}`);
    prev = mb;
  }

  const rounds: HeapReport['rounds'] = [];
  for (let r = 1; r <= (s.rounds ?? 3); r++) rounds.push(await round(s, sampler, `round${r}`));

  const beforeAway = await s.reads();
  await s.away?.leave();
  await s.page.clock.fastForward(6 * 60_000);
  await s.page.waitForTimeout(SETTLE_MS);
  await s.away?.back();
  await s.page.waitForTimeout(SETTLE_MS);
  const idle = added(beforeAway, await s.reads());
  console.log(`HEAP idle6m reads=${idle.length} ${JSON.stringify(tally(idle))}`);
  const away6m = await round(s, sampler, 'after6m');

  await s.closeAll();
  await s.page.waitForTimeout(SETTLE_MS * 2);
  const closedMb = await sampler.sampleMb();
  console.log(
    `HEAP closed mb=${closedMb.toFixed(1)} vsBaseline=${(closedMb - baselineMb).toFixed(1)}`,
  );

  for (const tab of s.tabs) if (!tab.bootOnly) await tab.open();
  await s.closeAll();
  await s.page.waitForTimeout(SETTLE_MS * 2);
  const closed2Mb = await sampler.sampleMb();
  console.log(
    `HEAP closed2 mb=${closed2Mb.toFixed(1)} vsClosed=${(closed2Mb - closedMb).toFixed(1)}`,
  );

  const report = { baselineMb, open, rounds, away6m, closedMb, closed2Mb };
  console.log(`HEAPJSON ${JSON.stringify(report)}`);
  return report;
}
