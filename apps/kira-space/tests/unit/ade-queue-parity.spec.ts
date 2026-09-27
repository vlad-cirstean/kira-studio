import { describe, expect, test } from 'bun:test';
import { needsInputByRepo } from '../../frontend/src/ade/activity';
import {
  LATER,
  type QueueBand,
  type QueueItem,
  type QueueSegment,
  useQueue,
} from '../../frontend/src/ade/useQueue';
import { loadNeutralizedComponent, type MockupComponent } from './support/mockupOracle';
import { isoFromOffset, mockupToWire, toQueueInput } from './support/mockupToWire';

// P129 Part 3 §3.1 — the mockup itself, run unmodified via `node:vm` (`support/mockupOracle.ts`), is
// the oracle; `support/mockupToWire.ts` converts its own raw fixture data (never `renderVals()`'s own
// output, §0.2's own risk mitigation) into the exact `QueueInput` shape `useQueue()` takes. Both
// sides are built from one shared, live `comp.state` per scenario, so a scenario is one state patch,
// applied once, read twice.
//
// **Identity, not position, drives every comparison.** `renderVals()`'s own `blocks` (one per
// segment) are exposed only pre-bucketed into `bands[].blocks`, a day-ascending regrouping that is
// *not* guaranteed to preserve `seq`'s own construction order (a multi-day span's `end` can sort
// after a later single-day segment's `day`, so bucket-by-day and `seq`-order genuinely diverge —
// found while writing this spec, not a defect in the port). Positional index matching would silently
// misalign as soon as a multi-day estimate is in play. Instead: every mockup row exposes its own
// `name` (`b.name || titleOf(b)`, mockup line 1104), always unique in this fixture (a real branch's
// git name, or a draft's own resolved title) — matched here against `item.branch || item.title`,
// which is exactly the same expression ported. A segment is then whichever of `useQueue`'s own
// `segments` owns that matched item as a member. This is real identity, immune to ordering.
//
// Per-cell/per-row tooltip text (`tip`, `cells[i].tip`'s own "leftover info" suffix) is out of scope
// here: `QueueCell` carries no tip field at all (Parts 4-6 haven't specified a per-row tooltip
// surface yet), and mockup's own leftover-info-onto-`cells[0].tip` mechanics (lines 1186-1190) don't
// have a comparable target to assert against. Tag/action/info *presence* and label are asserted;
// free-text tooltips are not.

type Repo = 'web-app' | 'api' | 'mobile';

function domIdToDay(domId: string): number {
  const suffix = domId.replace('aq-day-', '');
  if (suffix === 'later') return LATER;
  if (suffix.startsWith('m')) return -Number(suffix.slice(1));
  return Number(suffix);
}

function buildScenario(repo: Repo, configure?: (comp: MockupComponent) => void) {
  const comp = loadNeutralizedComponent();
  comp.state.repo = repo;
  comp.state.lastRepo = repo;
  // Real wire settings carry `historyDays` as a plain count, no show/hide toggle (§0's own scope —
  // Parts 4-6 own the UI) — always revealing history here is the fair comparison, not a divergence.
  comp.state.showHistory = true;
  configure?.(comp);
  const wire = mockupToWire(comp, repo);
  return { comp, wire };
}

interface Compared {
  oracle: ReturnType<MockupComponent['renderVals']>;
  view: ReturnType<typeof useQueue>;
}

function compareStructure(
  comp: MockupComponent,
  wire: ReturnType<typeof mockupToWire>,
  repo: Repo,
): Compared {
  const oracle = comp.renderVals();
  const view = useQueue(toQueueInput(wire));

  const keyOf = (it: QueueItem): string => it.branch || it.title;
  const myItemByKey = new Map(view.items.map((it) => [keyOf(it), it] as const));
  const segmentOfItem = new Map<string, QueueSegment>();
  for (const seg of view.segments) for (const m of seg.members) segmentOfItem.set(m.id, seg);

  // ---- segments/blocks, matched by member identity, not position -------------------------------
  const oracleBlocks: MockupComponent[] = oracle.bands.flatMap(
    (band: MockupComponent) => band.blocks,
  );
  expect(oracleBlocks.length).toBe(view.segments.length);

  const seenSegments = new Set<QueueSegment>();
  for (const block of oracleBlocks) {
    const firstRow = block.rows[0];
    const firstItem = myItemByKey.get(firstRow.name);
    expect(
      firstItem,
      `no port item for oracle row name ${JSON.stringify(firstRow.name)}`,
    ).toBeDefined();
    const seg = segmentOfItem.get((firstItem as QueueItem).id) as QueueSegment;
    expect(seg).toBeDefined();
    expect(seenSegments.has(seg)).toBe(false); // every segment matched exactly once
    seenSegments.add(seg);

    expect(block.tag).toBe(seg.tag.label);
    expect(block.hasAction).toBe(!!seg.action);
    if (seg.action) {
      expect(block.actionLabel).toBe(seg.action.label);
      expect(block.actionDisabled).toBe(seg.action.disabled);
    }
    expect(block.rows.length).toBe(seg.members.length);

    block.rows.forEach((row: MockupComponent, i: number) => {
      const id = seg.members[i]?.id as string;
      const it = view.items.find((x) => x.id === id) as QueueItem;
      expect(it, `segment member ${id} missing from view.items`).toBeDefined();
      expect(row.name).toBe(keyOf(it));
      expect(row.title).toBe(it.title);
      expect(row.branchText).toBe(it.branchText);
      expect(row.isMerged).toBe(it.status.label === 'merged');
      expect(row.isReview).toBe(it.kind === 'review');
      const canStart = it.kind === 'mine' && it.acts.length === 0 && it.status.label !== 'merged';
      expect(row.canStart).toBe(canStart);
    });
  }
  expect(seenSegments.size).toBe(view.segments.length);

  // ---- bands, matched by day offset (parsed from `domId`) ---------------------------------------
  expect(oracle.bands.length).toBe(view.bands.length);
  const myBandByDay = new Map(view.bands.map((b: QueueBand) => [b.day, b] as const));
  for (const band of oracle.bands) {
    const b = myBandByDay.get(domIdToDay(band.domId));
    expect(b, `no port band for domId ${band.domId}`).toBeDefined();
    const myBand = b as QueueBand;
    expect(band.label).toBe(myBand.label);
    expect(band.isLater).toBe(myBand.isLater);
    expect(band.isOverdue).toBe(myBand.isOverdue);
    expect(band.isOver).toBe(myBand.isOverflow);
    const expectedSub = myBand.isDayOff
      ? 'off'
      : myBand.isWeekend && !myBand.hours
        ? ''
        : myBand.hours
          ? `${myBand.hours}h`
          : '';
    expect(band.sub).toBe(expectedSub);

    // §0.4 additions — `iso`/`isMonday` independently, via the same offset the oracle's own domId
    // already encodes (Date parses the ISO in UTC, matching `mockupOracle.ts`'s own forced TZ=UTC;
    // never the port's own `civilFromDays` arithmetic).
    if (myBand.day === LATER) {
      expect(myBand.iso).toBeNull();
    } else {
      const expectedIso = isoFromOffset(myBand.day);
      expect(myBand.iso).toBe(expectedIso);
      const dow = new Date(`${expectedIso}T00:00:00Z`).getUTCDay();
      expect(myBand.isMonday).toBe(dow === 1);
      expect(myBand.isCalendarWeekend).toBe(dow === 0 || dow === 6);
    }
    // `isEmpty` against the oracle's own band-level arrays (blocks/spans/history), not the port's.
    const oracleEmpty =
      band.blocks.length === 0 && band.spans.length === 0 && band.history.length === 0;
    expect(myBand.isEmpty).toBe(oracleEmpty);
    // `overflowMoveLabel` <-> oracle `overLabel` (only meaningful when something overflows).
    if (band.isOver) expect(myBand.overflowMoveLabel).toBe(band.overLabel);
    // continuation rows (spans): title/note/tip direct; `isEnd` via the oracle's own amber
    // `noteStyle` (the mockup exposes it as a style string, not a flag).
    expect(band.spans.length).toBe(myBand.spans.length);
    band.spans.forEach((span: MockupComponent, i: number) => {
      const mySpan = myBand.spans[i];
      expect(mySpan, `no port span at band ${band.domId} index ${i}`).toBeDefined();
      expect(span.title).toBe(mySpan?.title);
      expect(span.note).toBe(mySpan?.note);
      expect(span.tip).toBe(mySpan?.tip);
      expect(mySpan?.isEnd).toBe((span.noteStyle as string).includes('#f0b85c'));
    });
  }

  // `focusDay`: `renderVals()` sets it on the component instance as a side effect (mockup 1302).
  expect(view.focusDay).toBe(comp.focusDay);
  // `historyCount` <-> mockup `histCount`, only readable through the closed-pull row's own text
  // (mockup 1784) since `histCount` itself is never returned as a standalone field.
  const historyMatch = /(\d+) archived/.exec(oracle.pullText as string);
  if (historyMatch) expect(view.historyCount).toBe(Number(historyMatch[1]));

  // ---- needs-input count, this repo's own tab -----------------------------------------------
  // `repoTabs[]` carries no `key` field, only `label` — the pinned "All agents" tab shares
  // `repo`'s own name space too, but no repo is ever literally named that, so matching by label
  // alone is unambiguous.
  const counts = needsInputByRepo(wire.sessions, wire.activity);
  const tab = oracle.repoTabs.find((t: MockupComponent) => t.label === repo);
  expect(tab, `no oracle repoTabs entry labelled ${repo}`).toBeDefined();
  const oracleInputCount = tab.acts.find((a: MockupComponent) => a.kind === 'input')?.count ?? 0;
  expect(counts.get(repo) ?? 0).toBe(oracleInputCount);

  return { oracle, view };
}

function shortBranchOf(view: ReturnType<typeof useQueue>, id: string): string {
  const it = view.items.find((x) => x.id === id);
  return (it?.branch ?? id).replace(/^[^/]+\//, '');
}

function compareSelected(
  comp: MockupComponent,
  wire: ReturnType<typeof mockupToWire>,
  repo: Repo,
  id: string,
): void {
  comp.state.selected = { ...comp.state.selected, [repo]: id };
  const oracle = comp.renderVals();
  const view = useQueue(toQueueInput(wire, id));
  expect(view.selectedId).toBe(id);
  const item = view.items.find((it) => it.id === id) as QueueItem;
  expect(item, `selected id ${id} missing from view.items`).toBeDefined();

  expect(oracle.sel.title).toBe(item.title);
  expect(oracle.sel.status).toBe(item.status.label);
  expect(oracle.sel.links[0].status).toBe(item.branchStatus.label);

  const expectedRipple =
    item.kind !== 'mine'
      ? '—'
      : view.ripple.length
        ? `rebase ${view.ripple.map((rid) => shortBranchOf(view, rid)).join(', ')}`
        : 'nothing to rebase';
  expect(oracle.sel.ripple).toBe(expectedRipple);

  if (!item.draft && item.kind !== 'review') {
    const dirty = oracle.sel.dirty.map((d: MockupComponent) => d.path);
    const unmerged = item.status.label === 'merged' ? 0 : oracle.sel.ahead;
    const expected = dirty.length || unmerged ? { dirty, unmerged } : null;
    expect(view.atRisk).toEqual(expected);
  } else {
    expect(view.atRisk).toBeNull();
  }
}

function allItemIds(wire: ReturnType<typeof mockupToWire>): string[] {
  return [...wire.snapshot.branches.map((b) => b.id), ...wire.snapshot.newWork.map((w) => w.id)];
}

describe('ade-queue-parity — mockup renderVals() vs useQueue()', () => {
  test('initial state, all three repos', () => {
    for (const repo of ['web-app', 'api', 'mobile'] as const) {
      const { comp, wire } = buildScenario(repo);
      compareStructure(comp, wire, repo);
    }
  });

  test('each web-app item selected in turn (ripple)', () => {
    const { comp, wire } = buildScenario('web-app');
    compareStructure(comp, wire, 'web-app');
    for (const id of allItemIds(wire)) compareSelected(comp, wire, 'web-app', id);
  });

  test('each api/mobile item selected in turn', () => {
    for (const repo of ['api', 'mobile'] as const) {
      const { comp, wire } = buildScenario(repo);
      for (const id of allItemIds(wire)) compareSelected(comp, wire, repo, id);
    }
  });

  test('cart unmerged, notif merged instead', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.merged = { notif: true };
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('queuedAfter set (searchui after billing)', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.plans = {
        ...c.state.plans,
        'web-app': { ...c.state.plans['web-app'], queuedAfter: { searchui: 'billing' } },
      };
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('unpushed set (auth)', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.plans = {
        ...c.state.plans,
        'web-app': { ...c.state.plans['web-app'], unpushed: { auth: true } },
      };
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('rebasing a root (auth)', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.rebasing = ['auth'];
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('pushing a branch (auth)', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.pushing = ['auth'];
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('an off day and a worked weekend inside the horizon', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.offDays = [2]; // Thursday
      c.state.workWeekend = [4, 5]; // that week's Saturday/Sunday, worked
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('an extra day beyond the horizon', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.extraDays = [20];
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('estimate overrides forcing overflow on today', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.est = { billing: '8h', billdash: '4h' }; // both effDay 0, WORKDAY = 6h
    });
    compareStructure(comp, wire, 'web-app');
  });

  test('a user name override', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.names = { billing: 'Custom Billing Title' };
    });
    compareStructure(comp, wire, 'web-app');
    compareSelected(comp, wire, 'web-app', 'billing');
  });

  test('horizon and history both 7', () => {
    const { comp, wire } = buildScenario('web-app', (c) => {
      c.state.horizon = 7;
      c.state.history = 7;
    });
    compareStructure(comp, wire, 'web-app');
  });

  // §0.4/§3.1: history closed — same band keys as the horizon/segment-driven set alone, no history
  // rows. `buildScenario` always sets `showHistory = true`; this is the one case that overrides it.
  test('history closed (showHistory = false / historyOpen: false)', () => {
    const comp = loadNeutralizedComponent();
    comp.state.repo = 'web-app';
    comp.state.lastRepo = 'web-app';
    comp.state.showHistory = false;
    const wire = mockupToWire(comp, 'web-app');
    expect(wire.historyOpen).toBe(false);
    const view = useQueue(toQueueInput(wire));
    for (const band of view.bands) expect(band.history).toEqual([]);
    compareStructure(comp, wire, 'web-app');
  });
});
